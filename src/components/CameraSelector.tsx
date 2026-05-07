import { DEFAULT_CAMERA_ID } from '../hooks/useCameraDevices';

type Props = {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  loading: boolean;
  error: string;
  activeCameraLabel: string;
  activeCameraSettings: MediaTrackSettings | null;
  onChange: (deviceId: string) => void;
  onRefresh: () => void;
};

function formatSettings(settings: MediaTrackSettings | null) {
  if (!settings) return '';
  const size = settings.width && settings.height ? `${settings.width}×${settings.height}` : '';
  const fps = settings.frameRate ? `${Math.round(settings.frameRate)}fps` : '';
  return [size, fps].filter(Boolean).join(' / ');
}

export function CameraSelector({
  devices,
  selectedDeviceId,
  loading,
  error,
  activeCameraLabel,
  activeCameraSettings,
  onChange,
  onRefresh,
}: Props) {
  const hasIPhoneCamera = devices.some((device) => /iphone|continuity|连续互通|接续互通/i.test(device.label));
  const activeSettingsText = formatSettings(activeCameraSettings);

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

      {activeCameraLabel && (
        <span className="camera-active">
          当前打开：{activeCameraLabel}{activeSettingsText ? `（${activeSettingsText}）` : ''}
        </span>
      )}
      {error && <span className="inline-error">{error}</span>}
      {!hasIPhoneCamera && (
        <span className="camera-help">
          浏览器当前没有枚举到 iPhone 摄像头。网页只能使用浏览器通过 WebRTC 暴露的摄像头；QuickTime 能用不代表浏览器一定会列出。请在浏览器地址栏摄像头权限/网站设置里把 Camera 设为 iPhone，或用 Safari 再试。
        </span>
      )}
      <details className="camera-debug">
        <summary>摄像头调试信息</summary>
        <ul>
          <li>枚举到 {devices.length} 个视频输入设备</li>
          {devices.map((device, index) => (
            <li key={device.deviceId}>
              {index + 1}. {device.label || '(无名称，通常表示权限未完全授予)'}
            </li>
          ))}
          {activeCameraLabel && <li>当前 MediaStream track：{activeCameraLabel}</li>}
        </ul>
      </details>
    </section>
  );
}
