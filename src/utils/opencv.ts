export function waitForOpenCVReady(timeoutMs = 20_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = () => {
      const cv = window.cv;
      if (cv?.Mat && cv?.imread && cv?.getPerspectiveTransform) {
        resolve(cv);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('OpenCV.js 加载失败，请检查网络或改用本地 public/opencv.js'));
        return;
      }

      window.setTimeout(check, 100);
    };

    const script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    script?.addEventListener('error', () => {
      reject(new Error('OpenCV.js 脚本加载失败'));
    }, { once: true });

    if (window.cv) {
      const oldRuntimeInitialized = window.cv.onRuntimeInitialized;
      window.cv.onRuntimeInitialized = () => {
        oldRuntimeInitialized?.();
        resolve(window.cv);
      };
    }

    check();
  });
}
