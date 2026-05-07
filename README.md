# Camera Paper Scanner Demo

纯前端网页 Demo：摄像头实时预览、OpenCV.js 纸张边缘检测、视频流叠加纸张轮廓、截图生成图片列表。

线上地址：<https://zjy4fun.github.io/camera-paper-scanner-demo/>

## 启动

```bash
npm install
npm run dev
```

然后打开 Vite 输出的 localhost 地址。摄像头能力要求安全上下文，localhost 和 HTTPS 页面可用。

## 构建

```bash
npm run build
```

项目通过 GitHub Actions 自动部署到 GitHub Pages：推送 `main` 分支后会构建 `dist/` 并发布。

## 功能

- 摄像头权限请求与设备列表枚举
- 切换摄像头时释放旧 MediaStream tracks
- 保留原有 video 实时预览和 overlay canvas 结构
- 使用 Web Worker 加载 OpenCV.js，避免主线程卡顿
- 视频流上实时绘制检测到的纸张四边形轮廓
  - 绿色线条：`#00ff00`
  - 线宽：`3px`
  - 四角圆点标记
- 页面显示检测状态：`Document detected` / `No document found`
- 截图时优先裁剪检测到的纸张区域；未检测到纸张时保存完整摄像头画面
- 右侧最多保留 20 张截图，支持缩略图和大图弹窗

## 文档边缘检测逻辑

检测逻辑运行在 `public/documentDetectionWorker.js` 中，OpenCV.js 使用同源加载的 `public/opencv.js`，避免 Worker 中跨域 `importScripts()` 失败。

每帧处理流程：

1. 从视频帧 downsample 到最大 640px 宽
2. RGBA → grayscale
3. GaussianBlur(5,5)
4. adaptiveThreshold 作为主检测路径
5. Canny(50,150) 作为弱边缘/光照不均场景的 fallback
6. findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
7. 过滤小轮廓：面积必须大于画面面积 15%
8. approxPolyDP(0.02 * perimeter) 逼近多边形
9. 保留 4–6 个顶点的候选轮廓
10. 选取面积最大的候选四边形作为纸张区域
11. 将 downsample 后坐标缩放回原始视频尺寸，并绘制到 overlay canvas

## iPhone / Continuity Camera 说明

macOS 上 iPhone 摄像头通常以 Continuity Camera 形式暴露给浏览器。项目做了几项兼容：

- 下拉列表始终提供“系统默认摄像头”，即使浏览器暂时没有枚举出具体设备也能尝试打开摄像头。
- 点击“授权/刷新”会先请求摄像头权限，并在短时间内重复枚举设备；这是因为 iPhone 摄像头可能在采集开始后才出现在 `enumerateDevices()` 结果里。
- 如果设备名称包含 `iPhone` / `Continuity` / `连续互通` / `接续互通`，会自动优先选择该摄像头。

如果 iPhone 仍未出现，请确认 iPhone 已解锁、靠近 Mac、两台设备使用同一 Apple ID 且开启 Wi‑Fi/蓝牙，然后在浏览器地址栏摄像头权限里允许本页面访问摄像头后刷新。

## 性能说明

- 检测频率限制为 10fps，即每 100ms 最多处理一帧。
- CV 处理放在 Worker 中，主线程只负责采集帧、更新状态和绘制 overlay。
- 每帧创建的 `cv.Mat`、`cv.MatVector`、`hierarchy`、`approx` 等对象都会在 `finally` 中释放，避免 OpenCV.js 内存泄漏。

## 目录说明

- `src/hooks/useDocumentDetection.ts`：采集视频帧、节流、Worker 通信、overlay 绘制、截图入口
- `public/documentDetectionWorker.js`：OpenCV.js 初始化和文档边缘检测管线
- `public/opencv.js`：同源 OpenCV.js 文件，供 Worker 加载
- `src/components/CameraPreview.tsx`：摄像头预览、状态文本和截图按钮
