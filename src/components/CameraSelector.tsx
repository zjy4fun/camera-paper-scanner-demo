import { DEFAULT_CAMERA_ID } from '../hooks/useCameraDevices';

type Props = {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  loading: boolean;
  error: string;
  onChange: (deviceId: string) => void;
  onRefresh: () => void;
};

export function CameraSelector({ devices, selectedDeviceId, loading, error, onChange, onRefresh }: Props) {
  return (
    <section className="camera-selector">
      <label htmlFor="camera-select">摄像头</label>
      <select
        id="camera-select"
        value={selectedDeviceId}
        onChange={(event) => onChange(event.target.value)}
        disabled={loading}
      >
        <option value={DEFAULT_CAMERA_ID}>系统默认摄像头</option>
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `摄像头 ${index + 1}`}
          </option>
        ))}
      </select>
      <button type="button" className="secondary" onClick={onRefresh} disabled={loading}>
        {loading ? '检测中...' : '授权/刷新'}
      </button>
      {error && <span className="inline-error">{error}</span>}
      <span className="camera-help">如果 iPhone 没出现，请保持 iPhone 解锁并靠近 Mac，点“授权/刷新”；也可先试“系统默认摄像头”。</span>
    </section>
  );
}
