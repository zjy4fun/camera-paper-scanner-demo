export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

export type CaptureResult = {
  dataUrl: string;
  width: number;
  height: number;
};

function orderQuadPoints(points: Point[]): Quad {
  const sortedBySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const topLeft = sortedBySum[0];
  const bottomRight = sortedBySum[3];
  const remaining = [sortedBySum[1], sortedBySum[2]].sort((a, b) => a.x - b.x);
  const topRight = remaining[1];
  const bottomLeft = remaining[0];
  return [topLeft, topRight, bottomRight, bottomLeft];
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function detectDocumentQuad(cv: any, sourceCanvas: HTMLCanvasElement): Quad | null {
  let src: any;
  let gray: any;
  let blurred: any;
  let edges: any;
  let contours: any;
  let hierarchy: any;
  let approx: any;

  try {
    src = cv.imread(sourceCanvas);
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 75, 200);
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = sourceCanvas.width * sourceCanvas.height;
    let best: { area: number; points: Point[] } | null = null;

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      approx = new cv.Mat();
      const perimeter = cv.arcLength(contour, true);
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      const area = Math.abs(cv.contourArea(approx));

      if (approx.rows === 4 && area > imageArea * 0.08 && cv.isContourConvex(approx)) {
        const points: Point[] = [];
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

export function warpDocumentToJpeg(
  cv: any,
  sourceCanvas: HTMLCanvasElement,
  quad: Quad,
  quality = 0.92,
): CaptureResult {
  const [tl, tr, br, bl] = quad;
  const width = Math.max(Math.round(distance(tl, tr)), Math.round(distance(bl, br)), 1);
  const height = Math.max(Math.round(distance(tl, bl)), Math.round(distance(tr, br)), 1);

  let src: any;
  let dst: any;
  let srcTri: any;
  let dstTri: any;
  let matrix: any;

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;

  try {
    src = cv.imread(sourceCanvas);
    dst = new cv.Mat();

    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y,
    ]);

    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      width - 1, 0,
      width - 1, height - 1,
      0, height - 1,
    ]);

    matrix = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(src, dst, matrix, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    cv.imshow(outputCanvas, dst);

    return {
      dataUrl: outputCanvas.toDataURL('image/jpeg', quality),
      width,
      height,
    };
  } finally {
    src?.delete();
    dst?.delete();
    srcTri?.delete();
    dstTri?.delete();
    matrix?.delete();
  }
}
