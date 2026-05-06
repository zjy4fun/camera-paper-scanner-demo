import { useEffect, useRef, useState } from 'react';
import { CameraSelector } from './components/CameraSelector';
import { CameraPreview } from './components/CameraPreview';
import { CaptureList } from './components/CaptureList';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { useCameraDevices } from './hooks/useCameraDevices';
import { useCameraStream } from './hooks/useCameraStream';
import { useDocumentDetection } from './hooks/useDocumentDetection';
import { waitForOpenCVReady } from './utils/opencv';
import './styles.css';

export type CapturedImage = {
  id: string;
  dataUrl: string;
  createdAt: string;
  width: number;
  height: number;
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cv, setCv] = useState<any | null>(null);
  const [opencvError, setOpenCvError] = useState('');
  const [captureError, setCaptureError] = useState('');
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [previewImage, setPreviewImage] = useState<CapturedImage | null>(null);

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    loading,
    error: devicesError,
    refreshDevices,
  } = useCameraDevices();

  const { stream, error: streamError } = useCameraStream(selectedDeviceId);

  useEffect(() => {
    let cancelled = false;
    waitForOpenCVReady()
      .then((readyCv) => {
        if (!cancelled) setCv(readyCv);
      })
      .catch((err) => {
        if (!cancelled) setOpenCvError(err instanceof Error ? err.message : 'OpenCV.js 加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { quad, captureImage } = useDocumentDetection(cv, videoRef, overlayCanvasRef, Boolean(stream && cv));

  function handleCapture() {
    setCaptureError('');
    try {
      const result = captureImage();
      if (!result) {
        setCaptureError('截图失败，请确认摄像头画面已正常显示');
        return;
      }

      const now = new Date();
      const nextImage: CapturedImage = {
        id: `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        createdAt: now.toLocaleString('zh-CN', { hour12: false }),
      };

      setImages((current) => [nextImage, ...current].slice(0, 20));
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : '截图生成失败');
    }
  }

  const mainError = opencvError || devicesError || streamError;

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>摄像头纸张扫描 Demo</h1>
          <p>实时预览、纸张边缘检测、透视矫正截图。</p>
        </div>
        <CameraSelector
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          loading={loading}
          error={devicesError}
          onChange={setSelectedDeviceId}
          onRefresh={refreshDevices}
        />
      </header>

      {mainError && <div className="alert">{mainError}</div>}
      {!opencvError && !cv && <div className="notice">OpenCV.js 加载中...</div>}

      <div className="content-grid">
        <CameraPreview
          stream={stream}
          videoRef={videoRef}
          overlayCanvasRef={overlayCanvasRef}
          hasDocument={Boolean(quad)}
          disabled={!stream}
          error={captureError}
          onCapture={handleCapture}
        />
        <CaptureList images={images} onPreview={setPreviewImage} />
      </div>

      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </main>
  );
}
