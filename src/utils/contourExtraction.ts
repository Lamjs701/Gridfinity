import { Point2D } from '../types';
import { simplifyContour } from './geometry';
import {
  A4Orientation,
  getA4DimensionsMm,
  computeHomography,
  applyHomography,
  traceLargestObjectContour,
  convertA4PixelsToCenteredMmContour,
  detectA4QuadFromRgba,
} from './a4Calibration';

export interface CalibrationTarget {
  id: string;
  name: string;
  dimensionMm: number; // reference size in mm
  description: string;
}

export const CALIBRATION_PRESETS: CalibrationTarget[] = [
  { id: 'a4-portrait', name: 'A4 Paper — Portrait (210 × 297 mm)', dimensionMm: 210.0, description: 'Standard A4 vertical sheet' },
  { id: 'a4-landscape', name: 'A4 Paper — Landscape (297 × 210 mm)', dimensionMm: 297.0, description: 'Standard A4 horizontal sheet' },
  { id: 'card', name: 'Credit / ID Card (85.6 mm)', dimensionMm: 85.6, description: 'Standard width (85.60 mm)' },
  { id: 'ruler-100', name: 'Ruler 100mm Mark', dimensionMm: 100.0, description: '100 mm scale reference' },
];

export type A4Corners = [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL in normalized [0..1] image coords

/**
 * Automatically detects the bright white A4 sheet quadrilateral in an uploaded image
 * using adaptive connected-component + convex-hull 4-corner fitting.
 */
export async function detectA4PaperInImage(imageSrc: string): Promise<{
  corners: A4Corners;
  orientation: A4Orientation;
  confidence: number;
  detected: boolean;
  naturalWidth: number;
  naturalHeight: number;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const natW = img.naturalWidth || img.width || 800;
      const natH = img.naturalHeight || img.height || 600;

      // Downscale for fast quad detection
      const maxDim = 280;
      const ratio = Math.min(maxDim / natW, maxDim / natH, 1);
      const w = Math.max(16, Math.round(natW * ratio));
      const h = Math.max(16, Math.round(natH * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const defaultOri: A4Orientation = natW >= natH ? 'landscape' : 'portrait';
        resolve({
          corners: [
            { x: 0.08, y: 0.08 },
            { x: 0.92, y: 0.08 },
            { x: 0.92, y: 0.92 },
            { x: 0.08, y: 0.92 },
          ],
          orientation: defaultOri,
          confidence: 0,
          detected: false,
          naturalWidth: natW,
          naturalHeight: natH,
        });
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const res = detectA4QuadFromRgba(data, w, h);

      resolve({
        corners: res.corners,
        orientation: res.orientation,
        confidence: res.confidence,
        detected: res.detected,
        naturalWidth: natW,
        naturalHeight: natH,
      });
    };
    img.onerror = () => reject(new Error('Failed to load image for A4 detection'));
    img.src = imageSrc;
  });
}

/**
 * Rectifies the uploaded photo using the 4 A4 paper corners into an exact millimeter-scale
 * A4 image (pxPerMm = 3 -> 630x891 for portrait or 891x630 for landscape),
 * isolates the tool placed on the A4 sheet, and traces its accurate contour in mm!
 */
export async function extractToolFromA4Photo(
  imageSrc: string,
  cornersNormalized: A4Corners,
  orientation: A4Orientation,
  threshold: number = 140,
  invert: boolean = false
): Promise<{
  contour: Point2D[];
  rectifiedImageUrl: string;
  mmPerPixel: number;
  a4WidthMm: number;
  a4HeightMm: number;
  centerMm: Point2D;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;

      // Draw original image onto source canvas
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = natW;
      srcCanvas.height = natH;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) {
        reject(new Error('Could not get source canvas context'));
        return;
      }
      srcCtx.drawImage(img, 0, 0, natW, natH);
      const srcData = srcCtx.getImageData(0, 0, natW, natH).data;

      // Output rectified A4 canvas at fixed 3 pixels per mm (mmPerPixel = 1/3)
      const pxPerMm = 3.0;
      const mmPerPixel = 1.0 / pxPerMm;
      const { widthMm, heightMm } = getA4DimensionsMm(orientation);
      const outW = Math.round(widthMm * pxPerMm);
      const outH = Math.round(heightMm * pxPerMm);

      const outCanvas = document.createElement('canvas');
      outCanvas.width = outW;
      outCanvas.height = outH;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) {
        reject(new Error('Could not get rectified A4 canvas context'));
        return;
      }
      const outImgData = outCtx.createImageData(outW, outH);
      const outData = outImgData.data;

      // Compute inverse homography: maps destination A4 pixel (x,y) -> source image pixel (sx,sy)
      const srcQuad: [Point2D, Point2D, Point2D, Point2D] = [
        { x: cornersNormalized[0].x * natW, y: cornersNormalized[0].y * natH },
        { x: cornersNormalized[1].x * natW, y: cornersNormalized[1].y * natH },
        { x: cornersNormalized[2].x * natW, y: cornersNormalized[2].y * natH },
        { x: cornersNormalized[3].x * natW, y: cornersNormalized[3].y * natH },
      ];
      const dstQuad: [Point2D, Point2D, Point2D, Point2D] = [
        { x: 0, y: 0 },
        { x: outW - 1, y: 0 },
        { x: outW - 1, y: outH - 1 },
        { x: 0, y: outH - 1 },
      ];

      const H_dstToSrc = computeHomography(dstQuad, srcQuad);
      const mask = new Uint8Array(outW * outH);

      // Perspective warp & foreground mask creation strictly inside A4 sheet
      // Leave a 4mm (12px) edge margin so A4 paper shadow edges aren't mistaken for the tool
      const marginPx = Math.round(4 * pxPerMm);

      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const sp = applyHomography(H_dstToSrc, { x, y });
          const sx = Math.round(sp.x);
          const sy = Math.round(sp.y);
          const outIdx = (y * outW + x) * 4;

          if (sx >= 0 && sx < natW && sy >= 0 && sy < natH) {
            const sIdx = (sy * natW + sx) * 4;
            const r = srcData[sIdx];
            const g = srcData[sIdx + 1];
            const b = srcData[sIdx + 2];

            outData[outIdx] = r;
            outData[outIdx + 1] = g;
            outData[outIdx + 2] = b;
            outData[outIdx + 3] = 255;

            if (x > marginPx && x < outW - marginPx && y > marginPx && y < outH - marginPx) {
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              const isFg = invert ? lum > threshold : lum < threshold;
              mask[y * outW + x] = isFg ? 1 : 0;
            }
          } else {
            outData[outIdx] = 248;
            outData[outIdx + 1] = 250;
            outData[outIdx + 2] = 252;
            outData[outIdx + 3] = 255;
          }
        }
      }

      outCtx.putImageData(outImgData, 0, 0);
      const rectifiedImageUrl = outCanvas.toDataURL('image/png');

      // Trace largest foreground object on the A4 sheet using Moore-neighbor boundary tracing
      const pixelBoundary = traceLargestObjectContour(mask, outW, outH);
      const { contour, centerMm } = convertA4PixelsToCenteredMmContour(pixelBoundary, pxPerMm, 0.45);

      if (contour.length >= 3) {
        resolve({
          contour,
          rectifiedImageUrl,
          mmPerPixel,
          a4WidthMm: widthMm,
          a4HeightMm: heightMm,
          centerMm,
        });
      } else {
        // Fallback bounding box if threshold didn't capture object
        resolve({
          contour: [
            { x: -45, y: -12 },
            { x: 45, y: -12 },
            { x: 45, y: 12 },
            { x: -45, y: 12 },
          ],
          rectifiedImageUrl,
          mmPerPixel,
          a4WidthMm: widthMm,
          a4HeightMm: heightMm,
          centerMm: { x: widthMm / 2, y: heightMm / 2 },
        });
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for A4 extraction'));
    img.src = imageSrc;
  });
}

/**
 * Legacy fallback extractor (kept for compatibility).
 */
export async function extractContourFromImage(
  imageSrc: string,
  threshold: number = 128,
  invert: boolean = false,
  scaleMmPerPixel: number = 0.25
): Promise<{
  contour: Point2D[];
  rawBoundingBox: { widthPx: number; heightPx: number };
}> {
  const res = await extractToolFromA4Photo(
    imageSrc,
    [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ],
    'landscape',
    threshold,
    invert
  );
  return {
    contour: simplifyContour(res.contour, 0.4),
    rawBoundingBox: {
      widthPx: Math.round(res.a4WidthMm / scaleMmPerPixel),
      heightPx: Math.round(res.a4HeightMm / scaleMmPerPixel),
    },
  };
}
