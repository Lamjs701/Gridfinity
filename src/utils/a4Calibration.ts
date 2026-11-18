import { Point2D } from '../types';
import { simplifyContour } from './geometry';

export type A4Orientation = 'portrait' | 'landscape';

export const A4_WIDTH_MM = 210.0;
export const A4_HEIGHT_MM = 297.0;

export function getA4DimensionsMm(orientation: A4Orientation): { widthMm: number; heightMm: number } {
  return orientation === 'portrait'
    ? { widthMm: A4_WIDTH_MM, heightMm: A4_HEIGHT_MM }
    : { widthMm: A4_HEIGHT_MM, heightMm: A4_WIDTH_MM };
}

/**
 * 3x3 Homography matrix represented as flat 9-element array (row-major).
 */
export type HomographyMatrix = [
  number, number, number,
  number, number, number,
  number, number, number
];

/**
 * Solves an 8x8 linear system using Gaussian elimination with partial pivoting
 * to find the projective transformation (homography) mapping 4 source points -> 4 dest points.
 */
export function computeHomography(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D]
): HomographyMatrix {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  // Gaussian elimination with partial pivoting
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxVal) {
        maxVal = Math.abs(A[row][col]);
        pivotRow = row;
      }
    }

    if (pivotRow !== col) {
      [A[col], A[pivotRow]] = [A[pivotRow], A[col]];
      [b[col], b[pivotRow]] = [b[pivotRow], b[col]];
    }

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-10) {
      // Degenerate quad fallback: identity-like
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    }

    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / pivot;
      for (let j = col; j < n; j++) {
        A[row][j] -= factor * A[col][j];
      }
      b[row] -= factor * b[col];
    }
  }

  const h = new Array(8).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * h[j];
    }
    h[i] = sum / A[i][i];
  }

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Applies a 3x3 homography matrix to a 2D point.
 */
export function applyHomography(H: HomographyMatrix, p: Point2D): Point2D {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-10) return { x: p.x, y: p.y };
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * Traces the outer contour of the largest foreground object in a binary mask
 * using Moore-Neighbor boundary tracing.
 * Returns ordered polygon points in pixel coordinates of the mask.
 */
export function traceLargestObjectContour(
  mask: Uint8Array,
  width: number,
  height: number
): Point2D[] {
  // 1. Connected component labeling (4-connectivity) to find the largest object
  const labels = new Int32Array(width * height);
  let nextLabel = 1;
  const areaByLabel: number[] = [0];
  const queue = new Int32Array(width * height);

  // Ignore 2px border to prevent touching edge artifacts
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && labels[idx] === 0) {
        const label = nextLabel++;
        let area = 0;
        let head = 0;
        let tail = 0;
        queue[tail++] = idx;
        labels[idx] = label;

        while (head < tail) {
          const curr = queue[head++];
          area++;
          const cx = curr % width;
          const cy = (curr - cx) / width;

          if (cx > 1) {
            const n = curr - 1;
            if (mask[n] === 1 && labels[n] === 0) {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
          if (cx < width - 2) {
            const n = curr + 1;
            if (mask[n] === 1 && labels[n] === 0) {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
          if (cy > 1) {
            const n = curr - width;
            if (mask[n] === 1 && labels[n] === 0) {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
          if (cy < height - 2) {
            const n = curr + width;
            if (mask[n] === 1 && labels[n] === 0) {
              labels[n] = label;
              queue[tail++] = n;
            }
          }
        }
        areaByLabel.push(area);
      }
    }
  }

  if (nextLabel === 1) return [];

  // Find largest component label (ignore tiny specks < 25px)
  let bestLabel = 0;
  let bestArea = 25;
  for (let l = 1; l < areaByLabel.length; l++) {
    if (areaByLabel[l] > bestArea) {
      bestArea = areaByLabel[l];
      bestLabel = l;
    }
  }
  if (bestLabel === 0) return [];

  // 2. Find top-most left-most starting pixel of bestLabel
  let startX = -1;
  let startY = -1;
  outer: for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (labels[y * width + x] === bestLabel) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX === -1) return [];

  // 3. Moore-Neighbor Tracing (clockwise 8-neighborhood)
  const dirs = [
    { dx: 0, dy: -1 },  // 0: N
    { dx: 1, dy: -1 },  // 1: NE
    { dx: 1, dy: 0 },   // 2: E
    { dx: 1, dy: 1 },   // 3: SE
    { dx: 0, dy: 1 },   // 4: S
    { dx: -1, dy: 1 },  // 5: SW
    { dx: -1, dy: 0 },  // 6: W
    { dx: -1, dy: -1 }, // 7: NW
  ];

  const boundary: Point2D[] = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  // Came from West (background pixel at x-1, y), so start searching from dir 6+1 = 7 (NW)
  let backDir = 6;
  const maxSteps = width * height;

  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    const startSearch = (backDir + 1) % 8;

    for (let i = 0; i < 8; i++) {
      const dIdx = (startSearch + i) % 8;
      const nx = cx + dirs[dIdx].dx;
      const ny = cy + dirs[dIdx].dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && labels[ny * width + nx] === bestLabel) {
        if (nx === startX && ny === startY && boundary.length > 2) {
          return boundary;
        }
        boundary.push({ x: nx, y: ny });
        // Backtrack direction is opposite to the direction we stepped in
        backDir = (dIdx + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  return boundary;
}

/**
 * Converts a traced pixel contour on an A4-rectified canvas (where width/height represent A4 mm)
 * into centered millimeter Point2D[] simplified via Ramer-Douglas-Peucker.
 */
export function convertA4PixelsToCenteredMmContour(
  pixelContour: Point2D[],
  pxPerMm: number,
  toleranceMm: number = 0.45
): { contour: Point2D[]; centerMm: Point2D } {
  if (pixelContour.length < 3) {
    return { contour: [], centerMm: { x: 0, y: 0 } };
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pixelContour) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const centerPxX = (minX + maxX) / 2;
  const centerPxY = (minY + maxY) / 2;

  const mmPoints = pixelContour.map((p) => ({
    x: Math.round(((p.x - centerPxX) / pxPerMm) * 10) / 10,
    y: Math.round(((p.y - centerPxY) / pxPerMm) * 10) / 10,
  }));

  // Subsample first if huge (>350 pts) before Chaikin + RDP to eliminate 1px Moore staircases
  let pre = mmPoints;
  if (mmPoints.length > 350) {
    const stride = Math.ceil(mmPoints.length / 250);
    pre = mmPoints.filter((_, idx) => idx % stride === 0);
  }

  if (pre.length > 24) {
    const smoothed: Point2D[] = [];
    for (let i = 0; i < pre.length; i++) {
      const a = pre[i];
      const b = pre[(i + 1) % pre.length];
      smoothed.push({
        x: Math.round((0.75 * a.x + 0.25 * b.x) * 100) / 100,
        y: Math.round((0.75 * a.y + 0.25 * b.y) * 100) / 100,
      });
      smoothed.push({
        x: Math.round((0.25 * a.x + 0.75 * b.x) * 100) / 100,
        y: Math.round((0.25 * a.y + 0.75 * b.y) * 100) / 100,
      });
    }
    pre = smoothed;
  }

  const simplified = simplifyContour(pre, toleranceMm);
  return {
    contour: simplified.length >= 3 ? simplified : pre,
    centerMm: {
      x: Math.round((centerPxX / pxPerMm) * 10) / 10,
      y: Math.round((centerPxY / pxPerMm) * 10) / 10,
    },
  };
}

function cross2D(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function orderQuadCorners(pts: Point2D[]): [Point2D, Point2D, Point2D, Point2D] {
  // Sort clockwise around centroid then assign TL, TR, BR, BL reliably even under rotation
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;

  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );

  // Find top-left corner (smallest x + y) and rotate array so it is index 0
  let tlIdx = 0;
  let bestSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const sum = sorted[i].x + sorted[i].y;
    if (sum < bestSum) {
      bestSum = sum;
      tlIdx = i;
    }
  }
  return [
    sorted[tlIdx],
    sorted[(tlIdx + 1) % 4],
    sorted[(tlIdx + 2) % 4],
    sorted[(tlIdx + 3) % 4],
  ];
}

/**
 * Pure computer-vision A4 paper detector operating on downscaled RGBA buffer.
 * Uses adaptive Otsu brightness thresholding + whiteness check, isolates the
 * largest bright connected component, computes its convex hull, and prunes it
 * to 4 true perspective corners [TL, TR, BR, BL].
 */
export function detectA4QuadFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): {
  corners: [Point2D, Point2D, Point2D, Point2D];
  orientation: A4Orientation;
  confidence: number;
  detected: boolean;
} {
  const fallbackOri: A4Orientation = width >= height ? 'landscape' : 'portrait';
  const fallback = {
    corners: [
      { x: 0.08, y: 0.08 },
      { x: 0.92, y: 0.08 },
      { x: 0.92, y: 0.92 },
      { x: 0.08, y: 0.92 },
    ] as [Point2D, Point2D, Point2D, Point2D],
    orientation: fallbackOri,
    confidence: 0,
    detected: false,
  };

  const total = width * height;
  if (total < 64) return fallback;

  // 1. Compute luminance + saturation & Otsu threshold
  const lum = new Uint8Array(total);
  const sat = new Float32Array(total);
  const hist = new Int32Array(256);

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const l = Math.min(255, Math.max(0, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    lum[i] = l;
    sat[i] = maxC === 0 ? 0 : (maxC - minC) / maxC;
    hist[l]++;
  }

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let otsuT = 155;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      otsuT = t;
    }
  }

  const paperLumThreshold = Math.max(125, Math.min(215, otsuT));
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (lum[i] >= paperLumThreshold && sat[i] < 0.38) {
      mask[i] = 1;
    }
  }

  // 2. Find largest 4-connected bright component
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  let nextLabel = 1;
  let bestLabel = 0;
  let bestArea = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1 && labels[idx] === 0) {
        const label = nextLabel++;
        let head = 0;
        let tail = 0;
        queue[tail++] = idx;
        labels[idx] = label;

        while (head < tail) {
          const curr = queue[head++];
          const cx = curr % width;
          const cy = (curr - cx) / width;
          if (cx > 0 && mask[curr - 1] === 1 && labels[curr - 1] === 0) {
            labels[curr - 1] = label;
            queue[tail++] = curr - 1;
          }
          if (cx < width - 1 && mask[curr + 1] === 1 && labels[curr + 1] === 0) {
            labels[curr + 1] = label;
            queue[tail++] = curr + 1;
          }
          if (cy > 0 && mask[curr - width] === 1 && labels[curr - width] === 0) {
            labels[curr - width] = label;
            queue[tail++] = curr - width;
          }
          if (cy < height - 1 && mask[curr + width] === 1 && labels[curr + width] === 0) {
            labels[curr + width] = label;
            queue[tail++] = curr + width;
          }
        }

        if (tail > bestArea) {
          bestArea = tail;
          bestLabel = label;
        }
      }
    }
  }

  if (bestLabel === 0 || bestArea < total * 0.08) {
    return fallback;
  }

  // 3. Collect boundary pixels of the largest component & compute Convex Hull
  const boundaryPts: Point2D[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] !== bestLabel) continue;
      const isBorder =
        x === 0 ||
        x === width - 1 ||
        y === 0 ||
        y === height - 1 ||
        labels[idx - 1] !== bestLabel ||
        labels[idx + 1] !== bestLabel ||
        labels[idx - width] !== bestLabel ||
        labels[idx + width] !== bestLabel;
      if (isBorder) {
        boundaryPts.push({ x, y });
      }
    }
  }

  let hull = convexHull(boundaryPts);
  if (hull.length < 4) {
    return fallback;
  }

  // 4. Prune convex hull down to 4 true perspective corners by removing smallest triangle area
  while (hull.length > 4) {
    let minArea = Infinity;
    let removeIdx = 0;
    const n = hull.length;
    for (let i = 0; i < n; i++) {
      const prev = hull[(i - 1 + n) % n];
      const curr = hull[i];
      const next = hull[(i + 1) % n];
      const area = Math.abs(cross2D(prev, curr, next)) * 0.5;
      if (area < minArea) {
        minArea = area;
        removeIdx = i;
      }
    }
    hull.splice(removeIdx, 1);
  }

  const ordered = orderQuadCorners(hull);
  const normalized: [Point2D, Point2D, Point2D, Point2D] = [
    { x: Math.max(0.005, Math.min(0.995, ordered[0].x / (width - 1))), y: Math.max(0.005, Math.min(0.995, ordered[0].y / (height - 1))) },
    { x: Math.max(0.005, Math.min(0.995, ordered[1].x / (width - 1))), y: Math.max(0.005, Math.min(0.995, ordered[1].y / (height - 1))) },
    { x: Math.max(0.005, Math.min(0.995, ordered[2].x / (width - 1))), y: Math.max(0.005, Math.min(0.995, ordered[2].y / (height - 1))) },
    { x: Math.max(0.005, Math.min(0.995, ordered[3].x / (width - 1))), y: Math.max(0.005, Math.min(0.995, ordered[3].y / (height - 1))) },
  ];

  // Compute pixel edge lengths to infer A4 portrait vs landscape accurately
  const topLen = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const botLen = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
  const leftLen = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  const rightLen = Math.hypot(ordered[2].x - ordered[1].x, ordered[2].y - ordered[1].y);

  const avgHoriz = (topLen + botLen) / 2;
  const avgVert = (leftLen + rightLen) / 2;
  const orientation: A4Orientation = avgHoriz >= avgVert ? 'landscape' : 'portrait';

  // Estimate quad area & A4 aspect ratio match (1.414) for confidence score
  const quadArea =
    Math.abs(
      ordered[0].x * ordered[1].y - ordered[1].x * ordered[0].y +
      ordered[1].x * ordered[2].y - ordered[2].x * ordered[1].y +
      ordered[2].x * ordered[3].y - ordered[3].x * ordered[2].y +
      ordered[3].x * ordered[0].y - ordered[0].x * ordered[3].y
    ) * 0.5;
  const areaCoverage = Math.min(1, quadArea / total);
  const rawRatio = Math.max(avgHoriz, avgVert) / Math.max(1, Math.min(avgHoriz, avgVert));
  const ratioScore = Math.max(0, 1 - Math.abs(rawRatio - 1.414) / 1.414);
  const confidence = Math.round((0.55 * Math.min(1, areaCoverage * 2.2) + 0.45 * ratioScore) * 100) / 100;

  return {
    corners: normalized,
    orientation,
    confidence: Math.max(0.3, Math.min(0.99, confidence)),
    detected: areaCoverage > 0.12 && areaCoverage < 0.99,
  };
}
