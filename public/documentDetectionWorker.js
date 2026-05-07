/* global importScripts, cv */
const OPENCV_URL = './opencv.js';
const MIN_DOCUMENT_AREA_RATIO = 0.03;
const STRONG_DOCUMENT_AREA_RATIO = 0.06;
const MAX_DOCUMENT_AREA_RATIO = 0.96;
const MIN_RECT_FILL_RATIO = 0.35;
const FRAME_EDGE_MARGIN_RATIO = 0.012;
const BORDER_TOUCH_SCORE_PENALTY = 0.12;
const SINGLE_EDGE_SCORE_PENALTY = 0.65;
const APPROX_EPSILON_FACTORS = [0.02, 0.035, 0.05, 0.08];

let cvReadyPromise = null;
let cvInstance = null;

function postDebug(stage, detail = {}) {
  self.postMessage({ type: 'debug', stage, detail });
}

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
      postDebug('opencv-ready', { elapsedMs: Date.now() - startedAt });
      resolve();
      return true;
    }

    function fail(error) {
      if (resolved) return;
      resolved = true;
      postDebug('opencv-failed', {
        message: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      });
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
      postDebug('opencv-import-start', { url: OPENCV_URL });
      importScripts(OPENCV_URL);
      const candidate = self.cv || (typeof cv !== 'undefined' ? cv : null);
      postDebug('opencv-imported', {
        hasCv: Boolean(candidate),
        hasMat: typeof candidate?.Mat === 'function',
      });
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

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function getCandidateMetrics(points, contourArea, imageWidth, imageHeight) {
  const imageArea = imageWidth * imageHeight;
  const quadArea = polygonArea(points);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const marginX = Math.max(2, imageWidth * FRAME_EDGE_MARGIN_RATIO);
  const marginY = Math.max(2, imageHeight * FRAME_EDGE_MARGIN_RATIO);
  const touchCount = [
    minX <= marginX,
    minY <= marginY,
    maxX >= imageWidth - 1 - marginX,
    maxY >= imageHeight - 1 - marginY,
  ].filter(Boolean).length;

  return {
    quadArea,
    areaRatio: quadArea / imageArea,
    fillRatio: quadArea > 0 ? contourArea / quadArea : 0,
    touchCount,
  };
}

function isValidDocumentCandidate(metrics, minAreaRatio) {
  if (metrics.areaRatio < minAreaRatio) return false;
  if (metrics.areaRatio > MAX_DOCUMENT_AREA_RATIO) return false;
  if (metrics.fillRatio < MIN_RECT_FILL_RATIO) return false;
  if (metrics.touchCount >= 3 && metrics.areaRatio > 0.5) return false;
  return true;
}

function scoreDocumentCandidate(metrics) {
  let score = metrics.quadArea * Math.min(metrics.fillRatio, 1.2);
  if (metrics.touchCount >= 2) score *= BORDER_TOUCH_SCORE_PENALTY;
  else if (metrics.touchCount === 1) score *= SINGLE_EDGE_SCORE_PENALTY;
  if (metrics.areaRatio > 0.82) score *= 0.35;
  return score;
}

function getBestQuadrilateral(opencv, binary, imageWidth, imageHeight, minAreaRatio = MIN_DOCUMENT_AREA_RATIO) {
  const contours = new opencv.MatVector();
  const hierarchy = new opencv.Mat();
  let best = null;
  const imageArea = imageWidth * imageHeight;

  try {
    opencv.findContours(binary, contours, hierarchy, opencv.RETR_LIST, opencv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      let approx = null;

      try {
        const area = Math.abs(opencv.contourArea(contour));
        if (area < imageArea * minAreaRatio) continue;

        const perimeter = opencv.arcLength(contour, true);
        const candidates = [];

        for (const epsilonFactor of APPROX_EPSILON_FACTORS) {
          approx?.delete?.();
          approx = new opencv.Mat();
          opencv.approxPolyDP(contour, approx, epsilonFactor * perimeter, true);

          if (approx.rows < 4 || approx.rows > 10) continue;

          const points = approx.rows === 4 ? pointsFromMat(approx) : rectangleFromContour(opencv, contour);
          if (points.length === 4) candidates.push(points);
        }

        candidates.push(rectangleFromContour(opencv, contour));

        for (const points of candidates) {
          const pointsMat = opencv.matFromArray(4, 1, opencv.CV_32SC2, points.flatMap((point) => [point.x, point.y]));
          try {
            if (!opencv.isContourConvex(pointsMat)) continue;
          } finally {
            pointsMat.delete();
          }

          const metrics = getCandidateMetrics(points, area, imageWidth, imageHeight);
          if (!isValidDocumentCandidate(metrics, minAreaRatio)) continue;

          const score = scoreDocumentCandidate(metrics);
          if (!best || score > best.score) best = { score, points };
          break;
        }
      } finally {
        approx?.delete?.();
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }

  return best ? { ...best, points: orderQuadPoints(best.points) } : null;
}

function detectDocumentQuadFromImageData(opencv, imageData, useCanny) {
  let src;
  let rgb;
  let hsv;
  let gray;
  let blurred;
  let whiteMask;
  let whiteLower;
  let whiteUpper;
  let binary;
  let binaryInverse;
  let edges;
  let closed;
  let kernel;

  try {
    src = new opencv.Mat(imageData.height, imageData.width, opencv.CV_8UC4);
    src.data.set(imageData.data);
    rgb = new opencv.Mat();
    hsv = new opencv.Mat();
    gray = new opencv.Mat();
    blurred = new opencv.Mat();
    whiteMask = new opencv.Mat();
    binary = new opencv.Mat();
    binaryInverse = new opencv.Mat();
    edges = new opencv.Mat();
    closed = new opencv.Mat();
    kernel = opencv.Mat.ones(5, 5, opencv.CV_8U);

    opencv.cvtColor(src, rgb, opencv.COLOR_RGBA2RGB, 0);
    opencv.cvtColor(rgb, hsv, opencv.COLOR_RGB2HSV, 0);
    opencv.cvtColor(src, gray, opencv.COLOR_RGBA2GRAY, 0);
    opencv.GaussianBlur(gray, blurred, new opencv.Size(5, 5), 0);

    let best = null;

    function considerCandidate(candidate, source) {
      if (!candidate) return;
      if (!best || candidate.score > best.score) {
        best = { ...candidate, source };
      }
    }

    opencv.adaptiveThreshold(
      blurred,
      binary,
      255,
      opencv.ADAPTIVE_THRESH_GAUSSIAN_C,
      opencv.THRESH_BINARY,
      11,
      2,
    );
    considerCandidate(
      getBestQuadrilateral(opencv, binary, imageData.width, imageData.height, STRONG_DOCUMENT_AREA_RATIO),
      'threshold',
    );

    opencv.adaptiveThreshold(
      blurred,
      binaryInverse,
      255,
      opencv.ADAPTIVE_THRESH_GAUSSIAN_C,
      opencv.THRESH_BINARY_INV,
      11,
      2,
    );
    considerCandidate(
      getBestQuadrilateral(opencv, binaryInverse, imageData.width, imageData.height, STRONG_DOCUMENT_AREA_RATIO),
      'threshold-inverse',
    );

    if (!best || useCanny) {
      opencv.Canny(blurred, edges, 30, 120);
      opencv.morphologyEx(edges, closed, opencv.MORPH_CLOSE, kernel);
      opencv.dilate(closed, closed, kernel);
      considerCandidate(
        getBestQuadrilateral(opencv, closed, imageData.width, imageData.height, MIN_DOCUMENT_AREA_RATIO),
        'canny',
      );
    }

    whiteLower = new opencv.Mat(hsv.rows, hsv.cols, hsv.type(), new opencv.Scalar(0, 0, 95, 0));
    whiteUpper = new opencv.Mat(hsv.rows, hsv.cols, hsv.type(), new opencv.Scalar(180, 85, 255, 255));
    opencv.inRange(hsv, whiteLower, whiteUpper, whiteMask);
    opencv.morphologyEx(whiteMask, whiteMask, opencv.MORPH_CLOSE, kernel);
    opencv.morphologyEx(whiteMask, whiteMask, opencv.MORPH_OPEN, kernel);
    considerCandidate(
      getBestQuadrilateral(opencv, whiteMask, imageData.width, imageData.height, STRONG_DOCUMENT_AREA_RATIO),
      'white-mask',
    );

    return { quad: best?.points ?? null, source: best?.source ?? 'none' };
  } finally {
    src?.delete();
    rgb?.delete();
    hsv?.delete();
    gray?.delete();
    blurred?.delete();
    whiteMask?.delete();
    whiteLower?.delete();
    whiteUpper?.delete();
    binary?.delete();
    binaryInverse?.delete();
    edges?.delete();
    closed?.delete();
    kernel?.delete();
  }
}

self.onmessage = async (event) => {
  const { type, id, imageData, scale, useCanny = false } = event.data || {};
  if (type !== 'detect') return;

  const startedAt = performance.now();
  postDebug('detect-start', {
    id,
    width: imageData?.width,
    height: imageData?.height,
    scale,
    useCanny,
  });
  try {
    await loadOpenCV();
    const opencv = cvInstance;
    if (!opencv) throw new Error('OpenCV.js worker 未初始化完成：cvInstance 不可用');
    const result = detectDocumentQuadFromImageData(opencv, imageData, useCanny);
    const smallQuad = result.quad;
    const quad = smallQuad
      ? smallQuad.map((point) => ({ x: point.x / scale, y: point.y / scale }))
      : null;

    self.postMessage({
      type: 'result',
      id,
      quad,
      durationMs: Math.round(performance.now() - startedAt),
      source: result.source,
    });
    postDebug('detect-complete', {
      id,
      source: result.source,
      found: Boolean(quad),
      elapsedMs: Math.round(performance.now() - startedAt),
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
  .then(() => {
    postDebug('worker-ready-post');
    self.postMessage({ type: 'ready' });
  })
  .catch((error) => self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }));
