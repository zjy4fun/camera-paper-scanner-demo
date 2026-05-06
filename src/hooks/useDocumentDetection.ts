import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { canvasToJpeg, cropQuadBoundingBoxToJpeg, Quad, CaptureResult } from '../utils/imageProcessing';

const DETECTION_INTERVAL_MS = 700;
const DETECTION_MAX_WIDTH = 480;

type DetectionStatus = 'idle' | 'ready' | 'detecting' | 'found' | 'not-found' | 'error';

function scaleQuad(quad: Quad, scale: number): Quad {
  return quad.map((point) => ({ x: point.x / scale, y: point.y / scale })) as Quad;
}

function detectBrightPaper(canvas: HTMLCanvasElement): Quad | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const step = 4;
  const marginX = Math.round(width * 0.02);
  const marginY = Math.round(height * 0.02);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let y = marginY; y < height - marginY; y += step) {
    for (let x = marginX; x < width - marginX; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const brightness = (r + g + b) / 3;
      const saturation = max - min;

      if (brightness > 145 && saturation < 85) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
  }

  const sampled = Math.max(1, Math.floor((width / step) * (height / step)));
  const coverage = count / sampled;
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const area = boxWidth * boxHeight;

  if (coverage < 0.012 || area < width * height * 0.035 || boxWidth < width * 0.12 || boxHeight < height * 0.12) {
    return null;
  }

  const pad = Math.round(Math.min(width, height) * 0.015);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function useDocumentDetection(
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  const fullFrameCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const detectionCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const runningRef = useRef(false);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [status, setStatus] = useState<DetectionStatus>('idle');
  const [debugText, setDebugText] = useState('等待摄像头');
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

    const videoAspect = video.videoWidth / video.videoHeight;
    const rectAspect = rect.width / rect.height;
    const contentWidth = rectAspect > videoAspect ? rect.height * videoAspect : rect.width;
    const contentHeight = rectAspect > videoAspect ? rect.height : rect.width / videoAspect;
    const offsetX = (rect.width - contentWidth) / 2;
    const offsetY = (rect.height - contentHeight) / 2;
    const scaleX = contentWidth / video.videoWidth;
    const scaleY = contentHeight / video.videoHeight;

    ctx.strokeStyle = '#00d084';
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(0, 208, 132, 0.45)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    detectedQuad.forEach((point, index) => {
      const x = offsetX + point.x * scaleX;
      const y = offsetY + point.y * scaleY;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
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
    return { canvas, scale };
  }, [videoRef]);

  useEffect(() => {
    if (!enabled) {
      setQuad(null);
      setStatus('idle');
      setDebugText('等待摄像头');
      quadRef.current = null;
      drawOverlay(null);
      return;
    }

    let stopped = false;
    let timeoutId = 0;
    setStatus('ready');
    setDebugText('轻量检测已就绪');

    const scheduleNext = (delay = DETECTION_INTERVAL_MS) => {
      window.clearTimeout(timeoutId);
      if (!stopped) timeoutId = window.setTimeout(runDetection, delay);
    };

    const runDetection = () => {
      if (stopped || runningRef.current) {
        scheduleNext(DETECTION_INTERVAL_MS);
        return;
      }

      runningRef.current = true;
      const startedAt = performance.now();
      setStatus('detecting');
      setDebugText('检测中');

      try {
        const frame = copyDetectionFrame();
        if (!frame) {
          scheduleNext(DETECTION_INTERVAL_MS);
          return;
        }

        const smallQuad = detectBrightPaper(frame.canvas);
        const detected = smallQuad ? scaleQuad(smallQuad, frame.scale) : null;
        const durationMs = Math.round(performance.now() - startedAt);
        quadRef.current = detected;
        setQuad(detected);
        setStatus(detected ? 'found' : 'not-found');
        setDebugText(detected ? `检测到纸张区域，耗时 ${durationMs}ms` : `未找到纸张区域，耗时 ${durationMs}ms`);
        window.requestAnimationFrame(() => drawOverlay(detected));
        scheduleNext(DETECTION_INTERVAL_MS);
      } catch (err) {
        const message = err instanceof Error ? err.message : '纸张检测失败';
        console.error('Document detection failed:', err);
        quadRef.current = null;
        setQuad(null);
        setStatus('error');
        setDebugText(message);
        window.requestAnimationFrame(() => drawOverlay(null));
        scheduleNext(1200);
      } finally {
        runningRef.current = false;
      }
    };

    scheduleNext(300);
    const handleResize = () => window.requestAnimationFrame(() => drawOverlay(quadRef.current));
    window.addEventListener('resize', handleResize);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      runningRef.current = false;
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
