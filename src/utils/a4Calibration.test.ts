import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getA4DimensionsMm,
  computeHomography,
  applyHomography,
  traceLargestObjectContour,
  convertA4PixelsToCenteredMmContour,
  detectA4QuadFromRgba,
} from './a4Calibration';

test('getA4DimensionsMm returns accurate portrait and landscape sizes', () => {
  assert.deepEqual(getA4DimensionsMm('portrait'), { widthMm: 210, heightMm: 297 });
  assert.deepEqual(getA4DimensionsMm('landscape'), { widthMm: 297, heightMm: 210 });
});

test('computeHomography maps skewed A4 quadrilateral corners to exact A4 millimeter frame', () => {
  const srcQuad = [
    { x: 100, y: 80 },  // TL
    { x: 520, y: 100 }, // TR
    { x: 560, y: 690 }, // BR
    { x: 60, y: 670 },  // BL
  ] as [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}];

  const dstA4 = [
    { x: 0, y: 0 },
    { x: 210, y: 0 },
    { x: 210, y: 297 },
    { x: 0, y: 297 },
  ] as [{x:number;y:number},{x:number;y:number},{x:number;y:number},{x:number;y:number}];

  const H = computeHomography(srcQuad, dstA4);

  for (let i = 0; i < 4; i++) {
    const mapped = applyHomography(H, srcQuad[i]);
    assert.ok(Math.abs(mapped.x - dstA4[i].x) < 0.01);
    assert.ok(Math.abs(mapped.y - dstA4[i].y) < 0.01);
  }
});

test('traceLargestObjectContour isolates and traces an off-center tool inside an A4 mask', () => {
  const w = 80;
  const h = 100;
  const mask = new Uint8Array(w * h);

  // Small 3x3 noise speck (should be ignored)
  for (let y = 5; y < 8; y++) {
    for (let x = 5; x < 8; x++) {
      mask[y * w + x] = 1;
    }
  }

  // Main object: 20x40 rectangle at (40..60, 30..70)
  for (let y = 30; y < 70; y++) {
    for (let x = 40; x < 60; x++) {
      mask[y * w + x] = 1;
    }
  }

  const boundary = traceLargestObjectContour(mask, w, h);
  assert.ok(boundary.length > 20);

  const minX = Math.min(...boundary.map((p) => p.x));
  const maxX = Math.max(...boundary.map((p) => p.x));
  const minY = Math.min(...boundary.map((p) => p.y));
  const maxY = Math.max(...boundary.map((p) => p.y));

  assert.equal(minX, 40);
  assert.equal(maxX, 59);
  assert.equal(minY, 30);
  assert.equal(maxY, 69);

  // Convert at 2 px/mm -> 10mm x 20mm centered around (0,0)
  const { contour } = convertA4PixelsToCenteredMmContour(boundary, 2.0, 0.2);
  const cMinX = Math.min(...contour.map((p) => p.x));
  const cMaxX = Math.max(...contour.map((p) => p.x));
  assert.ok(Math.abs((cMaxX - cMinX) - 9.5) <= 0.5);
});

test('detectA4QuadFromRgba auto-detects skewed white A4 sheet corners and orientation over dark desk', () => {
  const w = 240;
  const h = 180;
  const rgba = new Uint8ClampedArray(w * h * 4);

  // Dark walnut desk background
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 52;
    rgba[i * 4 + 1] = 38;
    rgba[i * 4 + 2] = 28;
    rgba[i * 4 + 3] = 255;
  }

  // Paint slightly tilted landscape A4 quad inside image
  const quad = [
    { x: 38, y: 30 },  // TL
    { x: 206, y: 24 }, // TR
    { x: 214, y: 146 }, // BR
    { x: 30, y: 152 }, // BL
  ];
  const pointInConvexQuad = (px: number, py: number) => {
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
      if (cross < 0) return false;
    }
    return true;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pointInConvexQuad(x, y)) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 244;
        rgba[idx + 1] = 245;
        rgba[idx + 2] = 247;
      }
    }
  }

  // Place a dark tool rectangle right inside the middle of the A4 sheet
  for (let y = 76; y < 102; y++) {
    for (let x = 75; x < 165; x++) {
      const idx = (y * w + x) * 4;
      rgba[idx] = 35;
      rgba[idx + 1] = 40;
      rgba[idx + 2] = 48;
    }
  }

  const res = detectA4QuadFromRgba(rgba, w, h);
  assert.equal(res.detected, true);
  assert.equal(res.orientation, 'landscape');
  assert.ok(res.confidence >= 0.7);

  // Verify corners match true normalized coordinates within ~3%
  const expectedNorm = quad.map((q) => ({ x: q.x / (w - 1), y: q.y / (h - 1) }));
  for (let i = 0; i < 4; i++) {
    const dist = Math.hypot(res.corners[i].x - expectedNorm[i].x, res.corners[i].y - expectedNorm[i].y);
    assert.ok(dist < 0.04, `Corner ${i} drifted too far: dist=${dist}`);
  }
});
