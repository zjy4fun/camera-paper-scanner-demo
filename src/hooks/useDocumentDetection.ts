import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { canvasToJpeg, Quad, warpDocumentToJpeg, CaptureResult } from '../utils/imageProcessing';

const DETECTION_INTERVAL_MS = 500;
const DETECTION_MAX_WIDTH = 640;

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: number; quad: Quad | null; durationMs: number }
  | { type: 'error'; id?: number; message: string };

export function useDocumentDetection(
  cv: any | null,
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  const fullFrameCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const detectionCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(false);
  const requestIdRef = useRef(0);
  const [quad, setQuad] = useState<Quad | null>(null);
  const quadRef = useRef<Quad | null>(null);

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

    const scaleX = rect.width / video.videoWidth;
    const scaleY = rect.height / video.videoHeight;
    ctx.strokeStyle = '#00d084';
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(0, 208, 132, 0.45)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    detectedQuad.forEach((point, index) => {
      const x = point.x * scaleX;
      const y = point.y * scaleY;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }, [overlayCanvasRef, videoRef]);

  const copyFullVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const canvas = fullFrameCanvasRef.current;
    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, [videoRef]);

  const copyDetectionImageData = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      return null;
    }

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
      setQuad(null);
      quadRef.current = null;
      drawOverlay(null);
      return;
    }

    let stopped = false;
    let timeoutId = 0;
    const worker = new Worker(`${import.meta.env.BASE_URL}documentDetectionWorker.js`);
    workerRef.current = worker;

    const scheduleNext = (delay = DETECTION_INTERVAL_MS) => {
      window.clearTimeout(timeoutId);
      if (!stopped) timeoutId = window.setTimeout(sendFrameToWorker, delay);
    };

    const sendFrameToWorker = () => {
      if (stopped || pendingRef.current) {
        scheduleNext(DETECTION_INTERVAL_MS);
        return;
      }

      const frame = copyDetectionImageData();
      if (!frame) {
        scheduleNext(DETECTION_INTERVAL_MS);
        return;
      }

      const id = requestIdRef.current + 1;
      requestIdRef.current = id;
      pendingRef.current = true;
      worker.postMessage(
        { type: 'detect', id, imageData: frame.imageData, scale: frame.scale },
        [frame.imageData.data.buffer],
      );
    };

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        scheduleNext(100);
        return;
      }

      if (message.type === 'result') {
        pendingRef.current = false;
        if (message.id !== requestIdRef.current) return;
        quadRef.current = message.quad;
        setQuad(message.quad);
        window.requestAnimationFrame(() => drawOverlay(message.quad));
        scheduleNext(Math.max(DETECTION_INTERVAL_MS, message.durationMs * 2));
        return;
      }

      if (message.type === 'error') {
        pendingRef.current = false;
        console.error('Document detection worker failed:', message.message);
        quadRef.current = null;
        setQuad(null);
        window.requestAnimationFrame(() => drawOverlay(null));
        scheduleNext(1200);
      }
    };

    worker.onerror = (event) => {
      pendingRef.current = false;
      console.error('Document detection worker error:', event.message);
      scheduleNext(1200);
    };

    const handleResize = () => window.requestAnimationFrame(() => drawOverlay(quadRef.current));
    window.addEventListener('resize', handleResize);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      pendingRef.current = false;
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      drawOverlay(null);
    };
  }, [copyDetectionImageData, drawOverlay, enabled]);

  const captureImage = useCallback((captureCv = cv): CaptureResult | null => {
    const canvas = copyFullVideoFrame();
    if (!canvas) return null;
    if (captureCv && quadRef.current) return warpDocumentToJpeg(captureCv, canvas, quadRef.current);
    return canvasToJpeg(canvas);
  }, [copyFullVideoFrame, cv]);

  return { quad, captureImage };
}
