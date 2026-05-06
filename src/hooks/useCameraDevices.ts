import { useCallback, useEffect, useState } from 'react';

export function useCameraDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
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

    try {
      let allDevices = await navigator.mediaDevices.enumerateDevices();
      let videoInputs = allDevices.filter((device) => device.kind === 'videoinput');

      const lacksLabels = videoInputs.length > 0 && videoInputs.every((device) => !device.label);
      if (videoInputs.length === 0 || lacksLabels) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        permissionStream.getTracks().forEach((track) => track.stop());
        allDevices = await navigator.mediaDevices.enumerateDevices();
        videoInputs = allDevices.filter((device) => device.kind === 'videoinput');
      }

      setDevices(videoInputs);
      setSelectedDeviceId((current) => {
        if (current && videoInputs.some((device) => device.deviceId === current)) return current;
        return videoInputs[0]?.deviceId ?? '';
      });

      if (videoInputs.length === 0) setError('未检测到摄像头');
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请授权后重试'
        : err instanceof Error ? err.message : '获取摄像头设备失败';
      setError(message);
    } finally {
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
