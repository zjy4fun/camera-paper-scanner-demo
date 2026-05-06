import { RefObject, useEffect } from 'react';

type Props = {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  overlayCanvasRef: RefObject<HTMLCanvasElement | null>;
  hasDocument: boolean;
  disabled: boolean;
  error: string;
  onCapture: () => void;
};

export function CameraPreview({
  stream,
  videoRef,
  overlayCanvasRef,
  hasDocument,
  disabled,
  error,
  onCapture,
}: Props) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream, videoRef]);

  return (
    <section className="preview-card">
      <div className="video-wrap">
        <video ref={videoRef} autoPlay playsInline muted />
        <canvas ref={overlayCanvasRef} className="overlay" />
        {!stream && <div className="video-placeholder">等待摄像头画面...</div>}
      </div>

      <div className="preview-actions">
        <button type="button" onClick={onCapture} disabled={disabled || !stream}>
          截图
        </button>
        <span className={hasDocument ? 'status ok' : 'status'}>
          {hasDocument ? '已检测到纸张，截图将自动矫正' : '未检测到纸张，截图将保存完整画面'}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
