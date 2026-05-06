import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { canvasToJpeg, detectDocumentQuad, Quad, warpDocumentToJpeg, CaptureResult } from '../utils/imageProcessing';

const DETECTION_INTERVAL_MS = 800;
const DETECTION_MAX_WIDTH = 640;

type DetectionStatus = 'idle' | 'loading' | 'ready' | 'detecting' | 'found' | 'not-found' | 'error';

function scaleQuad(quad: Quad, scale: number): Quad {
  return quad.map((point) => ({ x: point.x / scale, y: point.y / scale })) as Quad;
}

export function useDocumentDetection(
  cv: any | null,
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

  const copyDetectionFrame = useCallback(() => {
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

    if (!cv) {
      setQuad(null);
      setStatus('loading');
      setDebugText('OpenCV.js 加载中');
      quadRef.current = null;
      drawOverlay(null);
      return;
    }

    let stopped = false;
    let timeoutId = 0;
    setStatus('ready');
    setDebugText('OpenCV.js 已就绪');

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

      const execute = () => {
        try {
          const frame = copyDetectionFrame();
          if (!frame) {
            scheduleNext(DETECTION_INTERVAL_MS);
            return;
          }

          const smallQuad = detectDocumentQuad(cv, frame.canvas);
          const detected = smallQuad ? scaleQuad(smallQuad, frame.scale) : null;
          const durationMs = Math.round(performance.now() - startedAt);
          quadRef.current = detected;
          setQuad(detected);
          setStatus(detected ? 'found' : 'not-found');
          setDebugText(detected ? `检测到纸张，耗时 ${durationMs}ms` : `未找到候选，耗时 ${durationMs}ms`);
          window.requestAnimationFrame(() => drawOverlay(detected));
          scheduleNext(Math.max(DETECTION_INTERVAL_MS, durationMs * 2));
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

      const requestIdle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (requestIdle) {
        requestIdle(execute, { timeout: 500 });
      } else {
        globalThis.setTimeout(execute, 0);
      }
    };

    scheduleNext(200);
    const handleResize = () => window.requestAnimationFrame(() => drawOverlay(quadRef.current));
    window.addEventListener('resize', handleResize);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      runningRef.current = false;
      drawOverlay(null);
    };
  }, [copyDetectionFrame, cv, drawOverlay, enabled]);

  const captureImage = useCallback((captureCv = cv): CaptureResult | null => {
    const canvas = copyFullVideoFrame();
    if (!canvas) return null;
    if (captureCv && quadRef.current) return warpDocumentToJpeg(captureCv, canvas, quadRef.current);
    return canvasToJpeg(canvas);
  }, [copyFullVideoFrame, cv]);

  return { quad, status, debugText, captureImage };
}
