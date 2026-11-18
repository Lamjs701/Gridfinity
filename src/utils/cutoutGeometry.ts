import polygonClipping, { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import earcut from 'earcut';
import { PlacedTool, FingerPocket, Point2D, GridfinityTextConfig } from '../types';
import {
  BASE_PROFILE_HEIGHT,
  generatePillContour,
  getTransformedContour,
  rotatePoint,
} from './geometry';
import { buildTextMultiPolygon } from './vectorText';

export interface MeshTriangle {
  v1: [number, number, number];
  v2: [number, number, number];
  v3: [number, number, number];
  normal?: [number, number, number];
  vertexNormals?: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}

/**
 * Signed polygon area (>0 means CCW in XY, <0 means CW).
 */
export function signedArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Ensures a simple polygon is oriented CCW (positive area) or CW (negative area).
 */
export function ensureWinding(pts: Point2D[], ccw: boolean = true): Point2D[] {
  const area = signedArea(pts);
  if ((ccw && area < 0) || (!ccw && area > 0)) {
    return [...pts].reverse();
  }
  return pts;
}

/**
 * Offsets a simple closed 2D polygon outward by `offsetMm` (for 45° cutout chamfers).
 * Miter lengths are clamped to avoid sharp spike artifacts on narrow jaws.
 */
export function offsetPolygonOutward(pts: Point2D[], offsetMm: number): Point2D[] {
  if (pts.length < 3 || Math.abs(offsetMm) < 1e-5) return pts;
  const ccwPts = ensureWinding(pts, true);
  const n = ccwPts.length;
  const out: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ccwPts[(i - 1 + n) % n];
    const curr = ccwPts[i];
    const next = ccwPts[(i + 1) % n];

    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    // For CCW polygon, outward right-hand normal is (dy, -dx)
    const n1x = e1y / l1;
    const n1y = -e1x / l1;

    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;
    const l2 = Math.hypot(e2x, e2y) || 1;
    const n2x = e2y / l2;
    const n2y = -e2x / l2;

    let mx = n1x + n2x;
    let my = n1y + n2y;
    const mLen = Math.hypot(mx, my);

    if (mLen < 1e-6) {
      out.push({ x: curr.x + n1x * offsetMm, y: curr.y + n1y * offsetMm });
    } else {
      mx /= mLen;
      my /= mLen;
      const dot = Math.max(0.45, mx * n1x + my * n1y);
      const dist = Math.min(offsetMm * 2.0, offsetMm / dot);
      out.push({ x: curr.x + mx * dist, y: curr.y + my * dist });
    }
  }

  return out;
}

/**
 * Transforms a tool's finger pocket from tool-local space into bin space,
 * applying both pocket rotation AND tool rotation + translation so 3D matches Canvas2D.
 */
export function transformPocketContour(
  pocket: FingerPocket,
  tool: PlacedTool,
  numArcPoints: number = 10
): Point2D[] {
  const toolLocalPts = generatePillContour(pocket, numArcPoints);
  return toolLocalPts.map((pt) => {
    const rot = rotatePoint(pt, tool.rotation);
    return {
      x: rot.x + tool.x,
      y: rot.y + tool.y,
    };
  });
}

function toPcRing(pts: Point2D[]): Ring {
  const ring: Ring = pts.map((p) => [p.x, p.y]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return ring;
}

function fromPcRing(ring: Ring): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (i === ring.length - 1 && p[0] === ring[0][0] && p[1] === ring[0][1]) {
      continue;
    }
    pts.push({ x: p[0], y: p[1] });
  }
  return pts;
}

function dedupeRing(pts: Point2D[], minDist: number = 0.04): Point2D[] {
  if (pts.length < 3) return pts;
  const cleaned: Point2D[] = [];
  for (const p of pts) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= minDist) {
      cleaned.push(p);
    }
  }
  while (
    cleaned.length > 3 &&
    Math.hypot(
      cleaned[0].x - cleaned[cleaned.length - 1].x,
      cleaned[0].y - cleaned[cleaned.length - 1].y
    ) < minDist
  ) {
    cleaned.pop();
  }
  return cleaned;
}

function triangulatePcPolygon(poly: Polygon, z: number, normal: [number, number, number]): MeshTriangle[] {
  if (poly.length === 0) return [];
  const flat: number[] = [];
  const holes: number[] = [];

  for (let r = 0; r < poly.length; r++) {
    const pts = dedupeRing(fromPcRing(poly[r]), 0.01);
    if (pts.length < 3) continue;
    if (r > 0) holes.push(flat.length / 2);
    for (const p of pts) flat.push(p.x, p.y);
  }

  if (flat.length < 6) return [];
  const idx = earcut(flat, holes.length > 0 ? holes : undefined);
  const tris: MeshTriangle[] = [];
  const flipForDown = normal[2] < 0;

  for (let i = 0; i < idx.length; i += 3) {
    const i1 = idx[i] * 2;
    const i2 = idx[i + 1] * 2;
    const i3 = idx[i + 2] * 2;
    const v1: [number, number, number] = [flat[i1], flat[i1 + 1], z];
    const v2: [number, number, number] = [flat[i2], flat[i2 + 1], z];
    const v3: [number, number, number] = [flat[i3], flat[i3 + 1], z];
    tris.push(
      flipForDown
        ? { v1, v2: v3, v3: v2, normal }
        : { v1, v2, v3, normal }
    );
  }
  return tris;
}

function buildRingWallTris(
  ringBot: Point2D[],
  zBot: number,
  ringTop: Point2D[],
  zTop: number
): MeshTriangle[] {
  const tris: MeshTriangle[] = [];
  const n = Math.min(ringBot.length, ringTop.length);
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const b1 = ringBot[i];
    const b2 = ringBot[next];
    const t1 = ringTop[i];
    const t2 = ringTop[next];

    // For CCW ring, [b1, t2, b2] and [b1, t1, t2] face inward toward cavity interior.
    // For CW ring, they face outward.
    tris.push({
      v1: [b1.x, b1.y, zBot],
      v2: [t2.x, t2.y, zTop],
      v3: [b2.x, b2.y, zBot],
    });
    tris.push({
      v1: [b1.x, b1.y, zBot],
      v2: [t1.x, t1.y, zTop],
      v3: [t2.x, t2.y, zTop],
    });
  }
  return tris;
}

/**
 * Evaluates the smooth C² concave bowl Z elevation inside a pill finger pocket using
 * an exact rounded-rectangle SDF and bounded-slope parabolic U-trough curve:
 *   f(t) = 1 - (1 - t)^2
 * Unlike sqrt(1 - u^2), this has finite entry slope at the rim (no Z-cliff jaggedness!)
 * and flattens smoothly (slope = 0) at the rounded bottom keel.
 */
export function evalRoundedPillZ(
  pocket: FingerPocket,
  parentTool: PlacedTool,
  worldPt: Point2D,
  zRim: number,
  pillFloorZ: number,
  shiftX: number = 0,
  shiftY: number = 0
): number {
  const unshifted = { x: worldPt.x - shiftX, y: worldPt.y - shiftY };
  const relTool = rotatePoint(
    { x: unshifted.x - parentTool.x, y: unshifted.y - parentTool.y },
    -parentTool.rotation
  );
  const local = rotatePoint(
    { x: relTool.x - pocket.x, y: relTool.y - pocket.y },
    -pocket.rotation
  );

  const hx = Math.max(2, pocket.length / 2);
  const hy = Math.max(2, pocket.width / 2);
  const r = Math.max(0.5, Math.min(pocket.cornerRadius ?? hy, hx, hy));

  const qx = Math.abs(local.x) - (hx - r);
  const qy = Math.abs(local.y) - (hy - r);
  const sdf =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  const dIn = Math.max(0, -sdf);
  const curveSpan = Math.max(1.2, Math.min(hx, hy) - 0.6);
  const u = Math.max(0, 1 - dIn / curveSpan);
  const drop = Math.max(0.2, zRim - pillFloorZ);
  return zRim - drop * (1 - u * u);
}

/**
 * Evaluates exact smooth inward-upward surface normal on the curved pill bowl via central differences.
 */
export function evalRoundedPillNormal(
  pocket: FingerPocket,
  parentTool: PlacedTool,
  worldPt: Point2D,
  zRim: number,
  pillFloorZ: number,
  shiftX: number = 0,
  shiftY: number = 0
): [number, number, number] {
  const eps = 0.08;
  const zx1 = evalRoundedPillZ(pocket, parentTool, { x: worldPt.x - eps, y: worldPt.y }, zRim, pillFloorZ, shiftX, shiftY);
  const zx2 = evalRoundedPillZ(pocket, parentTool, { x: worldPt.x + eps, y: worldPt.y }, zRim, pillFloorZ, shiftX, shiftY);
  const zy1 = evalRoundedPillZ(pocket, parentTool, { x: worldPt.x, y: worldPt.y - eps }, zRim, pillFloorZ, shiftX, shiftY);
  const zy2 = evalRoundedPillZ(pocket, parentTool, { x: worldPt.x, y: worldPt.y + eps }, zRim, pillFloorZ, shiftX, shiftY);
  const dzdx = (zx2 - zx1) / (2 * eps);
  const dzdy = (zy2 - zy1) / (2 * eps);
  const nx = -dzdx;
  const ny = -dzdy;
  const nz = 1;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function getPillInsetAtZ(
  pocket: FingerPocket,
  zRim: number,
  pillFloorZ: number,
  zQuery: number
): number {
  const hx = Math.max(2, pocket.length / 2);
  const hy = Math.max(2, pocket.width / 2);
  const curveSpan = Math.max(1.2, Math.min(hx, hy) - 0.6);
  const drop = Math.max(0.2, zRim - pillFloorZ);
  const normDrop = Math.max(0, Math.min(1, (zRim - zQuery) / drop));
  const u = Math.sqrt(Math.max(0, 1 - normDrop));
  return curveSpan * (1 - u);
}

/**
 * Generates an inset pill ring with FIXED vertex count and evenly subdivided straight flanks,
 * guaranteeing 1:1 vertex correspondence for twist-free, non-jagged concave lofting.
 */
function sampleFixedPillRing(
  pocket: FingerPocket,
  parentTool: PlacedTool,
  inset: number,
  shiftX: number,
  shiftY: number,
  cornerSegs: number = 10,
  edgeSegs: number = 4
): Point2D[] {
  const shrunkLen = Math.max(1.2, pocket.length - 2 * inset);
  const shrunkWid = Math.max(1.2, pocket.width - 2 * inset);
  const hx = shrunkLen / 2;
  const hy = shrunkWid / 2;
  const r = Math.max(0.25, Math.min((pocket.cornerRadius ?? pocket.width / 2) - inset, hx, hy));

  const corners = [
    { cx: hx - r, cy: hy - r, startA: 0, endA: Math.PI / 2 },
    { cx: -(hx - r), cy: hy - r, startA: Math.PI / 2, endA: Math.PI },
    { cx: -(hx - r), cy: -(hy - r), startA: Math.PI, endA: (3 * Math.PI) / 2 },
    { cx: hx - r, cy: -(hy - r), startA: (3 * Math.PI) / 2, endA: Math.PI * 2 },
  ];

  const localPts: Point2D[] = [];
  for (let cIdx = 0; cIdx < 4; cIdx++) {
    const c = corners[cIdx];
    const nextC = corners[(cIdx + 1) % 4];
    for (let i = 0; i <= cornerSegs; i++) {
      const a = c.startA + (i / cornerSegs) * (c.endA - c.startA);
      localPts.push({ x: c.cx + r * Math.cos(a), y: c.cy + r * Math.sin(a) });
    }
    const endPt = { x: c.cx + r * Math.cos(c.endA), y: c.cy + r * Math.sin(c.endA) };
    const nextStartPt = {
      x: nextC.cx + r * Math.cos(nextC.startA),
      y: nextC.cy + r * Math.sin(nextC.startA),
    };
    for (let e = 1; e < edgeSegs; e++) {
      const t = e / edgeSegs;
      localPts.push({
        x: endPt.x + (nextStartPt.x - endPt.x) * t,
        y: endPt.y + (nextStartPt.y - endPt.y) * t,
      });
    }
  }

  return localPts.map((pt) => {
    const rot1 = rotatePoint(pt, pocket.rotation);
    const shifted = { x: rot1.x + pocket.x, y: rot1.y + pocket.y };
    const rot2 = rotatePoint(shifted, parentTool.rotation);
    return {
      x: rot2.x + parentTool.x + shiftX,
      y: rot2.y + parentTool.y + shiftY,
    };
  });
}

function makeSubdividedPillContour(
  pocket: FingerPocket,
  parentTool: PlacedTool,
  inset: number,
  shiftX: number,
  shiftY: number
): Point2D[] {
  const pts = sampleFixedPillRing(pocket, parentTool, inset, shiftX, shiftY, 12, 8);
  return dedupeRing(pts, 1e-4);
}

function pointsFullyInsidePolygon(pts: Point2D[], outerRing: Point2D[]): boolean {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outerRing) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const margin = 0.2;
  for (const p of pts) {
    if (p.x < minX + margin || p.x > maxX - margin || p.y < minY + margin || p.y > maxY - margin) {
      return false;
    }
  }
  return true;
}

/**
 * Generates top deck (Z = topDeckZ), 45° model cutout chamfers, vertical tool cavity walls,
 * smooth rounded concave pill finger pockets (no flat cut!), and CAPSLOCK embossed/engraved text.
 */
export function buildTopDeckAndCutouts(options: {
  topDeckBoundary: Point2D[];
  safeCutoutBoundary: Point2D[];
  tools: PlacedTool[];
  topDeckZ: number;
  chamferSize: number;
  textLabel?: GridfinityTextConfig;
  shiftX?: number;
  shiftY?: number;
}): MeshTriangle[] {
  const {
    topDeckBoundary,
    safeCutoutBoundary,
    tools,
    topDeckZ,
    chamferSize,
    textLabel,
    shiftX = 0,
    shiftY = 0,
  } = options;

  const shiftToolPts = (pts: Point2D[]): Point2D[] =>
    shiftX === 0 && shiftY === 0 ? pts : pts.map((p) => ({ x: p.x + shiftX, y: p.y + shiftY }));

  const deckPoly: Polygon = [toPcRing(ensureWinding(topDeckBoundary, true))];
  const safePoly: Polygon = [toPcRing(ensureWinding(safeCutoutBoundary, true))];

  interface ToolCavityItem {
    mp: MultiPolygon;
    floorZ: number;
  }
  interface PillCavityItem {
    pocket: FingerPocket;
    parentTool: PlacedTool;
    mp: MultiPolygon;
    floorZ: number;
  }

  const toolCavities: ToolCavityItem[] = [];
  const pillCavities: PillCavityItem[] = [];
  const minSafeFloorZ = BASE_PROFILE_HEIGHT + 0.8;

  for (const tool of tools) {
    const toolDepth = tool.depthOverride ?? tool.tool.depth;
    const cavityFloorZ = Math.round(Math.max(minSafeFloorZ + 0.2, topDeckZ - toolDepth) * 100) / 100;

    const rawToolPts = shiftToolPts(getTransformedContour(tool));
    if (rawToolPts.length >= 3) {
      const clippedTool = polygonClipping.intersection(
        [toPcRing(ensureWinding(rawToolPts, true))],
        safePoly
      );
      if (clippedTool.length > 0) {
        toolCavities.push({ mp: clippedTool, floorZ: cavityFloorZ });
      }
    }

    const pockets =
      tool.fingerPockets && tool.fingerPockets.length > 0
        ? tool.fingerPockets
        : tool.tool.fingerPockets;

    for (const pocket of pockets) {
      const pillFloorZ = Math.round(Math.max(minSafeFloorZ, topDeckZ - pocket.depth) * 100) / 100;
      const rawPillPts = shiftToolPts(transformPocketContour(pocket, tool, 20));
      if (rawPillPts.length >= 4) {
        const clippedPill = polygonClipping.intersection(
          [toPcRing(ensureWinding(rawPillPts, true))],
          safePoly
        );
        if (clippedPill.length > 0) {
          pillCavities.push({
            pocket,
            parentTool: tool,
            mp: clippedPill,
            floorZ: pillFloorZ,
          });
        }
      }
    }
  }

  const triangles: MeshTriangle[] = [];
  const allOpenMps: { mp: MultiPolygon; floorZ: number }[] = [
    ...toolCavities,
    ...pillCavities,
  ];

  // 1. Compute Chamfer & Top Deck Remaining (with tool/pill openings AND engraved text subtracted)
  let rawOpenUnion: MultiPolygon = [];
  for (const c of allOpenMps) {
    rawOpenUnion = rawOpenUnion.length === 0 ? c.mp : polygonClipping.union(rawOpenUnion, c.mp);
  }

  const effectiveChamfer =
    allOpenMps.length > 0
      ? Math.max(
          0,
          Math.min(
            chamferSize,
            Math.min(...allOpenMps.map((c) => Math.max(0.2, topDeckZ - c.floorZ - 0.3)))
          )
        )
      : 0;
  const zChamferBottom = topDeckZ - effectiveChamfer;

  let chamferMouthUnion: MultiPolygon = [];
  if (allOpenMps.length > 0) {
    if (effectiveChamfer > 0.05) {
      for (const poly of rawOpenUnion) {
        for (let r = 0; r < poly.length; r++) {
          const baseRing = dedupeRing(fromPcRing(poly[r]), 0.05);
          if (baseRing.length < 3) continue;
          const isHole = r > 0;
          const orientedBase = ensureWinding(baseRing, !isHole);
          const chamferedRing = offsetPolygonOutward(orientedBase, effectiveChamfer);

          triangles.push(...buildRingWallTris(orientedBase, zChamferBottom, chamferedRing, topDeckZ));

          if (!isHole) {
            const clippedMouth = polygonClipping.intersection(
              [toPcRing(chamferedRing)],
              safePoly
            );
            if (clippedMouth.length > 0) {
              chamferMouthUnion =
                chamferMouthUnion.length === 0
                  ? clippedMouth
                  : polygonClipping.union(chamferMouthUnion, clippedMouth);
            }
          }
        }
      }
    } else {
      chamferMouthUnion = rawOpenUnion;
    }
  }

  // Prepare CAPSLOCK Text Polygons (if textLabel active)
  let validTextMp: MultiPolygon = [];
  if (textLabel && textLabel.mode !== 'none' && textLabel.text.trim().length > 0) {
    const rawTextMp = buildTextMultiPolygon(textLabel, {
      flipY: true,
      shiftX,
      shiftY,
    });
    if (rawTextMp.length > 0) {
      const clippedToSafe = polygonClipping.intersection(rawTextMp, safePoly);
      validTextMp =
        chamferMouthUnion.length > 0
          ? polygonClipping.difference(clippedToSafe, chamferMouthUnion)
          : clippedToSafe;
    }
  }

  // Punch openings & engraved text from top deck
  let topDeckSubtract = chamferMouthUnion;
  if (textLabel?.mode === 'engrave' && validTextMp.length > 0) {
    topDeckSubtract =
      topDeckSubtract.length > 0
        ? polygonClipping.union(topDeckSubtract, validTextMp)
        : validTextMp;
  }

  const topDeckRemaining =
    topDeckSubtract.length > 0 ? polygonClipping.difference(deckPoly, topDeckSubtract) : [deckPoly];

  for (const poly of topDeckRemaining) {
    triangles.push(...triangulatePcPolygon(poly, topDeckZ, [0, 0, 1]));
  }

  // Build 3D Text Relief Geometry (Engrave or Emboss)
  if (validTextMp.length > 0 && textLabel) {
    if (textLabel.mode === 'engrave') {
      const engraveDepth = Math.min(Math.max(0.2, textLabel.depth), Math.max(0.4, topDeckZ - minSafeFloorZ));
      const engraveZ = topDeckZ - engraveDepth;
      for (const poly of validTextMp) {
        triangles.push(...triangulatePcPolygon(poly, engraveZ, [0, 0, 1]));
        for (let r = 0; r < poly.length; r++) {
          const pts = ensureWinding(fromPcRing(poly[r]), r === 0);
          if (pts.length < 3) continue;
          triangles.push(...buildRingWallTris(pts, engraveZ, pts, topDeckZ));
        }
      }
    } else if (textLabel.mode === 'emboss') {
      const embossH = Math.min(Math.max(0.2, textLabel.depth), 4.0);
      const embossTopZ = topDeckZ + embossH;
      for (const poly of validTextMp) {
        triangles.push(...triangulatePcPolygon(poly, embossTopZ, [0, 0, 1]));
        for (let r = 0; r < poly.length; r++) {
          // Outward face for outer glyph boundary requires CW winding; inner hole requires CCW
          const pts = ensureWinding(fromPcRing(poly[r]), r > 0);
          if (pts.length < 3) continue;
          triangles.push(...buildRingWallTris(pts, topDeckZ, pts, embossTopZ));
        }
      }
    }
  }

  // 2. Vertical Sidewalls & Flat Floors for Tool Cavities
  // Subtract any rounded pills that dip below a tool's floor
  const pillUnionByToolFloor = (floorZ: number): MultiPolygon => {
    let mp: MultiPolygon = [];
    for (const pill of pillCavities) {
      if (pill.floorZ < floorZ - 1e-4) {
        const inset = getPillInsetAtZ(pill.pocket, zChamferBottom, pill.floorZ, floorZ);
        const pts = makeSubdividedPillContour(pill.pocket, pill.parentTool, inset, shiftX, shiftY);
        const clipped = polygonClipping.intersection([toPcRing(ensureWinding(pts, true))], safePoly);
        if (clipped.length > 0) {
          mp = mp.length === 0 ? clipped : polygonClipping.union(mp, clipped);
        }
      }
    }
    return mp;
  };

  // Helper: evaluate lowest curved pill Z at a 2D point across all pill cavities
  const evalMinPillZAt = (pt: Point2D, fallbackZ: number): number => {
    let minZ = fallbackZ;
    for (const pill of pillCavities) {
      const zP = evalRoundedPillZ(
        pill.pocket,
        pill.parentTool,
        pt,
        zChamferBottom,
        pill.floorZ,
        shiftX,
        shiftY
      );
      if (zP < minZ) minZ = zP;
    }
    return minZ;
  };

  if (toolCavities.length > 0) {
    const uniqueToolFloors = Array.from(new Set(toolCavities.map((c) => c.floorZ))).sort(
      (a, b) => b - a
    );
    let prevZ = zChamferBottom;

    for (const floorZ of uniqueToolFloors) {
      const openTools = toolCavities.filter((c) => c.floorZ <= floorZ + 1e-4);
      let activeMp: MultiPolygon = [];
      for (const c of openTools) {
        activeMp = activeMp.length === 0 ? c.mp : polygonClipping.union(activeMp, c.mp);
      }

      if (prevZ - floorZ > 1e-4) {
        for (const poly of activeMp) {
          for (let r = 0; r < poly.length; r++) {
            const rawRingPts = ensureWinding(fromPcRing(poly[r]), r === 0);
            if (rawRingPts.length < 3) continue;

            if (pillCavities.length === 0) {
              triangles.push(...buildRingWallTris(rawRingPts, floorZ, rawRingPts, prevZ));
            } else {
              // Subdivide segments near/inside pills so vertical tool walls drop smoothly along evalRoundedPillZ
              // and never project across the rounded pill opening.
              const n = rawRingPts.length;
              for (let i = 0; i < n; i++) {
                const a = rawRingPts[i];
                const b = rawRingPts[(i + 1) % n];
                const segLen = Math.hypot(b.x - a.x, b.y - a.y);
                const zA = evalMinPillZAt(a, prevZ);
                const zB = evalMinPillZAt(b, prevZ);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const zM = evalMinPillZAt(mid, prevZ);
                const touchesPill =
                  zA < zChamferBottom - 1e-3 ||
                  zB < zChamferBottom - 1e-3 ||
                  zM < zChamferBottom - 1e-3;
                const steps = touchesPill ? Math.max(1, Math.min(48, Math.ceil(segLen / 0.7))) : 1;

                for (let s = 0; s < steps; s++) {
                  const t1 = s / steps;
                  const t2 = (s + 1) / steps;
                  const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
                  const p2 = { x: a.x + (b.x - a.x) * t2, y: a.y + (b.y - a.y) * t2 };
                  const top1 = Math.max(floorZ, Math.min(prevZ, evalMinPillZAt(p1, prevZ)));
                  const top2 = Math.max(floorZ, Math.min(prevZ, evalMinPillZAt(p2, prevZ)));
                  if (top1 <= floorZ + 1e-4 && top2 <= floorZ + 1e-4) continue;

                  triangles.push({
                    v1: [p1.x, p1.y, floorZ],
                    v2: [p2.x, p2.y, top2],
                    v3: [p2.x, p2.y, floorZ],
                  });
                  triangles.push({
                    v1: [p1.x, p1.y, floorZ],
                    v2: [p1.x, p1.y, top1],
                    v3: [p2.x, p2.y, top2],
                  });
                }
              }
            }
          }
        }
      }

      const endingHere = toolCavities.filter((c) => Math.abs(c.floorZ - floorZ) <= 1e-4);
      const deeperTools = toolCavities.filter((c) => c.floorZ < floorZ - 1e-4);

      let endingMp: MultiPolygon = [];
      for (const c of endingHere) {
        endingMp = endingMp.length === 0 ? c.mp : polygonClipping.union(endingMp, c.mp);
      }

      let deeperMp: MultiPolygon = [];
      for (const c of deeperTools) {
        deeperMp = deeperMp.length === 0 ? c.mp : polygonClipping.union(deeperMp, c.mp);
      }

      const pillsPunchingFloor = pillUnionByToolFloor(floorZ);
      if (pillsPunchingFloor.length > 0) {
        deeperMp =
          deeperMp.length > 0
            ? polygonClipping.union(deeperMp, pillsPunchingFloor)
            : pillsPunchingFloor;
      }

      const floorPatch =
        deeperMp.length > 0 ? polygonClipping.difference(endingMp, deeperMp) : endingMp;

      for (const poly of floorPatch) {
        triangles.push(...triangulatePcPolygon(poly, floorZ, [0, 0, 1]));
      }

      prevZ = floorZ;
    }
  }

  // 3. Smooth C² Concave Pill Finger Pockets (Uniform-t Parabolic U-Trough + Analytical Smooth Vertex Normals)
  // Cluster overlapping pills so compound intersections carve one seamless trough with zero internal X-creases.
  const clusterVisited = new Array(pillCavities.length).fill(false);
  const pillClusters: PillCavityItem[][] = [];
  for (let i = 0; i < pillCavities.length; i++) {
    if (clusterVisited[i]) continue;
    clusterVisited[i] = true;
    const cluster: PillCavityItem[] = [pillCavities[i]];
    let head = 0;
    while (head < cluster.length) {
      const curr = cluster[head++];
      for (let j = 0; j < pillCavities.length; j++) {
        if (clusterVisited[j]) continue;
        if (polygonClipping.intersection(curr.mp, pillCavities[j].mp).length > 0) {
          clusterVisited[j] = true;
          cluster.push(pillCavities[j]);
        }
      }
    }
    pillClusters.push(cluster);
  }

  const BOWL_STEPS = 14;

  // Point-in-MultiPolygon test (handles outer + hole rings cleanly)
  const pointInMp = (pt: Point2D, mp: MultiPolygon): boolean => {
    for (const poly of mp) {
      let inPoly = false;
      for (let r = 0; r < poly.length; r++) {
        const ring = poly[r];
        let inRing = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0], yi = ring[i][1];
          const xj = ring[j][0], yj = ring[j][1];
          if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-12) + xi) {
            inRing = !inRing;
          }
        }
        if (r === 0) {
          if (!inRing) {
            inPoly = false;
            break;
          }
          inPoly = true;
        } else if (inRing) {
          inPoly = false;
          break;
        }
      }
      if (inPoly) return true;
    }
    return false;
  };

  const segmentsIntersectBbox = (
    mp: MultiPolygon,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): boolean => {
    for (const poly of mp) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const ax = ring[i][0], ay = ring[i][1];
          const bx = ring[i + 1][0], by = ring[i + 1][1];
          if (
            Math.max(ax, bx) >= minX &&
            Math.min(ax, bx) <= maxX &&
            Math.max(ay, by) >= minY &&
            Math.min(ay, by) <= maxY
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };

  for (const cluster of pillClusters) {
    if (cluster.length === 1) {
      const pill = cluster[0];
      const { pocket, parentTool, floorZ } = pill;
      const drop = Math.max(0.2, zChamferBottom - floorZ);
      const hx = Math.max(2, pocket.length / 2);
      const hy = Math.max(2, pocket.width / 2);
      const curveSpan = Math.max(1.2, Math.min(hx, hy) - 0.6);

      const overlappingTools: ToolCavityItem[] = [];
      for (const tc of toolCavities) {
        if (polygonClipping.intersection(pill.mp, tc.mp).length > 0) {
          overlappingTools.push(tc);
        }
      }
      const overlapsTool = overlappingTools.length > 0;

      // Exact tool floor breakpoints guaranteed NOT to be dropped
      const toolTs: number[] = [];
      for (const tc of overlappingTools) {
        if (tc.floorZ > floorZ + 0.02 && tc.floorZ < zChamferBottom - 0.02) {
          const normDrop = Math.max(0, Math.min(1, (zChamferBottom - tc.floorZ) / drop));
          const u = Math.sqrt(Math.max(0, 1 - normDrop));
          toolTs.push(1 - u);
        }
      }

      const uniformTs: number[] = [];
      for (let s = 0; s <= BOWL_STEPS; s++) {
        const t = s / BOWL_STEPS;
        const nearToolT = toolTs.some((tt) => Math.abs(tt - t) < 0.025 && t > 0 && t < 1);
        if (!nearToolT) uniformTs.push(t);
      }

      const allTs = [...uniformTs, ...toolTs].sort((a, b) => a - b);
      const uniqueTs: number[] = [];
      for (const t of allTs) {
        if (uniqueTs.length === 0 || t - uniqueTs[uniqueTs.length - 1] > 0.004) {
          uniqueTs.push(t);
        }
      }
      if (uniqueTs[uniqueTs.length - 1] < 1 - 1e-4) {
        uniqueTs[uniqueTs.length - 1] = 1;
      }

      const fixedRings: Point2D[][] = [];
      const zs: number[] = [];
      for (const t of uniqueTs) {
        const inset = curveSpan * t;
        const u = 1 - t;
        const zLevel = Math.round((zChamferBottom - drop * (1 - u * u)) * 1000) / 1000;
        const fixedRing = sampleFixedPillRing(pocket, parentTool, inset, shiftX, shiftY, 12, 10);
        fixedRings.push(fixedRing);
        zs.push(zLevel);
      }

      const fullyInsideSafe = pointsFullyInsidePolygon(fixedRings[0], safeCutoutBoundary);
      const ringNormals = fixedRings.map((ring) =>
        ring.map((pt) => evalRoundedPillNormal(pocket, parentTool, pt, zChamferBottom, floorZ, shiftX, shiftY))
      );

      if (!overlapsTool && fullyInsideSafe) {
        // Exact 1:1 topology quad loft with smooth analytical per-vertex normals
        for (let s = 0; s < fixedRings.length - 1; s++) {
          const topRing = fixedRings[s];
          const botRing = fixedRings[s + 1];
          const topNorms = ringNormals[s];
          const botNorms = ringNormals[s + 1];
          const zTop = zs[s];
          const zBot = zs[s + 1];
          const n = topRing.length;

          for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            const b1 = botRing[i];
            const b2 = botRing[next];
            const t1 = topRing[i];
            const t2 = topRing[next];
            const nb1 = botNorms[i];
            const nb2 = botNorms[next];
            const nt1 = topNorms[i];
            const nt2 = topNorms[next];

            if (Math.hypot(b2.x - b1.x, b2.y - b1.y) > 1e-4) {
              triangles.push({
                v1: [b1.x, b1.y, zBot],
                v2: [t2.x, t2.y, zTop],
                v3: [b2.x, b2.y, zBot],
                vertexNormals: [nb1, nt2, nb2],
              });
            }
            if (Math.hypot(t2.x - t1.x, t2.y - t1.y) > 1e-4) {
              triangles.push({
                v1: [b1.x, b1.y, zBot],
                v2: [t1.x, t1.y, zTop],
                v3: [t2.x, t2.y, zTop],
                vertexNormals: [nb1, nt1, nt2],
              });
            }
          }
        }

        const keelPoly: Polygon = [toPcRing(ensureWinding(fixedRings[fixedRings.length - 1], true))];
        triangles.push(...triangulatePcPolygon(keelPoly, floorZ, [0, 0, 1]));
      } else {
        // Clipped Radial Quads: preserves twist-free orthogonal quad flow everywhere,
        // clipping only the tiny 1mm quads that cross tool walls or safe boundaries.
        const safeMp: MultiPolygon = [safePoly];
        for (let s = 0; s < fixedRings.length - 1; s++) {
          const topRing = fixedRings[s];
          const botRing = fixedRings[s + 1];
          const topNorms = ringNormals[s];
          const botNorms = ringNormals[s + 1];
          const zTop = zs[s];
          const zBot = zs[s + 1];
          const n = topRing.length;

          let blockedMp: MultiPolygon = [];
          for (const tc of overlappingTools) {
            if (zBot >= tc.floorZ - 1e-3) {
              blockedMp = blockedMp.length === 0 ? tc.mp : polygonClipping.union(blockedMp, tc.mp);
            }
          }

          for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            const b1 = botRing[i];
            const b2 = botRing[next];
            const t1 = topRing[i];
            const t2 = topRing[next];
            const nb1 = botNorms[i];
            const nb2 = botNorms[next];
            const nt1 = topNorms[i];
            const nt2 = topNorms[next];

            const qMinX = Math.min(b1.x, b2.x, t1.x, t2.x) - 1e-4;
            const qMaxX = Math.max(b1.x, b2.x, t1.x, t2.x) + 1e-4;
            const qMinY = Math.min(b1.y, b2.y, t1.y, t2.y) - 1e-4;
            const qMaxY = Math.max(b1.y, b2.y, t1.y, t2.y) + 1e-4;

            const safeHit = !fullyInsideSafe && segmentsIntersectBbox(safeMp, qMinX, qMaxX, qMinY, qMaxY);
            const toolHit =
              blockedMp.length > 0 && segmentsIntersectBbox(blockedMp, qMinX, qMaxX, qMinY, qMaxY);

            if (!safeHit && !toolHit) {
              const mid = {
                x: (b1.x + b2.x + t1.x + t2.x) / 4,
                y: (b1.y + b2.y + t1.y + t2.y) / 4,
              };
              if (!fullyInsideSafe && !pointInMp(mid, safeMp)) continue;
              if (blockedMp.length > 0 && pointInMp(mid, blockedMp)) continue;

              if (Math.hypot(b2.x - b1.x, b2.y - b1.y) > 1e-4) {
                triangles.push({
                  v1: [b1.x, b1.y, zBot],
                  v2: [t2.x, t2.y, zTop],
                  v3: [b2.x, b2.y, zBot],
                  vertexNormals: [nb1, nt2, nb2],
                });
              }
              if (Math.hypot(t2.x - t1.x, t2.y - t1.y) > 1e-4) {
                triangles.push({
                  v1: [b1.x, b1.y, zBot],
                  v2: [t1.x, t1.y, zTop],
                  v3: [t2.x, t2.y, zTop],
                  vertexNormals: [nb1, nt1, nt2],
                });
              }
              continue;
            }

            // Tiny boundary quad straddles a tool wall or bin safe perimeter: clip precisely
            const quadPts = ensureWinding([b1, b2, t2, t1], true);
            const quadPoly: Polygon = [toPcRing(quadPts)];
            let clippedQuad = fullyInsideSafe
              ? ([quadPoly] as MultiPolygon)
              : polygonClipping.intersection([quadPoly], safeMp);
            if (clippedQuad.length > 0 && blockedMp.length > 0) {
              clippedQuad = polygonClipping.difference(clippedQuad, blockedMp);
            }

            for (const poly of clippedQuad) {
              const flat: number[] = [];
              const holes: number[] = [];
              for (let r = 0; r < poly.length; r++) {
                const rPts = dedupeRing(fromPcRing(poly[r]), 0.01);
                if (rPts.length < 3) continue;
                if (r > 0) holes.push(flat.length / 2);
                for (const p of rPts) flat.push(p.x, p.y);
              }
              if (flat.length < 6) continue;
              const idx = earcut(flat, holes.length > 0 ? holes : undefined);
              for (let k = 0; k < idx.length; k += 3) {
                const p1 = { x: flat[idx[k] * 2], y: flat[idx[k] * 2 + 1] };
                const p2 = { x: flat[idx[k + 1] * 2], y: flat[idx[k + 1] * 2 + 1] };
                const p3 = { x: flat[idx[k + 2] * 2], y: flat[idx[k + 2] * 2 + 1] };
                const z1 = evalRoundedPillZ(pocket, parentTool, p1, zChamferBottom, floorZ, shiftX, shiftY);
                const z2 = evalRoundedPillZ(pocket, parentTool, p2, zChamferBottom, floorZ, shiftX, shiftY);
                const z3 = evalRoundedPillZ(pocket, parentTool, p3, zChamferBottom, floorZ, shiftX, shiftY);
                const n1 = evalRoundedPillNormal(pocket, parentTool, p1, zChamferBottom, floorZ, shiftX, shiftY);
                const n2 = evalRoundedPillNormal(pocket, parentTool, p2, zChamferBottom, floorZ, shiftX, shiftY);
                const n3 = evalRoundedPillNormal(pocket, parentTool, p3, zChamferBottom, floorZ, shiftX, shiftY);
                triangles.push({
                  v1: [p1.x, p1.y, z1],
                  v2: [p2.x, p2.y, z2],
                  v3: [p3.x, p3.y, z3],
                  vertexNormals: [n1, n2, n3],
                });
              }
            }
          }
        }

        let keelMp = polygonClipping.intersection(
          [toPcRing(ensureWinding(fixedRings[fixedRings.length - 1], true))],
          safePoly
        );
        for (const tc of overlappingTools) {
          if (floorZ >= tc.floorZ - 1e-3) {
            keelMp = polygonClipping.difference(keelMp, tc.mp);
          }
        }
        for (const poly of keelMp) {
          triangles.push(...triangulatePcPolygon(poly, floorZ, [0, 0, 1]));
        }
      }
      continue;
    }

    // Compound overlapping pill cluster (2+ overlapping pills):
    // Evaluate single compound minimum Z heightfield & central-difference normals over aligned lattice
    let clusterUnion: MultiPolygon = [];
    for (const p of cluster) {
      clusterUnion = clusterUnion.length === 0 ? p.mp : polygonClipping.union(clusterUnion, p.mp);
    }
    clusterUnion = polygonClipping.intersection(clusterUnion, safePoly);

    const evalClusterZ = (pt: Point2D, capZ: number = zChamferBottom): number => {
      let minZ = capZ;
      for (const p of cluster) {
        const zp = evalRoundedPillZ(p.pocket, p.parentTool, pt, zChamferBottom, p.floorZ, shiftX, shiftY);
        if (zp < minZ) minZ = zp;
      }
      return minZ;
    };

    const evalClusterNormal = (pt: Point2D, capZ: number = zChamferBottom): [number, number, number] => {
      const eps = 0.08;
      const zx1 = evalClusterZ({ x: pt.x - eps, y: pt.y }, capZ);
      const zx2 = evalClusterZ({ x: pt.x + eps, y: pt.y }, capZ);
      const zy1 = evalClusterZ({ x: pt.x, y: pt.y - eps }, capZ);
      const zy2 = evalClusterZ({ x: pt.x, y: pt.y + eps }, capZ);
      const nx = -(zx2 - zx1) / (2 * eps);
      const ny = -(zy2 - zy1) / (2 * eps);
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      return [nx / len, ny / len, nz / len];
    };

    const overlappingTools: ToolCavityItem[] = [];
    for (const tc of toolCavities) {
      if (polygonClipping.intersection(clusterUnion, tc.mp).length > 0) {
        overlappingTools.push(tc);
      }
    }

    const regions: { mp: MultiPolygon; capZ: number }[] = [];
    if (overlappingTools.length === 0) {
      regions.push({ mp: clusterUnion, capZ: zChamferBottom });
    } else {
      let allOverToolsMp: MultiPolygon = [];
      for (const tc of overlappingTools) {
        allOverToolsMp = allOverToolsMp.length === 0 ? tc.mp : polygonClipping.union(allOverToolsMp, tc.mp);
      }
      const outsideToolsMp = polygonClipping.difference(clusterUnion, allOverToolsMp);
      if (outsideToolsMp.length > 0) {
        regions.push({ mp: outsideToolsMp, capZ: zChamferBottom });
      }
      const floorLevels = Array.from(new Set(overlappingTools.map((tc) => tc.floorZ)));
      for (const fz of floorLevels) {
        let toolsAtFloor: MultiPolygon = [];
        for (const tc of overlappingTools) {
          if (Math.abs(tc.floorZ - fz) < 1e-4) {
            toolsAtFloor = toolsAtFloor.length === 0 ? tc.mp : polygonClipping.union(toolsAtFloor, tc.mp);
          }
        }
        let pillsBelowFloor: MultiPolygon = [];
        for (const pill of cluster) {
          if (pill.floorZ < fz - 1e-4) {
            const inset = getPillInsetAtZ(pill.pocket, zChamferBottom, pill.floorZ, fz);
            const pts = makeSubdividedPillContour(pill.pocket, pill.parentTool, inset, shiftX, shiftY);
            const poly: Polygon = [toPcRing(ensureWinding(pts, true))];
            pillsBelowFloor = pillsBelowFloor.length === 0 ? [poly] : polygonClipping.union(pillsBelowFloor, [poly]);
          }
        }
        if (pillsBelowFloor.length > 0) {
          const regionBelow = polygonClipping.intersection(
            polygonClipping.intersection(pillsBelowFloor, toolsAtFloor),
            safePoly
          );
          if (regionBelow.length > 0) {
            regions.push({ mp: regionBelow, capZ: fz });
          }
        }
      }
    }

    const LATTICE_STEP = 1.25;
    for (const region of regions) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const poly of region.mp) {
        for (const pt of poly[0]) {
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
        }
      }
      if (!Number.isFinite(minX)) continue;

      const ix0 = Math.floor(minX / LATTICE_STEP);
      const ix1 = Math.ceil(maxX / LATTICE_STEP);
      const iy0 = Math.floor(minY / LATTICE_STEP);
      const iy1 = Math.ceil(maxY / LATTICE_STEP);

      for (let ix = ix0; ix < ix1; ix++) {
        const x0 = ix * LATTICE_STEP;
        const x1 = (ix + 1) * LATTICE_STEP;
        for (let iy = iy0; iy < iy1; iy++) {
          const y0 = iy * LATTICE_STEP;
          const y1 = (iy + 1) * LATTICE_STEP;
          const crossesBoundary = segmentsIntersectBbox(region.mp, x0 - 1e-4, x1 + 1e-4, y0 - 1e-4, y1 + 1e-4);

          if (!crossesBoundary) {
            const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
            if (!pointInMp(mid, region.mp)) continue;

            const p00 = { x: x0, y: y0 };
            const p10 = { x: x1, y: y0 };
            const p11 = { x: x1, y: y1 };
            const p01 = { x: x0, y: y1 };
            const z00 = evalClusterZ(p00, region.capZ);
            const z10 = evalClusterZ(p10, region.capZ);
            const z11 = evalClusterZ(p11, region.capZ);
            const z01 = evalClusterZ(p01, region.capZ);
            const n00 = evalClusterNormal(p00, region.capZ);
            const n10 = evalClusterNormal(p10, region.capZ);
            const n11 = evalClusterNormal(p11, region.capZ);
            const n01 = evalClusterNormal(p01, region.capZ);

            // Split quad along diagonal with smaller height fold for smooth curvature
            if (Math.abs(z00 - z11) <= Math.abs(z10 - z01)) {
              triangles.push({
                v1: [p00.x, p00.y, z00],
                v2: [p10.x, p10.y, z10],
                v3: [p11.x, p11.y, z11],
                vertexNormals: [n00, n10, n11],
              });
              triangles.push({
                v1: [p00.x, p00.y, z00],
                v2: [p11.x, p11.y, z11],
                v3: [p01.x, p01.y, z01],
                vertexNormals: [n00, n11, n01],
              });
            } else {
              triangles.push({
                v1: [p00.x, p00.y, z00],
                v2: [p10.x, p10.y, z10],
                v3: [p01.x, p01.y, z01],
                vertexNormals: [n00, n10, n01],
              });
              triangles.push({
                v1: [p10.x, p10.y, z10],
                v2: [p11.x, p11.y, z11],
                v3: [p01.x, p01.y, z01],
                vertexNormals: [n10, n11, n01],
              });
            }
          } else {
            const cellRect: Polygon = [
              [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
                [x0, y0],
              ],
            ];
            const clipped = polygonClipping.intersection([cellRect], region.mp);
            for (const poly of clipped) {
              const flat: number[] = [];
              const holes: number[] = [];
              for (let r = 0; r < poly.length; r++) {
                const rPts = dedupeRing(fromPcRing(poly[r]), 0.01);
                if (rPts.length < 3) continue;
                if (r > 0) holes.push(flat.length / 2);
                for (const pt of rPts) flat.push(pt.x, pt.y);
              }
              if (flat.length < 6) continue;
              const idx = earcut(flat, holes.length > 0 ? holes : undefined);
              for (let i = 0; i < idx.length; i += 3) {
                const p1 = { x: flat[idx[i] * 2], y: flat[idx[i] * 2 + 1] };
                const p2 = { x: flat[idx[i + 1] * 2], y: flat[idx[i + 1] * 2 + 1] };
                const p3 = { x: flat[idx[i + 2] * 2], y: flat[idx[i + 2] * 2 + 1] };
                const z1 = evalClusterZ(p1, region.capZ);
                const z2 = evalClusterZ(p2, region.capZ);
                const z3 = evalClusterZ(p3, region.capZ);
                const n1 = evalClusterNormal(p1, region.capZ);
                const n2 = evalClusterNormal(p2, region.capZ);
                const n3 = evalClusterNormal(p3, region.capZ);
                triangles.push({
                  v1: [p1.x, p1.y, z1],
                  v2: [p2.x, p2.y, z2],
                  v3: [p3.x, p3.y, z3],
                  vertexNormals: [n1, n2, n3],
                });
              }
            }
          }
        }
      }
    }
  }

  return triangles;
}
