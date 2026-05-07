import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { canvasToJpeg, cropQuadBoundingBoxToJpeg, Quad, CaptureResult } from '../utils/imageProcessing';

const DETECTION_INTERVAL_MS = 100;
const DETECTION_MAX_WIDTH = 640;

type DetectionStatus = 'idle' | 'ready' | 'detecting' | 'found' | 'not-found' | 'error';

type WorkerResult = {
  type: 'ready' | 'result' | 'error';
  id?: number;
  quad?: Quad | null;
  durationMs?: number;
  source?: 'threshold' | 'canny' | 'none';
  message?: string;
};

export function useDocumentDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  const fullFrameCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const detectionCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef(false);
  const requestIdRef = useRef(0);
  const useCannyRef = useRef(false);
  const quadRef = useRef<Quad | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [status, setStatus] = useState<DetectionStatus>('idle');
  const [debugText, setDebugText] = useState('No document found');

  const drawOverlay = useCallback((detectedQuad: Quad | null) => {
    const video = videoRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video || !overlay || !video.videoWidth || !video.videoHeight) return;

    const rect = video.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.round(rect.width * dpr);
    const nextHeight = Math.round(rect.height * dpr);

    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    if (overlay.width !== nextWidth) overlay.width = nextWidth;
    if (overlay.height !== nextHeight) overlay.height = nextHeight;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!detectedQuad) return;

    const videoAspect = video.videoWidth / video.videoHeight;
    const rectAspect = rect.width / rect.height;
    const contentWidth = rectAspect > videoAspect ? rect.height * videoAspect : rect.width;
    const contentHeight = rectAspect > videoAspect ? rect.height : rect.width / videoAspect;
    const offsetX = (rect.width - contentWidth) / 2;
    const offsetY = (rect.height - contentHeight) / 2;
    const scaleX = contentWidth / video.videoWidth;
    const scaleY = contentHeight / video.videoHeight;
    const canvasPoints = detectedQuad.map((point) => ({
      x: offsetX + point.x * scaleX,
      y: offsetY + point.y * scaleY,
    }));

    ctx.strokeStyle = '#00ff00';
    ctx.fillStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    canvasPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();

    canvasPoints.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [overlayCanvasRef, videoRef]);

  const copyFullVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;

    const canvas = fullFrameCanvasRef.current;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, [videoRef]);

  const copyDetectionFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;

    const scale = Math.min(1, DETECTION_MAX_WIDTH / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = detectionCanvasRef.current;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return { imageData: ctx.getImageData(0, 0, width, height), scale };
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) {
      workerRef.current?.terminate();
      workerRef.current = null;
      workerBusyRef.current = false;
      useCannyRef.current = false;
      quadRef.current = null;
      setQuad(null);
      setStatus('idle');
      setDebugText('No document found');
      drawOverlay(null);
      return;
    }

    let stopped = false;
    let timeoutId = 0;
    const worker = new Worker(`${import.meta.env.BASE_URL}documentDetectionWorker.js`);
    workerRef.current = worker;
    setStatus('ready');
    setDebugText('No document found');

    const scheduleNext = (delay = DETECTION_INTERVAL_MS) => {
      window.clearTimeout(timeoutId);
      if (!stopped) timeoutId = window.setTimeout(runDetection, delay);
    };

    const handleWorkerMessage = (event: MessageEvent<WorkerResult>) => {
      const data = event.data;
      if (stopped) return;

      if (data.type === 'ready') {
        scheduleNext(0);
        return;
      }

      workerBusyRef.current = false;

      if (data.type === 'error') {
        quadRef.current = null;
        setQuad(null);
        setStatus('error');
        setDebugText(data.message || 'No document found');
        drawOverlay(null);
        scheduleNext(500);
        return;
      }

      const detected = data.quad || null;
      quadRef.current = detected;
      setQuad(detected);
      setStatus(detected ? 'found' : 'not-found');
      setDebugText(detected ? 'Document detected' : 'No document found');
      useCannyRef.current = !detected;
      drawOverlay(detected);
      scheduleNext();
    };

    function runDetection() {
      if (stopped || workerBusyRef.current) {
        scheduleNext();
        return;
      }

      const frame = copyDetectionFrame();
      if (!frame) {
        scheduleNext();
        return;
      }

      workerBusyRef.current = true;
      setStatus('detecting');
      worker.postMessage({
        type: 'detect',
        id: requestIdRef.current += 1,
        imageData: frame.imageData,
        scale: frame.scale,
        useCanny: useCannyRef.current,
      });
    }

    worker.addEventListener('message', handleWorkerMessage);
    const handleResize = () => drawOverlay(quadRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      worker.removeEventListener('message', handleWorkerMessage);
      worker.terminate();
      workerRef.current = null;
      workerBusyRef.current = false;
      drawOverlay(null);
    };
  }, [copyDetectionFrame, drawOverlay, enabled]);

  const captureImage = useCallback((): CaptureResult | null => {
    const canvas = copyFullVideoFrame();
    if (!canvas) return null;
    if (quadRef.current) return cropQuadBoundingBoxToJpeg(canvas, quadRef.current);
    return canvasToJpeg(canvas);
  }, [copyFullVideoFrame]);

  return { quad, status, debugText, captureImage };
}
