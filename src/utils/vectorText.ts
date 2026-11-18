import polygonClipping, { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import { GridfinityTextConfig, Point2D } from '../types';
import { rotatePoint } from './geometry';

// Polyline strokes defined in normalized [0..1] X (left->right) by [0..1] Y (0=top, 1=bottom)
type StrokePolyline = [number, number][];

const GLYPH_STROKES: Record<string, StrokePolyline[]> = {
  A: [
    [[0.08, 1.0], [0.5, 0.0], [0.92, 1.0]],
    [[0.22, 0.66], [0.78, 0.66]],
  ],
  B: [
    [[0.12, 1.0], [0.12, 0.0], [0.68, 0.0], [0.85, 0.12], [0.85, 0.36], [0.68, 0.48], [0.12, 0.48]],
    [[0.68, 0.48], [0.88, 0.60], [0.88, 0.86], [0.68, 1.0], [0.12, 1.0]],
  ],
  C: [
    [[0.88, 0.18], [0.68, 0.0], [0.32, 0.0], [0.12, 0.2], [0.12, 0.8], [0.32, 1.0], [0.68, 1.0], [0.88, 0.82]],
  ],
  D: [
    [[0.12, 1.0], [0.12, 0.0], [0.6, 0.0], [0.86, 0.22], [0.86, 0.78], [0.6, 1.0], [0.12, 1.0]],
  ],
  E: [
    [[0.85, 0.0], [0.14, 0.0], [0.14, 1.0], [0.85, 1.0]],
    [[0.14, 0.5], [0.68, 0.5]],
  ],
  F: [
    [[0.85, 0.0], [0.14, 0.0], [0.14, 1.0]],
    [[0.14, 0.5], [0.68, 0.5]],
  ],
  G: [
    [[0.86, 0.18], [0.68, 0.0], [0.32, 0.0], [0.12, 0.2], [0.12, 0.8], [0.32, 1.0], [0.72, 1.0], [0.88, 0.82], [0.88, 0.52], [0.54, 0.52]],
  ],
  H: [
    [[0.14, 0.0], [0.14, 1.0]],
    [[0.86, 0.0], [0.86, 1.0]],
    [[0.14, 0.5], [0.86, 0.5]],
  ],
  I: [
    [[0.26, 0.0], [0.74, 0.0]],
    [[0.5, 0.0], [0.5, 1.0]],
    [[0.26, 1.0], [0.74, 1.0]],
  ],
  J: [
    [[0.78, 0.0], [0.78, 0.78], [0.6, 1.0], [0.3, 1.0], [0.14, 0.8]],
  ],
  K: [
    [[0.14, 0.0], [0.14, 1.0]],
    [[0.86, 0.0], [0.14, 0.56]],
    [[0.36, 0.4], [0.88, 1.0]],
  ],
  L: [
    [[0.16, 0.0], [0.16, 1.0], [0.86, 1.0]],
  ],
  M: [
    [[0.1, 1.0], [0.1, 0.0], [0.5, 0.55], [0.9, 0.0], [0.9, 1.0]],
  ],
  N: [
    [[0.14, 1.0], [0.14, 0.0], [0.86, 1.0], [0.86, 0.0]],
  ],
  O: [
    [[0.32, 0.0], [0.68, 0.0], [0.88, 0.2], [0.88, 0.8], [0.68, 1.0], [0.32, 1.0], [0.12, 0.8], [0.12, 0.2], [0.32, 0.0]],
  ],
  P: [
    [[0.14, 1.0], [0.14, 0.0], [0.68, 0.0], [0.88, 0.14], [0.88, 0.4], [0.68, 0.54], [0.14, 0.54]],
  ],
  Q: [
    [[0.32, 0.0], [0.68, 0.0], [0.88, 0.2], [0.88, 0.76], [0.68, 0.96], [0.32, 0.96], [0.12, 0.76], [0.12, 0.2], [0.32, 0.0]],
    [[0.56, 0.68], [0.92, 1.0]],
  ],
  R: [
    [[0.14, 1.0], [0.14, 0.0], [0.68, 0.0], [0.86, 0.14], [0.86, 0.38], [0.68, 0.52], [0.14, 0.52]],
    [[0.52, 0.52], [0.88, 1.0]],
  ],
  S: [
    [[0.84, 0.14], [0.68, 0.0], [0.3, 0.0], [0.14, 0.14], [0.14, 0.36], [0.3, 0.48], [0.7, 0.52], [0.86, 0.64], [0.86, 0.86], [0.7, 1.0], [0.3, 1.0], [0.14, 0.86]],
  ],
  T: [
    [[0.08, 0.0], [0.92, 0.0]],
    [[0.5, 0.0], [0.5, 1.0]],
  ],
  U: [
    [[0.14, 0.0], [0.14, 0.8], [0.32, 1.0], [0.68, 1.0], [0.86, 0.8], [0.86, 0.0]],
  ],
  V: [
    [[0.1, 0.0], [0.5, 1.0], [0.9, 0.0]],
  ],
  W: [
    [[0.06, 0.0], [0.28, 1.0], [0.5, 0.42], [0.72, 1.0], [0.94, 0.0]],
  ],
  X: [
    [[0.12, 0.0], [0.88, 1.0]],
    [[0.88, 0.0], [0.12, 1.0]],
  ],
  Y: [
    [[0.1, 0.0], [0.5, 0.52], [0.9, 0.0]],
    [[0.5, 0.52], [0.5, 1.0]],
  ],
  Z: [
    [[0.12, 0.0], [0.88, 0.0], [0.12, 1.0], [0.88, 1.0]],
  ],
  '0': [
    [[0.32, 0.0], [0.68, 0.0], [0.86, 0.2], [0.86, 0.8], [0.68, 1.0], [0.32, 1.0], [0.14, 0.8], [0.14, 0.2], [0.32, 0.0]],
    [[0.24, 0.82], [0.76, 0.18]],
  ],
  '1': [
    [[0.26, 0.2], [0.52, 0.0], [0.52, 1.0]],
    [[0.24, 1.0], [0.8, 1.0]],
  ],
  '2': [
    [[0.14, 0.22], [0.32, 0.0], [0.7, 0.0], [0.86, 0.18], [0.86, 0.38], [0.14, 1.0], [0.88, 1.0]],
  ],
  '3': [
    [[0.16, 0.12], [0.34, 0.0], [0.7, 0.0], [0.86, 0.16], [0.86, 0.36], [0.66, 0.48], [0.42, 0.48]],
    [[0.66, 0.48], [0.88, 0.62], [0.88, 0.84], [0.7, 1.0], [0.32, 1.0], [0.14, 0.86]],
  ],
  '4': [
    [[0.72, 1.0], [0.72, 0.0], [0.12, 0.66], [0.9, 0.66]],
  ],
  '5': [
    [[0.84, 0.0], [0.18, 0.0], [0.16, 0.44], [0.68, 0.44], [0.86, 0.6], [0.86, 0.84], [0.68, 1.0], [0.3, 1.0], [0.14, 0.86]],
  ],
  '6': [
    [[0.76, 0.08], [0.56, 0.0], [0.3, 0.0], [0.14, 0.2], [0.14, 0.82], [0.32, 1.0], [0.7, 1.0], [0.86, 0.82], [0.86, 0.6], [0.68, 0.46], [0.14, 0.46]],
  ],
  '7': [
    [[0.12, 0.0], [0.88, 0.0], [0.38, 1.0]],
  ],
  '8': [
    [[0.34, 0.48], [0.18, 0.36], [0.18, 0.14], [0.34, 0.0], [0.66, 0.0], [0.82, 0.14], [0.82, 0.36], [0.66, 0.48], [0.34, 0.48], [0.14, 0.64], [0.14, 0.86], [0.32, 1.0], [0.68, 1.0], [0.86, 0.86], [0.86, 0.64], [0.66, 0.48]],
  ],
  '9': [
    [[0.86, 0.54], [0.32, 0.54], [0.14, 0.4], [0.14, 0.18], [0.32, 0.0], [0.7, 0.0], [0.86, 0.18], [0.86, 0.82], [0.68, 1.0], [0.32, 1.0], [0.18, 0.9]],
  ],
  '-': [[[0.18, 0.5], [0.82, 0.5]]],
  _: [[[0.08, 1.0], [0.92, 1.0]]],
  '.': [[[0.45, 0.92], [0.55, 0.92]]],
  '/': [[[0.2, 1.0], [0.8, 0.0]]],
  '+': [
    [[0.16, 0.5], [0.84, 0.5]],
    [[0.5, 0.16], [0.5, 0.84]],
  ],
  ':': [
    [[0.48, 0.28], [0.52, 0.28]],
    [[0.48, 0.78], [0.52, 0.78]],
  ],
  '×': [
    [[0.18, 0.22], [0.82, 0.78]],
    [[0.82, 0.22], [0.18, 0.78]],
  ],
  '(': [[[0.68, 0.0], [0.36, 0.28], [0.36, 0.72], [0.68, 1.0]]],
  ')': [[[0.32, 0.0], [0.64, 0.28], [0.64, 0.72], [0.32, 1.0]]],
};

/**
 * Normalizes any label text strictly to CAPSLOCK supported characters.
 */
export function normalizeCapslockText(raw: string): string {
  return raw.toUpperCase();
}

export function measureVectorText(rawText: string, fontSize: number): {
  width: number;
  height: number;
  charWidth: number;
  charAdvance: number;
} {
  const text = normalizeCapslockText(rawText).trim();
  const safeFont = Math.max(4, Math.min(36, fontSize));
  const charWidth = safeFont * 0.66;
  const spacing = safeFont * 0.2;
  const charAdvance = charWidth + spacing;
  if (!text) {
    return { width: 0, height: safeFont, charWidth, charAdvance };
  }
  const width = text.length * charWidth + Math.max(0, text.length - 1) * spacing;
  return { width, height: safeFont, charWidth, charAdvance };
}

/**
 * Expands a single segment (a -> b) into a clean octagon-capped capsule ring.
 */
function expandSegmentToRing(ax: number, ay: number, bx: number, by: number, halfW: number): Ring {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const ux = len > 1e-6 ? dx / len : 1;
  const uy = len > 1e-6 ? dy / len : 0;
  const baseAngle = Math.atan2(uy, ux);

  const ring: Ring = [];
  const capSteps = 4;
  // End cap around B
  for (let i = 0; i <= capSteps; i++) {
    const a = baseAngle - Math.PI / 2 + (i / capSteps) * Math.PI;
    ring.push([bx + halfW * Math.cos(a), by + halfW * Math.sin(a)]);
  }
  // End cap around A
  for (let i = 0; i <= capSteps; i++) {
    const a = baseAngle + Math.PI / 2 + (i / capSteps) * Math.PI;
    ring.push([ax + halfW * Math.cos(a), ay + halfW * Math.sin(a)]);
  }
  if (ring.length > 0) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

const glyphCache = new Map<string, MultiPolygon>();

function getGlyphPolygonsLocal(ch: string, charWidth: number, charHeight: number, strokeHalfW: number): MultiPolygon {
  const key = `${ch}|${charWidth.toFixed(2)}|${charHeight.toFixed(2)}|${strokeHalfW.toFixed(2)}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;

  const strokes = GLYPH_STROKES[ch];
  if (!strokes || strokes.length === 0) {
    return [];
  }

  let acc: MultiPolygon = [];
  for (const poly of strokes) {
    if (poly.length === 1) {
      const p0 = poly[0];
      const segRing = expandSegmentToRing(
        p0[0] * charWidth,
        p0[1] * charHeight,
        p0[0] * charWidth + 0.01,
        p0[1] * charHeight,
        strokeHalfW
      );
      const p: Polygon = [segRing];
      acc = acc.length === 0 ? [p] : polygonClipping.union(acc, p);
    } else {
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i];
        const b = poly[i + 1];
        const segRing = expandSegmentToRing(
          a[0] * charWidth,
          a[1] * charHeight,
          b[0] * charWidth,
          b[1] * charHeight,
          strokeHalfW
        );
        const p: Polygon = [segRing];
        acc = acc.length === 0 ? [p] : polygonClipping.union(acc, p);
      }
    }
  }

  if (glyphCache.size > 400) {
    glyphCache.clear();
  }
  glyphCache.set(key, acc);
  return acc;
}

/**
 * Generates clean manifold MultiPolygon glyphs for CAPSLOCK text ready for
 * Canvas2D (flipY=false) or Three.js/STL extrusion (flipY=true).
 */
export function buildTextMultiPolygon(
  config: GridfinityTextConfig,
  options?: { flipY?: boolean; shiftX?: number; shiftY?: number }
): MultiPolygon {
  const text = normalizeCapslockText(config.text).trim();
  if (!text || config.mode === 'none') return [];

  const flipY = options?.flipY ?? false;
  const shiftX = options?.shiftX ?? 0;
  const shiftY = options?.shiftY ?? 0;

  const { width, height, charWidth, charAdvance } = measureVectorText(text, config.fontSize);
  const strokeHalfW = Math.max(0.35, config.fontSize * 0.085);

  // Offset so character stroke outer thickness fits neatly inside bounding box
  const innerW = Math.max(1, charWidth - strokeHalfW * 2);
  const innerH = Math.max(1, height - strokeHalfW * 2);

  let combined: MultiPolygon = [];
  const startX = -width / 2 + strokeHalfW;
  const topY = -height / 2 + strokeHalfW;

  for (let idx = 0; idx < text.length; idx++) {
    const ch = text[idx];
    if (ch === ' ') continue;

    const glyphLocal = getGlyphPolygonsLocal(ch, innerW, innerH, strokeHalfW);
    if (glyphLocal.length === 0) continue;

    const charOffsetX = startX + idx * charAdvance;

    for (const poly of glyphLocal) {
      const transformedPoly: Polygon = poly.map((ring) => {
        const mapped: Ring = [];
        for (let i = 0; i < ring.length; i++) {
          const lx = charOffsetX + ring[i][0];
          const lyRaw = topY + ring[i][1];
          const ly = flipY ? -lyRaw : lyRaw;
          const rotAngle = flipY ? -config.rotation : config.rotation;
          const rotated = rotatePoint({ x: lx, y: ly }, rotAngle);
          mapped.push([rotated.x + config.x + shiftX, rotated.y + config.y + shiftY]);
        }
        return mapped;
      });
      combined.push(transformedPoly);
    }
  }

  return combined;
}

/**
 * Convenience helper to convert MultiPolygon rings into Point2D[][] paths per polygon.
 */
export function multiPolygonToPointRings(mp: MultiPolygon): Point2D[][][] {
  return mp.map((poly) =>
    poly.map((ring) => {
      const pts: Point2D[] = [];
      for (let i = 0; i < ring.length; i++) {
        if (i === ring.length - 1 && ring[i][0] === ring[0][0] && ring[i][1] === ring[0][1]) {
          continue;
        }
        pts.push({ x: ring[i][0], y: ring[i][1] });
      }
      return pts;
    })
  );
}
