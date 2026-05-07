/* global importScripts, cv */
const OPENCV_URL = './opencv.js';
const MIN_DOCUMENT_AREA_RATIO = 0.15;

let cvReadyPromise = null;
let cvInstance = null;

function loadOpenCV() {
  if (cvReadyPromise) return cvReadyPromise;

  cvReadyPromise = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timeoutMs = 20000;
    let resolved = false;

    function done(instance) {
      if (resolved || !instance || typeof instance.Mat !== 'function') return false;
      resolved = true;
      cvInstance = instance;
      resolve(instance);
      return true;
    }

    function fail(error) {
      if (resolved) return;
      resolved = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    function pollReady() {
      const candidate = self.cv || (typeof cv !== 'undefined' ? cv : null);
      if (done(candidate)) return;
      if (Date.now() - startedAt > timeoutMs) {
        fail(new Error('OpenCV.js worker 加载超时：cv.Mat 不可用'));
        return;
      }
      setTimeout(pollReady, 50);
    }

    try {
      importScripts(OPENCV_URL);
      const candidate = self.cv || (typeof cv !== 'undefined' ? cv : null);
      if (candidate) {
        const previousInitialized = candidate.onRuntimeInitialized;
        candidate.onRuntimeInitialized = () => {
          previousInitialized?.();
          done(candidate);
        };
      }
      pollReady();
    } catch (error) {
      fail(error);
    }
  });

  return cvReadyPromise;
}

function orderQuadPoints(points) {
  const sortedBySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const topLeft = sortedBySum[0];
  const bottomRight = sortedBySum[sortedBySum.length - 1];
  const remaining = sortedBySum.slice(1, -1).sort((a, b) => a.x - b.x);
  const topRight = remaining[remaining.length - 1];
  const bottomLeft = remaining[0];
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function pointsFromMat(mat) {
  const points = [];
  for (let row = 0; row < mat.rows; row += 1) {
    points.push({ x: mat.intPtr(row, 0)[0], y: mat.intPtr(row, 0)[1] });
  }
  return points;
}

function rectangleFromContour(opencv, contour) {
  const rect = opencv.minAreaRect(contour);
  const points = opencv.RotatedRect.points(rect);
  return points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
}

function getBestQuadrilateral(opencv, binary, imageArea) {
  const contours = new opencv.MatVector();
  const hierarchy = new opencv.Mat();
  let best = null;

  try {
    opencv.findContours(binary, contours, hierarchy, opencv.RETR_EXTERNAL, opencv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      let approx = null;

      try {
        const area = Math.abs(opencv.contourArea(contour));
        if (area < imageArea * MIN_DOCUMENT_AREA_RATIO) continue;

        const perimeter = opencv.arcLength(contour, true);
        approx = new opencv.Mat();
        opencv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

        if (approx.rows < 4 || approx.rows > 6) continue;

        const points = approx.rows === 4 ? pointsFromMat(approx) : rectangleFromContour(opencv, contour);
        if (points.length !== 4) continue;

        const pointsMat = opencv.matFromArray(4, 1, opencv.CV_32SC2, points.flatMap((point) => [point.x, point.y]));
        try {
          if (!opencv.isContourConvex(pointsMat)) continue;
        } finally {
          pointsMat.delete();
        }

        if (!best || area > best.area) best = { area, points };
      } finally {
        approx?.delete?.();
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }

  return best ? orderQuadPoints(best.points) : null;
}

function detectDocumentQuadFromImageData(opencv, imageData, useCanny) {
  let src;
  let gray;
  let blurred;
  let binary;
  let edges;

  try {
    src = new opencv.Mat(imageData.height, imageData.width, opencv.CV_8UC4);
    src.data.set(imageData.data);
    gray = new opencv.Mat();
    blurred = new opencv.Mat();
    binary = new opencv.Mat();
    edges = new opencv.Mat();

    opencv.cvtColor(src, gray, opencv.COLOR_RGBA2GRAY, 0);
    opencv.GaussianBlur(gray, blurred, new opencv.Size(5, 5), 0);

    const imageArea = imageData.width * imageData.height;
    let quad = null;

    opencv.adaptiveThreshold(
      blurred,
      binary,
      255,
      opencv.ADAPTIVE_THRESH_GAUSSIAN_C,
      opencv.THRESH_BINARY,
      11,
      2,
    );
    quad = getBestQuadrilateral(opencv, binary, imageArea);

    if (!quad || useCanny) {
      opencv.Canny(blurred, edges, 50, 150);
      quad = getBestQuadrilateral(opencv, edges, imageArea) || quad;
    }

    return quad;
  } finally {
    src?.delete();
    gray?.delete();
    blurred?.delete();
    binary?.delete();
    edges?.delete();
  }
}

self.onmessage = async (event) => {
  const { type, id, imageData, scale, useCanny = false } = event.data || {};
  if (type !== 'detect') return;

  const startedAt = performance.now();
  try {
    const opencv = cvInstance || await loadOpenCV();
    const smallQuad = detectDocumentQuadFromImageData(opencv, imageData, useCanny);
    const quad = smallQuad
      ? smallQuad.map((point) => ({ x: point.x / scale, y: point.y / scale }))
      : null;

    self.postMessage({
      type: 'result',
      id,
      quad,
      durationMs: Math.round(performance.now() - startedAt),
      source: smallQuad ? (useCanny ? 'canny' : 'threshold') : 'none',
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
