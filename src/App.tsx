import { useRef, useState } from 'react';
import { CameraSelector } from './components/CameraSelector';
import { CameraPreview } from './components/CameraPreview';
import { CaptureList } from './components/CaptureList';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import { useCameraDevices } from './hooks/useCameraDevices';
import { useCameraStream } from './hooks/useCameraStream';
import { useDocumentDetection } from './hooks/useDocumentDetection';
import type { CaptureProcessingMode } from './utils/imageProcessing';
import './styles.css';

export type CapturedImage = {
  id: string;
  dataUrl: string;
  createdAt: string;
  width: number;
  height: number;
  mode?: CaptureProcessingMode;
  cropped?: boolean;
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [captureError, setCaptureError] = useState('');
  const [captureBusy, setCaptureBusy] = useState(false);
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

  const { stream, error: streamError, activeCameraLabel, activeCameraSettings } = useCameraStream(selectedDeviceId);
  const { quad, status: detectionStatus, debugText, captureImage } = useDocumentDetection(videoRef, overlayCanvasRef, Boolean(stream));

  async function handleCapture() {
    setCaptureError('');
    setCaptureBusy(true);

    try {
      const result = await captureImage();
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
        mode: result.mode,
        cropped: result.cropped,
        createdAt: now.toLocaleString('zh-CN', { hour12: false }),
      };

      setImages((current) => [nextImage, ...current].slice(0, 20));
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : '截图生成失败');
    } finally {
      setCaptureBusy(false);
    }
  }

  const mainError = devicesError || streamError;

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>摄像头纸张扫描 Demo</h1>
          <p>实时预览、轻量纸张区域检测、截图生成图片列表。</p>
        </div>
        <CameraSelector
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          loading={loading}
          error={devicesError}
          activeCameraLabel={activeCameraLabel}
          activeCameraSettings={activeCameraSettings}
          onChange={setSelectedDeviceId}
          onRefresh={refreshDevices}
        />
      </header>

      {mainError && <div className="alert">{mainError}</div>}

      <div className="content-grid">
        <CameraPreview
          stream={stream}
          videoRef={videoRef}
          overlayCanvasRef={overlayCanvasRef}
          hasDocument={Boolean(quad)}
          detectionStatus={detectionStatus}
          debugText={debugText}
          disabled={!stream || captureBusy}
          capturing={captureBusy}
          error={captureError}
          onCapture={handleCapture}
        />
        <CaptureList images={images} onPreview={setPreviewImage} />
      </div>

      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </main>
  );
}
