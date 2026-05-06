import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { detectDocumentQuad, Quad, warpDocumentToJpeg, CaptureResult } from '../utils/imageProcessing';

export function useDocumentDetection(
  cv: any | null,
  videoRef: RefObject<HTMLVideoElement | null>,
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
) {
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const [quad, setQuad] = useState<Quad | null>(null);
  const quadRef = useRef<Quad | null>(null);

  const drawOverlay = useCallback((detectedQuad: Quad | null) => {
    const video = videoRef.current;
    const overlay = overlayCanvasRef.current;
    if (!video || !overlay || !video.videoWidth || !video.videoHeight) return;

    const rect = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.width = Math.round(rect.width * dpr);
    overlay.height = Math.round(rect.height * dpr);

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!detectedQuad) return;

    const scaleX = rect.width / video.videoWidth;
    const scaleY = rect.height / video.videoHeight;
    ctx.strokeStyle = '#00d084';
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(0, 208, 132, 0.6)';
    ctx.shadowBlur = 10;
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

  const copyVideoFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const canvas = hiddenCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, [videoRef]);

  useEffect(() => {
    if (!cv || !enabled) {
      setQuad(null);
      quadRef.current = null;
      drawOverlay(null);
      return;
    }

    const intervalId = window.setInterval(() => {
      const canvas = copyVideoFrame();
      if (!canvas) return;

      try {
        const detected = detectDocumentQuad(cv, canvas);
        quadRef.current = detected;
        setQuad(detected);
        drawOverlay(detected);
      } catch (err) {
        console.error('Document detection failed:', err);
        quadRef.current = null;
        setQuad(null);
        drawOverlay(null);
      }
    }, 200);

    const handleResize = () => drawOverlay(quadRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', handleResize);
      drawOverlay(null);
    };
  }, [copyVideoFrame, cv, drawOverlay, enabled]);

  const captureDocument = useCallback((): CaptureResult | null => {
    if (!cv || !quadRef.current) return null;
    const canvas = copyVideoFrame();
    if (!canvas) return null;
    return warpDocumentToJpeg(cv, canvas, quadRef.current);
  }, [copyVideoFrame, cv]);

  return { quad, captureDocument };
}
