/* global importScripts, cv */
let cvReadyPromise = null;
let cvInstance = null;

function loadOpenCV() {
  if (cvReadyPromise) return cvReadyPromise;

  cvReadyPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error('OpenCV.js worker 加载超时')), 20000);

    function done(instance) {
      if (!instance || typeof instance.Mat !== 'function') {
        return;
      }
      clearTimeout(timeoutId);
      cvInstance = instance;
      resolve(instance);
    }

    try {
      importScripts('./opencv.js');
      const candidate = self.cv || cv;
      if (candidate) {
        const previousInitialized = candidate.onRuntimeInitialized;
        candidate.onRuntimeInitialized = () => {
          previousInitialized?.();
          done(candidate);
        };
        done(candidate);
      }
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

function pointsFromMat(mat) {
  const points = [];
  for (let row = 0; row < mat.rows; row += 1) {
    points.push({ x: mat.intPtr(row, 0)[0], y: mat.intPtr(row, 0)[1] });
  }
  return points;
}

function addCandidate(opencv, candidate, best, imageArea) {
  const area = Math.abs(opencv.contourArea(candidate));
  if (area < imageArea * 0.025) return best;
  if (!opencv.isContourConvex(candidate)) return best;
  const points = pointsFromMat(candidate);
  if (points.length !== 4) return best;
  if (!best || area > best.area) return { area, points };
  return best;
}

function detectFromEdges(opencv, edges, imageArea) {
  const contours = new opencv.MatVector();
  const hierarchy = new opencv.Mat();
  let best = null;

  try {
    opencv.findContours(edges, contours, hierarchy, opencv.RETR_LIST, opencv.CHAIN_APPROX_SIMPLE);

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      let approx = null;
      let rectPointsMat = null;

      try {
        const contourArea = Math.abs(opencv.contourArea(contour));
        if (contourArea < imageArea * 0.02) continue;

        const perimeter = opencv.arcLength(contour, true);
        for (const epsilon of [0.015, 0.02, 0.03, 0.045, 0.06]) {
          approx = new opencv.Mat();
          opencv.approxPolyDP(contour, approx, epsilon * perimeter, true);
          if (approx.rows === 4) {
            best = addCandidate(opencv, approx, best, imageArea);
            approx.delete();
            approx = null;
            break;
          }
          approx.delete();
          approx = null;
        }

        if (!best && contourArea > imageArea * 0.08) {
          const rotatedRect = opencv.minAreaRect(contour);
          const points = opencv.RotatedRect.points(rotatedRect);
          rectPointsMat = opencv.matFromArray(4, 1, opencv.CV_32SC2, [
            Math.round(points[0].x), Math.round(points[0].y),
            Math.round(points[1].x), Math.round(points[1].y),
            Math.round(points[2].x), Math.round(points[2].y),
            Math.round(points[3].x), Math.round(points[3].y),
          ]);
          best = addCandidate(opencv, rectPointsMat, best, imageArea);
        }
      } finally {
        approx?.delete?.();
        rectPointsMat?.delete?.();
        contour.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }

  return best;
}


function fallbackBrightDocumentQuad(imageData) {
  const { width, height, data } = imageData;
  const step = 4;
  const marginX = Math.round(width * 0.02);
  const marginY = Math.round(height * 0.02);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let y = marginY; y < height - marginY; y += step) {
    for (let x = marginX; x < width - marginX; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const brightness = (r + g + b) / 3;
      const saturation = max - min;

      // White paper is usually bright and low-saturation. Keep this permissive for demo use.
      if (brightness > 145 && saturation < 80) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
  }

  const sampled = Math.max(1, Math.floor((width / step) * (height / step)));
  const coverage = count / sampled;
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  const area = boxWidth * boxHeight;

  if (coverage < 0.015 || area < width * height * 0.04 || boxWidth < width * 0.15 || boxHeight < height * 0.15) {
    return null;
  }

  const pad = Math.round(Math.min(width, height) * 0.015);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

function detectDocumentQuadFromImageData(opencv, imageData) {
  let src;
  let gray;
  let blurred;
  let edges;
  let kernel;

  try {
    src = new opencv.Mat(imageData.height, imageData.width, opencv.CV_8UC4);
    src.data.set(imageData.data);
    gray = new opencv.Mat();
    blurred = new opencv.Mat();
    edges = new opencv.Mat();
    kernel = opencv.Mat.ones(3, 3, opencv.CV_8U);

    opencv.cvtColor(src, gray, opencv.COLOR_RGBA2GRAY, 0);
    opencv.GaussianBlur(gray, blurred, new opencv.Size(5, 5), 0);

    const imageArea = imageData.width * imageData.height;
    let best = null;

    for (const [low, high] of [[40, 120], [60, 160], [80, 220]]) {
      opencv.Canny(blurred, edges, low, high);
      opencv.morphologyEx(edges, edges, opencv.MORPH_CLOSE, kernel);
      opencv.dilate(edges, edges, kernel);
      const candidate = detectFromEdges(opencv, edges, imageArea);
      if (candidate && (!best || candidate.area > best.area)) best = candidate;
      if (best && best.area > imageArea * 0.18) break;
    }

    return best ? orderQuadPoints(best.points) : fallbackBrightDocumentQuad(imageData);
  } finally {
    src?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    kernel?.delete();
  }
}

self.onmessage = async (event) => {
  const { type, id, imageData, scale } = event.data || {};
  if (type !== 'detect') return;

  const startedAt = performance.now();
  try {
    const opencv = cvInstance || await loadOpenCV();
    const smallQuad = detectDocumentQuadFromImageData(opencv, imageData) || fallbackBrightDocumentQuad(imageData);
    const quad = smallQuad
      ? smallQuad.map((point) => ({ x: point.x / scale, y: point.y / scale }))
      : null;

    self.postMessage({
      type: 'result',
      id,
      quad,
      durationMs: Math.round(performance.now() - startedAt),
      source: smallQuad ? 'detected' : 'none',
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
