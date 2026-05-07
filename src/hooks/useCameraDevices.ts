import { useCallback, useEffect, useState } from 'react';

export const DEFAULT_CAMERA_ID = '__default_camera__';

function preferCamera(devices: MediaDeviceInfo[], current: string) {
  const iphoneCamera = devices.find((device) => /iphone|continuity|连续互通|接续互通/i.test(device.label));
  if (current === DEFAULT_CAMERA_ID) return iphoneCamera?.deviceId ?? current;
  if (current && devices.some((device) => device.deviceId === current)) return current;

  return iphoneCamera?.deviceId ?? devices[0]?.deviceId ?? DEFAULT_CAMERA_ID;
}

async function enumerateVideoInputs() {
  const allDevices = await navigator.mediaDevices.enumerateDevices();
  return allDevices.filter((device) => device.kind === 'videoinput');
}

async function waitForStableVideoInputs(timeoutMs = 2500) {
  const startedAt = performance.now();
  let bestDevices = await enumerateVideoInputs();

  while (performance.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const nextDevices = await enumerateVideoInputs();
    if (nextDevices.length >= bestDevices.length) bestDevices = nextDevices;
    if (nextDevices.some((device) => /iphone|continuity|连续互通|接续互通/i.test(device.label))) return nextDevices;
  }

  return bestDevices;
}

export function useCameraDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(DEFAULT_CAMERA_ID);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持 navigator.mediaDevices，无法使用摄像头');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    let permissionStream: MediaStream | null = null;

    try {
      let videoInputs = await enumerateVideoInputs();
      const lacksLabels = videoInputs.length > 0 && videoInputs.every((device) => !device.label);

      if (videoInputs.length === 0 || lacksLabels) {
        // Keep the stream alive while enumerating. On macOS Continuity Camera can appear
        // shortly after capture starts; stopping immediately may miss the iPhone camera.
        permissionStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        videoInputs = await waitForStableVideoInputs();
      } else {
        videoInputs = await waitForStableVideoInputs(1000);
      }

      setDevices(videoInputs);
      setSelectedDeviceId((current) => preferCamera(videoInputs, current));

      if (videoInputs.length === 0) {
        setError('未检测到摄像头；可先尝试“系统默认摄像头”，或在浏览器权限里允许摄像头后刷新');
      }
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请授权后重试'
        : err instanceof Error ? err.message : '获取摄像头设备失败';
      setError(message);
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  return { devices, selectedDeviceId, setSelectedDeviceId, loading, error, refreshDevices };
}
