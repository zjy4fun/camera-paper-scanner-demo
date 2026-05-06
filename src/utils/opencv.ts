let loadingPromise: Promise<any> | null = null;

export function waitForOpenCVReady(timeoutMs = 20_000): Promise<any> {
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const resolveIfReady = () => {
      const cv = window.cv;
      if (cv?.Mat && cv?.imread && cv?.getPerspectiveTransform) {
        resolve(cv);
        return true;
      }
      return false;
    };

    if (resolveIfReady()) return;

    let script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'opencv-script';
      script.async = true;
      script.src = `${import.meta.env.BASE_URL}opencv.js`;
      document.head.appendChild(script);
    }

    const check = () => {
      if (resolveIfReady()) return;

      if (Date.now() - startedAt > timeoutMs) {
        loadingPromise = null;
        reject(new Error('OpenCV.js 加载失败，请检查 public/opencv.js 是否可访问'));
        return;
      }

      window.setTimeout(check, 100);
    };

    script.addEventListener('error', () => {
      loadingPromise = null;
      reject(new Error('OpenCV.js 脚本加载失败'));
    }, { once: true });

    const maybeCv = window.cv;
    if (maybeCv) {
      const oldRuntimeInitialized = maybeCv.onRuntimeInitialized;
      maybeCv.onRuntimeInitialized = () => {
        oldRuntimeInitialized?.();
        resolve(window.cv);
      };
    }

    check();
  });

  return loadingPromise;
}
