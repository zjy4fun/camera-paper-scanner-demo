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
- OpenCV.js 灰度、模糊、Canny、轮廓查找、四边形近似
- 截图时对检测到的纸张做透视矫正；未检测到纸张时直接保存完整摄像头画面，生成 JPEG
- 右侧最多保留 20 张截图，支持缩略图和大图弹窗

## OpenCV.js

当前使用本地文件加载：`public/opencv.js`，会随 GitHub Pages 一起发布，避免第三方 CDN/跨域 403。
