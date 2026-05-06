import { useEffect, useState } from 'react';

export function useCameraStream(deviceId: string) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!deviceId) {
      setStream(null);
      return;
    }

    let cancelled = false;
    let activeStream: MediaStream | null = null;

    async function start() {
      setError('');
      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }

        activeStream = nextStream;
        setStream(nextStream);
      } catch (err) {
        setStream(null);
        setError(err instanceof Error ? err.message : '打开摄像头失败');
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

  return { stream, error };
}
