import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { canvasToJpeg, detectDocumentQuad, Quad, warpDocumentToJpeg, CaptureResult } from '../utils/imageProcessing';

const DETECTION_INTERVAL_MS = 800;
const DETECTION_MAX_WIDTH = 480;

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
  const [quad, setQuad] = useState<Quad | null>(null);
  const quadRef = useRef<Quad | null>(null);
  const runningRef = useRef(false);

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
    if (!cv || !enabled) {
      setQuad(null);
      quadRef.current = null;
      drawOverlay(null);
      return;
    }

    let stopped = false;
    let timeoutId = 0;

    const runDetection = () => {
      if (stopped) return;
      if (runningRef.current) {
        timeoutId = window.setTimeout(runDetection, DETECTION_INTERVAL_MS);
        return;
      }

      runningRef.current = true;
      try {
        const frame = copyDetectionFrame();
        if (!frame) return;

        const detectedSmall = detectDocumentQuad(cv, frame.canvas);
        const detected = detectedSmall ? scaleQuad(detectedSmall, frame.scale) : null;
        quadRef.current = detected;
        setQuad(detected);
        window.requestAnimationFrame(() => drawOverlay(detected));
      } catch (err) {
        console.error('Document detection failed:', err);
        quadRef.current = null;
        setQuad(null);
        window.requestAnimationFrame(() => drawOverlay(null));
      } finally {
        runningRef.current = false;
        timeoutId = window.setTimeout(runDetection, DETECTION_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(runDetection, 300);

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

  const captureImage = useCallback((): CaptureResult | null => {
    const canvas = copyFullVideoFrame();
    if (!canvas) return null;
    if (cv && quadRef.current) return warpDocumentToJpeg(cv, canvas, quadRef.current);
    return canvasToJpeg(canvas);
  }, [copyFullVideoFrame, cv]);

  return { quad, captureImage };
}
