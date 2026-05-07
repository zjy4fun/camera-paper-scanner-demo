import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { canvasToJpeg, cropQuadBoundingBoxToJpeg, Quad, CaptureResult, CaptureProcessingMode } from '../utils/imageProcessing';

const DETECTION_INTERVAL_MS = 100;
const DETECTION_MAX_WIDTH = 640;
const CONSOLE_LOG_INTERVAL_MS = 500;

console.log('[document-detection] module-loaded', {
  detectionIntervalMs: DETECTION_INTERVAL_MS,
  detectionMaxWidth: DETECTION_MAX_WIDTH,
});

type DetectionStatus = 'idle' | 'ready' | 'detecting' | 'found' | 'not-found' | 'error';

type WorkerResult = {
  type: 'ready' | 'result' | 'capture-result' | 'error' | 'debug';
  id?: number;
  quad?: Quad | null;
  imageData?: ImageData;
  width?: number;
  height?: number;
  mode?: CaptureProcessingMode;
  cropped?: boolean;
  durationMs?: number;
  source?: 'white-mask' | 'threshold' | 'threshold-inverse' | 'canny' | 'none';
  message?: string;
  stage?: string;
  detail?: Record<string, unknown>;
};

type CaptureRequest = {
  id: number;
  resolve: (result: CaptureResult) => void;
  reject: (error: Error) => void;
  timeoutId: number;
};

function imageDataToJpeg(imageData: ImageData, quality = 0.92): CaptureResult {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('截图处理失败：无法创建输出画布');
  ctx.putImageData(imageData, 0, 0);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    width: imageData.width,
    height: imageData.height,
  };
}

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
  const captureRequestRef = useRef<CaptureRequest | null>(null);
  const lastConsoleLogRef = useRef<Record<string, number>>({});
  const [quad, setQuad] = useState<Quad | null>(null);
  const [status, setStatus] = useState<DetectionStatus>('idle');
  const [debugText, setDebugText] = useState('No document found');

  const logDetectionEvent = useCallback((eventName: string, payload: Record<string, unknown> = {}, throttleMs = 0) => {
    const now = performance.now();
    const lastTime = lastConsoleLogRef.current[eventName] ?? 0;
    if (throttleMs > 0 && now - lastTime < throttleMs) return;

    lastConsoleLogRef.current[eventName] = now;
    console.log('[document-detection]', eventName, payload);
  }, []);

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
    logDetectionEvent('effect-run', { enabled });

    if (!enabled) {
      const video = videoRef.current;
      logDetectionEvent('disabled', {
        reason: 'stream not ready',
        readyState: video?.readyState ?? null,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
      }, 1000);
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
    let worker: Worker | null = null;

    function scheduleNext(delay = DETECTION_INTERVAL_MS) {
      window.clearTimeout(timeoutId);
      if (!stopped) timeoutId = window.setTimeout(runDetection, delay);
    }

    const handleWorkerMessage = (event: MessageEvent<WorkerResult>) => {
      const data = event.data;
      if (stopped) return;

      if (data.type === 'debug') {
        logDetectionEvent(`worker-debug:${data.stage ?? 'unknown'}`, data.detail ?? {}, data.stage?.startsWith('detect-') ? 1000 : 0);
        return;
      }

      if (data.type === 'ready') {
        logDetectionEvent('worker-ready');
        scheduleNext(0);
        return;
      }

      if (data.type === 'capture-result') {
        const pendingCapture = captureRequestRef.current;
        if (pendingCapture && pendingCapture.id === data.id && data.imageData) {
          window.clearTimeout(pendingCapture.timeoutId);
          captureRequestRef.current = null;
          workerBusyRef.current = false;
          const result = {
            ...imageDataToJpeg(data.imageData),
            mode: data.mode,
            cropped: data.cropped,
          };
          pendingCapture.resolve(result);
          logDetectionEvent('capture-worker-complete', {
            id: data.id,
            mode: data.mode ?? 'image',
            cropped: Boolean(data.cropped),
            width: result.width,
            height: result.height,
            durationMs: data.durationMs,
          });
          scheduleNext();
        }
        return;
      }

      workerBusyRef.current = false;

      if (data.type === 'error') {
        const pendingCapture = captureRequestRef.current;
        if (pendingCapture && pendingCapture.id === data.id) {
          window.clearTimeout(pendingCapture.timeoutId);
          captureRequestRef.current = null;
          pendingCapture.reject(new Error(data.message || '截图处理失败'));
          scheduleNext(500);
          return;
        }

        logDetectionEvent('worker-error', {
          id: data.id,
          message: data.message,
        });
        quadRef.current = null;
        setQuad(null);
        setStatus('error');
        setDebugText(data.message || 'No document found');
        drawOverlay(null);
        scheduleNext(500);
        return;
      }

      const detected = data.quad || null;
      const durationText = typeof data.durationMs === 'number' ? ` · ${data.durationMs}ms` : '';
      const sourceText = data.source && data.source !== 'none' ? ` · ${data.source}` : '';
      logDetectionEvent(detected ? 'result-found' : 'result-none', {
        id: data.id,
        found: Boolean(detected),
        source: data.source ?? 'none',
        durationMs: data.durationMs,
        quad: detected,
      }, CONSOLE_LOG_INTERVAL_MS);
      quadRef.current = detected;
      setQuad(detected);
      setStatus(detected ? 'found' : 'not-found');
      setDebugText(detected ? `Document detected${sourceText}${durationText}` : `No document found${durationText}`);
      useCannyRef.current = !detected;
      drawOverlay(detected);
      scheduleNext();
    };

    function runDetection() {
      if (captureRequestRef.current) {
        scheduleNext();
        return;
      }

      if (stopped || workerBusyRef.current) {
        if (workerBusyRef.current) {
          logDetectionEvent('worker-busy', undefined, 1000);
        }
        scheduleNext();
        return;
      }

      const frame = copyDetectionFrame();
      if (!frame) {
        const video = videoRef.current;
        logDetectionEvent('frame-unavailable', {
          readyState: video?.readyState ?? null,
          videoWidth: video?.videoWidth ?? 0,
          videoHeight: video?.videoHeight ?? 0,
        }, 1000);
        scheduleNext();
        return;
      }

      workerBusyRef.current = true;
      setStatus('detecting');
      const nextId = requestIdRef.current + 1;
      logDetectionEvent('detect-frame', {
        id: nextId,
        width: frame.imageData.width,
        height: frame.imageData.height,
        scale: frame.scale,
        useCanny: useCannyRef.current,
      }, 1000);
      worker?.postMessage({
        type: 'detect',
        id: requestIdRef.current += 1,
        imageData: frame.imageData,
        scale: frame.scale,
        useCanny: useCannyRef.current,
      });
    }

    function handleWorkerRuntimeError(event: ErrorEvent) {
      if (stopped) return;
      workerBusyRef.current = false;
      logDetectionEvent('worker-runtime-error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
      setStatus('error');
      setDebugText(event.message || 'Worker runtime error');
    }

    function handleWorkerMessageError() {
      if (stopped) return;
      workerBusyRef.current = false;
      logDetectionEvent('worker-message-error');
      setStatus('error');
      setDebugText('Worker message error');
    }

    const workerUrl = `${import.meta.env.BASE_URL}documentDetectionWorker.js`;
    worker = new Worker(workerUrl);
    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', handleWorkerRuntimeError);
    worker.addEventListener('messageerror', handleWorkerMessageError);
    logDetectionEvent('worker-start', { workerUrl });
    workerRef.current = worker;
    setStatus('ready');
    setDebugText('No document found');

    const handleResize = () => drawOverlay(quadRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      stopped = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      worker?.removeEventListener('message', handleWorkerMessage);
      worker?.removeEventListener('error', handleWorkerRuntimeError);
      worker?.removeEventListener('messageerror', handleWorkerMessageError);
      worker?.terminate();
      if (captureRequestRef.current) {
        window.clearTimeout(captureRequestRef.current.timeoutId);
        captureRequestRef.current.reject(new Error('截图处理已取消'));
        captureRequestRef.current = null;
      }
      logDetectionEvent('worker-stop');
      workerRef.current = null;
      workerBusyRef.current = false;
      drawOverlay(null);
    };
  }, [copyDetectionFrame, drawOverlay, enabled, logDetectionEvent, videoRef]);

  const captureImage = useCallback(async (): Promise<CaptureResult | null> => {
    const canvas = copyFullVideoFrame();
    if (!canvas) return null;
    const startedAt = performance.now();
    const detectedQuad = quadRef.current;
    logDetectionEvent('capture-start', {
      width: canvas.width,
      height: canvas.height,
      hasQuad: Boolean(detectedQuad),
    });

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const worker = workerRef.current;
      if (!worker) throw new Error('截图处理 Worker 未就绪');

      const result = await new Promise<CaptureResult>((resolve, reject) => {
        const id = requestIdRef.current + 1;
        requestIdRef.current = id;
        const timeoutId = window.setTimeout(() => {
          if (captureRequestRef.current?.id === id) {
            captureRequestRef.current = null;
            workerBusyRef.current = false;
            reject(new Error('截图处理超时，请稍后重试'));
          }
        }, 30000);

        captureRequestRef.current = { id, resolve, reject, timeoutId };
        workerBusyRef.current = true;
        worker.postMessage({
          type: 'capture',
          id,
          imageData,
          quad: detectedQuad,
        });
      });
      logDetectionEvent('capture-complete', {
        mode: result.mode ?? 'image',
        cropped: Boolean(result.cropped),
        width: result.width,
        height: result.height,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return result;
    } catch (error) {
      console.warn('[document-detection] capture-processing-fallback', error);
    }

    if (detectedQuad) return cropQuadBoundingBoxToJpeg(canvas, detectedQuad);
    return canvasToJpeg(canvas);
  }, [copyFullVideoFrame, logDetectionEvent]);

  return { quad, status, debugText, captureImage };
}
