/* global importScripts, cv */
let cvReadyPromise = null;
let cvInstance = null;

function loadOpenCV() {
  if (cvReadyPromise) return cvReadyPromise;

  cvReadyPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('OpenCV WASM worker 加载超时')), 20000);

    function done(instance) {
      clearTimeout(timeoutId);
      cvInstance = instance;
      resolve(instance);
    }

    self.Module = {
      onRuntimeInitialized() {
        done(self.Module || self.cv || cv);
      },
      onAbort(error) {
        clearTimeout(timeoutId);
        reject(new Error(`OpenCV WASM worker 加载失败: ${error}`));
      },
    };

    try {
      importScripts('./opencv.js');
      const maybeCv = self.cv || self.Module;
      if (maybeCv?.Mat && maybeCv?.matFromImageData) done(maybeCv);
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });

  return cvReadyPromise;
}

function orderQuadPoints(points) {
  const sortedBySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const topLeft = sortedBySum[0];
  const bottomRight = sortedBySum[3];
  const remaining = [sortedBySum[1], sortedBySum[2]].sort((a, b) => a.x - b.x);
  return [topLeft, remaining[1], bottomRight, remaining[0]];
}

function detectDocumentQuadFromImageData(opencv, imageData) {
  let src;
  let gray;
  let blurred;
  let edges;
  let contours;
  let hierarchy;
  let approx;

  try {
    src = opencv.matFromImageData(imageData);
    gray = new opencv.Mat();
    blurred = new opencv.Mat();
    edges = new opencv.Mat();
    contours = new opencv.MatVector();
    hierarchy = new opencv.Mat();

    opencv.cvtColor(src, gray, opencv.COLOR_RGBA2GRAY, 0);
    opencv.GaussianBlur(gray, blurred, new opencv.Size(5, 5), 0);
    opencv.Canny(blurred, edges, 75, 200);
    opencv.findContours(edges, contours, hierarchy, opencv.RETR_EXTERNAL, opencv.CHAIN_APPROX_SIMPLE);

    const imageArea = imageData.width * imageData.height;
    let best = null;

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      approx = new opencv.Mat();
      const perimeter = opencv.arcLength(contour, true);
      opencv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      const area = Math.abs(opencv.contourArea(approx));

      if (approx.rows === 4 && area > imageArea * 0.08 && opencv.isContourConvex(approx)) {
        const points = [];
        for (let row = 0; row < 4; row += 1) {
          points.push({ x: approx.intPtr(row, 0)[0], y: approx.intPtr(row, 0)[1] });
        }
        if (!best || area > best.area) best = { area, points };
      }

      approx.delete();
      contour.delete();
      approx = null;
    }

    return best ? orderQuadPoints(best.points) : null;
  } finally {
    src?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    contours?.delete();
    hierarchy?.delete();
    approx?.delete?.();
  }
}

self.onmessage = async (event) => {
  const { type, id, imageData, scale } = event.data || {};
  if (type !== 'detect') return;

  const startedAt = performance.now();
  try {
    const opencv = cvInstance || await loadOpenCV();
    const smallQuad = detectDocumentQuadFromImageData(opencv, imageData);
    const quad = smallQuad
      ? smallQuad.map((point) => ({ x: point.x / scale, y: point.y / scale }))
      : null;

    self.postMessage({
      type: 'result',
      id,
      quad,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

void loadOpenCV()
  .then(() => self.postMessage({ type: 'ready' }))
  .catch((error) => self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }));
