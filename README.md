# Camera Paper Scanner Demo

纯前端网页 Demo：摄像头实时预览、OpenCV.js 纸张边缘检测、截图透视矫正、图片列表预览。

## 启动

```bash
npm install
npm run dev
```

然后打开 Vite 输出的 localhost 地址。摄像头能力要求安全上下文，localhost 可用。

## 功能

- 摄像头权限请求与设备列表枚举
- 切换摄像头时释放旧 MediaStream tracks
- video 实时预览 + canvas 叠加纸张轮廓
- 轻量 JS 纸张区域检测，避免 OpenCV.js 初始化导致页面卡死
- 截图时对检测到的纸张区域做矩形裁剪；未检测到纸张时直接保存完整摄像头画面，生成 JPEG
- 右侧最多保留 20 张截图，支持缩略图和大图弹窗

## 性能说明

当前线上 Demo 默认不加载 OpenCV.js，避免部分浏览器在初始化 OpenCV 时页面卡死。实时检测使用轻量 JS 亮色纸张区域估算；如需严格透视矫正，可后续改成独立 Worker 或服务端处理。
