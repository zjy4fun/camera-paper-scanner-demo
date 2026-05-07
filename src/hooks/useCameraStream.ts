import { useEffect, useState } from 'react';
import { DEFAULT_CAMERA_ID } from './useCameraDevices';

export function useCameraStream(deviceId: string) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [activeCameraLabel, setActiveCameraLabel] = useState('');
  const [activeCameraSettings, setActiveCameraSettings] = useState<MediaTrackSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    async function start() {
      setError('');
      setActiveCameraLabel('');
      setActiveCameraSettings(null);
      try {
        const videoConstraints: MediaTrackConstraints = deviceId && deviceId !== DEFAULT_CAMERA_ID
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            };

        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }

        const [videoTrack] = nextStream.getVideoTracks();
        activeStream = nextStream;
        setStream(nextStream);
        setActiveCameraLabel(videoTrack?.label ?? '');
        setActiveCameraSettings(videoTrack?.getSettings?.() ?? null);
      } catch (err) {
        setStream(null);
        setActiveCameraLabel('');
        setActiveCameraSettings(null);
        const message = err instanceof DOMException && err.name === 'OverconstrainedError'
          ? '无法打开所选摄像头，请切换“系统默认摄像头”或刷新设备列表'
          : err instanceof Error ? err.message : '打开摄像头失败';
        setError(message);
      }
    }

    void start();

    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((track) => track.stop());
      setStream((current) => {
        current?.getTracks().forEach((track) => track.stop());
        return null;
      });
    };
  }, [deviceId]);

  return { stream, error, activeCameraLabel, activeCameraSettings };
}
