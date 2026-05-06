let loadingPromise: Promise<any> | null = null;

function getReadyOpenCV() {
  const candidates = [(window as any).Module, window.cv];
  return candidates.find((candidate) => candidate && typeof candidate.Mat === 'function' && candidate.imread && candidate.getPerspectiveTransform);
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

    const previousModule = (window as any).Module ?? {};
    (window as any).Module = {
      ...previousModule,
      onRuntimeInitialized() {
        previousModule.onRuntimeInitialized?.();
        const ready = getReadyOpenCV() ?? (window as any).Module;
        if (ready && typeof ready.Mat === 'function') resolve(ready);
        else reject(new Error('OpenCV.js 已加载，但 Mat 构造器不可用'));
      },
      onAbort(error: unknown) {
        loadingPromise = null;
        reject(new Error(`OpenCV.js 加载失败: ${String(error)}`));
      },
    };

    let script = document.getElementById('opencv-script') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'opencv-script';
      script.async = true;
      script.src = `${import.meta.env.BASE_URL}opencv.js`;
      document.head.appendChild(script);
    }

    const check = () => {
      const ready = getReadyOpenCV();
      if (ready) {
        resolve(ready);
        return;
      }

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
