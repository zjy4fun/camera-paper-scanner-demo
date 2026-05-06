let loadingPromise: Promise<any> | null = null;

function getReadyOpenCV() {
  const cv = window.cv;
  return cv && typeof cv.Mat === 'function' && cv.imread && cv.getPerspectiveTransform ? cv : null;
}

export function waitForOpenCVReady(timeoutMs = 20_000): Promise<any> {
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const existing = getReadyOpenCV();
    if (existing) {
      resolve(existing);
      return;
    }

    let script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'opencv-script';
      script.async = true;
      script.src = `${import.meta.env.BASE_URL}opencv.js`;
      document.head.appendChild(script);
    }

    const attachRuntimeHook = () => {
      const cv = window.cv;
      if (!cv) return;
      const previousInitialized = cv.onRuntimeInitialized;
      cv.onRuntimeInitialized = () => {
        previousInitialized?.();
        const ready = getReadyOpenCV();
        if (ready) resolve(ready);
      };
    };

    const check = () => {
      const ready = getReadyOpenCV();
      if (ready) {
        resolve(ready);
        return;
      }

      attachRuntimeHook();

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

    check();
  });

  return loadingPromise;
}
