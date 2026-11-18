import { PlacedTool, GridfinityConfig, Point2D } from '../types';
import {
  getBinDimensions,
  getUnitFootCenters,
  getMagnetPositions,
  getStackingLipProfile,
  STACKING_LIP_HEIGHT,
  BASE_LOWER_CHAMFER,
  BASE_VERTICAL_STEP,
  BASE_PROFILE_HEIGHT,
  BASE_FOOT_BOTTOM_SIZE,
  BASE_FOOT_MID_SIZE,
  BASE_FOOT_TOP_SIZE,
  BASE_BOTTOM_CORNER_RADIUS,
  BASE_MID_CORNER_RADIUS,
  CORNER_RADIUS,
} from './geometry';
import { buildTopDeckAndCutouts } from './cutoutGeometry';
import earcut from 'earcut';

interface Triangle {
  v1: [number, number, number];
  v2: [number, number, number];
  v3: [number, number, number];
  normal?: [number, number, number];
}

function computeNormal(v1: [number, number, number], v2: [number, number, number], v3: [number, number, number]): [number, number, number] {
  const ax = v2[0] - v1[0];
  const ay = v2[1] - v1[1];
  const az = v2[2] - v1[2];

  const bx = v3[0] - v1[0];
  const by = v3[1] - v1[1];
  const bz = v3[2] - v1[2];

  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;

  const len = Math.hypot(nx, ny, nz);
  if (len === 0) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/**
 * Generates rounded rectangle 2D polygon points.
 */
function createRoundedRectPolygon(width: number, length: number, radius: number, segments: number = 8): Point2D[] {
  const pts: Point2D[] = [];
  const r = Math.min(radius, width / 2, length / 2);
  const minX = 0, maxX = width;
  const minY = 0, maxY = length;

  // Top-Right corner
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * (Math.PI / 2);
    pts.push({ x: maxX - r + r * Math.sin(a), y: maxY - r + r * Math.cos(a) });
  }
  // Bottom-Right corner
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI / 2 + (i / segments) * (Math.PI / 2);
    pts.push({ x: maxX - r + r * Math.sin(a), y: minY + r + r * Math.cos(a) });
  }
  // Bottom-Left corner
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI + (i / segments) * (Math.PI / 2);
    pts.push({ x: minX + r + r * Math.sin(a), y: minY + r + r * Math.cos(a) });
  }
  // Top-Left corner
  for (let i = 0; i <= segments; i++) {
    const a = (3 * Math.PI) / 2 + (i / segments) * (Math.PI / 2);
    pts.push({ x: minX + r + r * Math.sin(a), y: maxY - r + r * Math.cos(a) });
  }

  return pts;
}

/**
 * Builds binary STL ArrayBuffer from list of triangles.
 */
export function buildBinaryStl(triangles: Triangle[]): ArrayBuffer {
  const bufferSize = 84 + triangles.length * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80-byte header string
  const header = 'AI Gridfinity Studio — Parametric Precision CAD Bin';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }

  // Number of triangles (uint32, little endian)
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const tri of triangles) {
    const norm = tri.normal || computeNormal(tri.v1, tri.v2, tri.v3);

    // Normal (3 x float32)
    view.setFloat32(offset, norm[0], true);
    view.setFloat32(offset + 4, norm[1], true);
    view.setFloat32(offset + 8, norm[2], true);

    // Vertex 1
    view.setFloat32(offset + 12, tri.v1[0], true);
    view.setFloat32(offset + 16, tri.v1[1], true);
    view.setFloat32(offset + 20, tri.v1[2], true);

    // Vertex 2
    view.setFloat32(offset + 24, tri.v2[0], true);
    view.setFloat32(offset + 28, tri.v2[1], true);
    view.setFloat32(offset + 32, tri.v2[2], true);

    // Vertex 3
    view.setFloat32(offset + 36, tri.v3[0], true);
    view.setFloat32(offset + 40, tri.v3[1], true);
    view.setFloat32(offset + 44, tri.v3[2], true);

    // Attribute byte count (uint16)
    view.setUint16(offset + 48, 0, true);

    offset += 50;
  }

  return buffer;
}

/**
 * Generates complete 3D printable Gridfinity Bin geometry with tool cutouts,
 * true 45° smooth chamfer, negative pill finger pockets, and exactly 4 corner magnets/screws.
 */
export function generateGridfinityStl(
  config: GridfinityConfig,
  tools: PlacedTool[]
): ArrayBuffer {
  const { width, length, height } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  const triangles: Triangle[] = [];
  const chamfer = Math.max(0.2, Math.min(3.0, config.chamferSize)); // 45° chamfer size in mm

  // Helper: rounded rectangle centered at (cx, cy)
  const createRoundedRectCentered = (
    cx: number,
    cy: number,
    w: number,
    l: number,
    radius: number,
    segments: number = 6
  ): Point2D[] => {
    const pts: Point2D[] = [];
    const r = Math.min(radius, w / 2, l / 2);
    const minX = cx - w / 2, maxX = cx + w / 2;
    const minY = cy - l / 2, maxY = cy + l / 2;

    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * (Math.PI / 2);
      pts.push({ x: maxX - r + r * Math.sin(a), y: maxY - r + r * Math.cos(a) });
    }
    for (let i = 0; i <= segments; i++) {
      const a = Math.PI / 2 + (i / segments) * (Math.PI / 2);
      pts.push({ x: maxX - r + r * Math.sin(a), y: minY + r + r * Math.cos(a) });
    }
    for (let i = 0; i <= segments; i++) {
      const a = Math.PI + (i / segments) * (Math.PI / 2);
      pts.push({ x: minX + r + r * Math.sin(a), y: minY + r + r * Math.cos(a) });
    }
    for (let i = 0; i <= segments; i++) {
      const a = (3 * Math.PI) / 2 + (i / segments) * (Math.PI / 2);
      pts.push({ x: minX + r + r * Math.sin(a), y: maxY - r + r * Math.cos(a) });
    }
    return pts;
  };

  const pushRingStrip = (ringA: Point2D[], zA: number, ringB: Point2D[], zB: number) => {
    for (let i = 0; i < ringA.length; i++) {
      const next = (i + 1) % ringA.length;
      const a1 = ringA[i];
      const a2 = ringA[next];
      const b1 = ringB[i];
      const b2 = ringB[next];

      triangles.push({
        v1: [a1.x, a1.y, zA],
        v2: [b2.x, b2.y, zB],
        v3: [a2.x, a2.y, zA],
      });
      triangles.push({
        v1: [a1.x, a1.y, zA],
        v2: [b1.x, b1.y, zB],
        v3: [b2.x, b2.y, zB],
      });
    }
  };

  // 1. Per-unit Gridfinity v5 Stepped Base Feet (Z = 0 -> 4.75mm: 0.8 + 1.8 + 2.15mm)
  const z0 = 0;
  const z1 = BASE_LOWER_CHAMFER;
  const z2 = BASE_LOWER_CHAMFER + BASE_VERTICAL_STEP;
  const z3 = BASE_PROFILE_HEIGHT;

  const footCenters = getUnitFootCenters(config.gridX, config.gridY);
  const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
  const hasHoleRecesses = magnetMode !== 'none' || config.hasScrews;
  const magnetPositions = hasHoleRecesses
    ? getMagnetPositions(config.gridX, config.gridY, magnetMode !== 'none' ? magnetMode : 'corners')
    : [];
  const holeRadius = magnetMode !== 'none' ? config.magnetDiameter / 2 : config.screwDiameter / 2;
  const holeDepth = magnetMode !== 'none' ? config.magnetDepth : BASE_PROFILE_HEIGHT;

  for (const unit of footCenters) {
    const r0 = createRoundedRectCentered(unit.cx, unit.cy, BASE_FOOT_BOTTOM_SIZE, BASE_FOOT_BOTTOM_SIZE, BASE_BOTTOM_CORNER_RADIUS, 5);
    const r1 = createRoundedRectCentered(unit.cx, unit.cy, BASE_FOOT_MID_SIZE, BASE_FOOT_MID_SIZE, BASE_MID_CORNER_RADIUS, 5);
    const r2 = r1;
    const r3 = createRoundedRectCentered(unit.cx, unit.cy, BASE_FOOT_TOP_SIZE, BASE_FOOT_TOP_SIZE, CORNER_RADIUS, 5);

    pushRingStrip(r0, z0, r1, z1);
    pushRingStrip(r1, z1, r2, z2);
    pushRingStrip(r2, z2, r3, z3);

    const footCoords: number[] = [];
    for (const p of r0) footCoords.push(p.x, p.y);
    const footHoles: number[] = [];

    if (hasHoleRecesses) {
      const halfFoot = BASE_FOOT_BOTTOM_SIZE / 2;
      for (const pos of magnetPositions) {
        if (Math.abs(pos.x - unit.cx) < halfFoot && Math.abs(pos.y - unit.cy) < halfFoot) {
          footHoles.push(footCoords.length / 2);
          const segs = 16;
          for (let s = 0; s < segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            footCoords.push(pos.x + holeRadius * Math.cos(a), pos.y + holeRadius * Math.sin(a));
          }
        }
      }
    }

    const bottomIndices = earcut(footCoords, footHoles.length > 0 ? footHoles : undefined);
    for (let i = 0; i < bottomIndices.length; i += 3) {
      const idx1 = bottomIndices[i] * 2;
      const idx2 = bottomIndices[i + 1] * 2;
      const idx3 = bottomIndices[i + 2] * 2;
      triangles.push({
        v1: [footCoords[idx1], footCoords[idx1 + 1], 0],
        v2: [footCoords[idx3], footCoords[idx3 + 1], 0],
        v3: [footCoords[idx2], footCoords[idx2 + 1], 0],
        normal: [0, 0, -1],
      });
    }
  }

  // Magnet or Screw cylinder recesses
  if (hasHoleRecesses) {
    for (const pos of magnetPositions) {
      const segs = 16;
      for (let s = 0; s < segs; s++) {
        const a1 = (s / segs) * Math.PI * 2;
        const a2 = ((s + 1) / segs) * Math.PI * 2;
        const x1 = pos.x + holeRadius * Math.cos(a1);
        const y1 = pos.y + holeRadius * Math.sin(a1);
        const x2 = pos.x + holeRadius * Math.cos(a2);
        const y2 = pos.y + holeRadius * Math.sin(a2);

        triangles.push({ v1: [x1, y1, 0], v2: [x2, y2, 0], v3: [x1, y1, holeDepth] });
        triangles.push({ v1: [x2, y2, 0], v2: [x2, y2, holeDepth], v3: [x1, y1, holeDepth] });
        triangles.push({
          v1: [pos.x, pos.y, holeDepth],
          v2: [x2, y2, holeDepth],
          v3: [x1, y1, holeDepth],
          normal: [0, 0, 1],
        });
      }
    }
  }

  // Continuous bin body from Z = 4.75mm upward
  const baseOuterPts = createRoundedRectPolygon(width, length, CORNER_RADIUS, 8);
  const bridgeCoords: number[] = [];
  for (const p of baseOuterPts) bridgeCoords.push(p.x, p.y);
  const bridgeIdx = earcut(bridgeCoords);
  for (let i = 0; i < bridgeIdx.length; i += 3) {
    const i1 = bridgeIdx[i];
    const i2 = bridgeIdx[i + 1];
    const i3 = bridgeIdx[i + 2];
    triangles.push({
      v1: [baseOuterPts[i1].x, baseOuterPts[i1].y, z3],
      v2: [baseOuterPts[i3].x, baseOuterPts[i3].y, z3],
      v3: [baseOuterPts[i2].x, baseOuterPts[i2].y, z3],
      normal: [0, 0, -1],
    });
  }

  // 2. Main bin outer walls + Adjustable Stackable Lip (NO outer rim chamfer — chamfer is for model cutouts!)
  const topDeckZ = Math.max(z3 + 1.5, height);
  const requestedLipHeight = config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
  const lipProfile = getStackingLipProfile(requestedLipHeight);
  const outerWallTopZ = lipProfile.enabled ? topDeckZ + lipProfile.height : topDeckZ;
  pushRingStrip(baseOuterPts, z3, baseOuterPts, outerWallTopZ);

  let deckBoundaryPts = baseOuterPts;
  let safeCutoutPts = createRoundedRectCentered(
    width / 2,
    length / 2,
    Math.max(10, width - 2 * config.wallThickness),
    Math.max(10, length - 2 * config.wallThickness),
    Math.max(0.5, CORNER_RADIUS - config.wallThickness),
    8
  );

  if (lipProfile.enabled) {
    const zLipTop = topDeckZ + lipProfile.height;
    const zMidBot = topDeckZ + lipProfile.lowerBevelH;
    const zMidTop = zMidBot + lipProfile.verticalWallH;

    const makeInsetRing = (inset: number) =>
      createRoundedRectCentered(
        width / 2,
        length / 2,
        Math.max(4, width - inset * 2),
        Math.max(4, length - inset * 2),
        Math.max(0.5, CORNER_RADIUS - inset),
        8
      );

    const lipTopLand = makeInsetRing(lipProfile.topInset);
    const lipMidTop = makeInsetRing(lipProfile.midInset);
    const lipMidBot = lipMidTop;
    const lipInnerBot = makeInsetRing(lipProfile.bottomInset);

    pushRingStrip(baseOuterPts, zLipTop, lipTopLand, zLipTop);
    pushRingStrip(lipTopLand, zLipTop, lipMidTop, zMidTop);
    if (lipProfile.verticalWallH > 1e-4) {
      pushRingStrip(lipMidTop, zMidTop, lipMidBot, zMidBot);
    }
    pushRingStrip(lipMidBot, zMidBot, lipInnerBot, topDeckZ);

    deckBoundaryPts = lipInnerBot;
    safeCutoutPts = makeInsetRing(lipProfile.bottomInset + 0.6);
  }

  // 3. Top Deck, 45° Model Cutout Chamfer, Tool Cavities, Rounded Negative Pill Slots & CAPSLOCK Text Relief
  const cutoutTris = buildTopDeckAndCutouts({
    topDeckBoundary: deckBoundaryPts,
    safeCutoutBoundary: safeCutoutPts,
    tools,
    topDeckZ,
    chamferSize: chamfer,
    textLabel: config.textLabel,
  });

  for (const tri of cutoutTris) {
    triangles.push(tri);
  }

  return buildBinaryStl(triangles);
}

/**
 * Triggers browser download of generated binary STL file.
 */
export function downloadStl(config: GridfinityConfig, tools: PlacedTool[], fileName?: string) {
  const stlData = generateGridfinityStl(config, tools);
  const blob = new Blob([stlData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `Gridfinity_${config.gridX}x${config.gridY}U_${tools.length}tools.stl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
