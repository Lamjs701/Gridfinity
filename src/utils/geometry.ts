import { Point2D, PlacedTool, SnapGuide, FingerPocket, MagnetMode, GridfinityConfig } from '../types';

export const GRID_UNIT = 42.0; // mm per Gridfinity unit (42x42mm baseplate pitch)
export const GRID_TOLERANCE = 0.5; // mm total clearance (41.5x41.5mm unit outer size, 0.25mm per side)
export const HEIGHT_UNIT_MM = 7.0; // mm per height U (+1u = +7mm)
export const STACKING_LIP_HEIGHT = 5.0; // mm stackable lip height per Lip (5mm) reference
export const STACKING_LIP_BOTTOM_INSET = 2.95; // mm inner bottom inset at topDeckZ
export const STACKING_LIP_MID_INSET = 2.25; // mm inner vertical step inset (0.7mm lower bevel)
export const STACKING_LIP_TOP_INSET = 0.35; // mm top flat rim land before 1.9mm upper 45° bevel

// Exact Gridfinity Design Reference v5 Stepped Base Foot Profile (total = 4.75mm)
export const BASE_LOWER_CHAMFER = 0.8; // 45° lower chamfer (Z = 0 -> 0.8mm)
export const BASE_VERTICAL_STEP = 1.8; // vertical step (Z = 0.8 -> 2.6mm)
export const BASE_UPPER_CHAMFER = 2.15; // 45° upper chamfer (Z = 2.6 -> 4.75mm)
export const BASE_PROFILE_HEIGHT = BASE_LOWER_CHAMFER + BASE_VERTICAL_STEP + BASE_UPPER_CHAMFER; // 4.75mm

// Foot cross-section widths & corner radii per v5 Reference (7.5Ø -> 3.2Ø -> 1.6Ø)
export const CORNER_RADIUS = 3.75; // 7.5Ø outer corner radius at Z >= 4.75mm
export const BASE_MID_CORNER_RADIUS = 1.6; // 3.2Ø corner radius at vertical step (37.2mm)
export const BASE_BOTTOM_CORNER_RADIUS = 0.8; // 1.6Ø corner radius at flat bottom (35.6mm)
export const BASE_FOOT_TOP_SIZE = GRID_UNIT - GRID_TOLERANCE; // 41.5mm
export const BASE_FOOT_MID_SIZE = BASE_FOOT_TOP_SIZE - 2 * BASE_UPPER_CHAMFER; // 37.2mm
export const BASE_FOOT_BOTTOM_SIZE = BASE_FOOT_MID_SIZE - 2 * BASE_LOWER_CHAMFER; // 35.6mm

// Plan: 4.8mm from 35.6mm foot bottom edge = 2.15 + 0.8 + 4.8 = 7.75mm from 41.5mm outer wall (8.0mm from 42mm pitch)
export const MAGNET_FOOT_EDGE_INSET = 4.8;
export const MAGNET_CORNER_INSET = BASE_UPPER_CHAMFER + BASE_LOWER_CHAMFER + MAGNET_FOOT_EDGE_INSET; // 7.75mm
export const V5_MAGNET_DIAMETER = 6.5; // 6.5Ø magnet hole
export const V5_SCREW_DIAMETER = 3.0; // 3.0Ø M3 screw hole

/**
 * Calculates outer dimensions of a Gridfinity bin.
 * Dimensions remain identical whether magnets or screws are enabled or disabled!
 */
export function getBinDimensions(gridX: number, gridY: number, gridZ: number, customHeightMm?: number) {
  const width = gridX * GRID_UNIT - GRID_TOLERANCE;
  const length = gridY * GRID_UNIT - GRID_TOLERANCE;
  const height = customHeightMm ?? (gridZ * HEIGHT_UNIT_MM);
  return { width, length, height };
}

/**
 * Returns the center position (mm) of each individual Gridfinity unit foot (0..width, 0..length).
 * Useful for placing the gridX * gridY 35.6->37.2->41.5mm stepped base feet.
 */
export function getUnitFootCenters(gridX: number, gridY: number): { col: number; row: number; cx: number; cy: number }[] {
  const centers: { col: number; row: number; cx: number; cy: number }[] = [];
  for (let row = 0; row < gridY; row++) {
    for (let col = 0; col < gridX; col++) {
      // Each cell's center sits at (index * 42) + 20.75 in [0, width] space
      // Wait: pitch is 42.0mm, and outer edge has 0.25mm clearance on left & right,
      // so cell center is (col + 0.5) * GRID_UNIT - GRID_TOLERANCE / 2
      centers.push({
        col,
        row,
        cx: (col + 0.5) * GRID_UNIT - GRID_TOLERANCE / 2,
        cy: (row + 0.5) * GRID_UNIT - GRID_TOLERANCE / 2,
      });
    }
  }
  return centers;
}

/**
 * Parametric Gridfinity stackable lip profile for an adjustable lip wall height (mm).
 * Standard 5.0mm lip: 0.7mm lower 45° bevel + 2.4mm vertical wall + 1.9mm upper 45° bevel.
 * Adjusting lipHeight >= 2.6mm extends/shortens the inner vertical stacking wall while preserving the 45° interlock bevels.
 */
export function getStackingLipProfile(lipHeightMm: number): {
  enabled: boolean;
  height: number;
  lowerBevelH: number;
  verticalWallH: number;
  upperBevelH: number;
  bottomInset: number;
  midInset: number;
  topInset: number;
} {
  const h = Math.max(0, Math.round(lipHeightMm * 100) / 100);
  if (h < 0.2) {
    return {
      enabled: false,
      height: 0,
      lowerBevelH: 0,
      verticalWallH: 0,
      upperBevelH: 0,
      bottomInset: 0,
      midInset: 0,
      topInset: 0,
    };
  }

  const baseBevels = 0.7 + 1.9; // 2.6mm combined 45° bevels
  if (h >= baseBevels) {
    return {
      enabled: true,
      height: h,
      lowerBevelH: 0.7,
      verticalWallH: Math.round((h - baseBevels) * 1000) / 1000,
      upperBevelH: 1.9,
      bottomInset: STACKING_LIP_BOTTOM_INSET,
      midInset: STACKING_LIP_MID_INSET,
      topInset: STACKING_LIP_TOP_INSET,
    };
  }

  const scale = h / baseBevels;
  return {
    enabled: true,
    height: h,
    lowerBevelH: 0.7 * scale,
    verticalWallH: 0,
    upperBevelH: 1.9 * scale,
    bottomInset: STACKING_LIP_TOP_INSET + (STACKING_LIP_BOTTOM_INSET - STACKING_LIP_TOP_INSET) * scale,
    midInset: STACKING_LIP_TOP_INSET + (STACKING_LIP_MID_INSET - STACKING_LIP_TOP_INSET) * scale,
    topInset: STACKING_LIP_TOP_INSET,
  };
}

/**
 * Calculates magnet/screw hole positions according to the selected mode:
 * - 'corners': 4 outermost corners of the overall multi-unit bin
 * - 'full': 4 corner holes inside EVERY 1x1 Gridfinity unit
 * - 'none': empty list (0 holes)
 */
export function getMagnetPositions(gridX: number, gridY: number, mode: MagnetMode): Point2D[] {
  if (mode === 'none') return [];
  if (mode === 'corners') return getFourOuterCornerMagnetPositions(gridX, gridY);

  // 'full': 4 magnets per 1x1 Gridfinity unit (each 4.8mm inside 35.6mm foot edge = 13.0mm from unit center)
  const unitOffset = BASE_FOOT_TOP_SIZE / 2 - MAGNET_CORNER_INSET; // 20.75 - 7.75 = 13.0mm
  const positions: Point2D[] = [];
  const centers = getUnitFootCenters(gridX, gridY);
  for (const unit of centers) {
    positions.push(
      { x: unit.cx - unitOffset, y: unit.cy - unitOffset },
      { x: unit.cx + unitOffset, y: unit.cy - unitOffset },
      { x: unit.cx - unitOffset, y: unit.cy + unitOffset },
      { x: unit.cx + unitOffset, y: unit.cy + unitOffset }
    );
  }
  return positions;
}

/**
 * Calculates exactly 4 magnet/screw hole positions at the 4 outermost corners
 * of the overall design (farthest corner of each outer gridfinity unit).
 * Placed 4.8mm inside the 35.6mm foot edge = 7.75mm from the 41.5mm outer wall.
 */
export function getFourOuterCornerMagnetPositions(gridX: number, gridY: number): Point2D[] {
  const width = gridX * GRID_UNIT - GRID_TOLERANCE;
  const length = gridY * GRID_UNIT - GRID_TOLERANCE;

  const bl: Point2D = {
    x: MAGNET_CORNER_INSET,
    y: MAGNET_CORNER_INSET,
  };

  const br: Point2D = {
    x: width - MAGNET_CORNER_INSET,
    y: MAGNET_CORNER_INSET,
  };

  const tl: Point2D = {
    x: MAGNET_CORNER_INSET,
    y: length - MAGNET_CORNER_INSET,
  };

  const tr: Point2D = {
    x: width - MAGNET_CORNER_INSET,
    y: length - MAGNET_CORNER_INSET,
  };

  return [bl, br, tl, tr];
}

/**
 * Rotates a point around origin (0, 0) by angle in degrees.
 */
export function rotatePoint(p: Point2D, angleDeg: number): Point2D {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

/**
 * Gets transformed points of a placed tool (rotation + translation).
 */
export function getTransformedContour(tool: PlacedTool): Point2D[] {
  return tool.tool.contour.map((pt) => {
    const rotated = rotatePoint(pt, tool.rotation);
    return {
      x: rotated.x + tool.x,
      y: rotated.y + tool.y,
    };
  });
}

/**
 * Gets the bounding box of a placed tool in bin coordinates.
 */
export function getToolBounds(tool: PlacedTool): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  const pts: Point2D[] = [...getTransformedContour(tool)];
  const pockets =
    tool.fingerPockets && tool.fingerPockets.length > 0
      ? tool.fingerPockets
      : tool.tool.fingerPockets;

  for (const pocket of pockets) {
    const localPill = generatePillContour(pocket, 8);
    for (const p of localPill) {
      const rot = rotatePoint(p, tool.rotation);
      pts.push({ x: rot.x + tool.x, y: rot.y + tool.y });
    }
  }

  if (pts.length === 0) {
    return {
      minX: tool.x,
      maxX: tool.x,
      minY: tool.y,
      maxY: tool.y,
      width: 0,
      height: 0,
      centerX: tool.x,
      centerY: tool.y,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Gets collective bounding box of all placed tools.
 */
export function getAllToolsBounds(tools: PlacedTool[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} | null {
  if (tools.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const t of tools) {
    const b = getToolBounds(t);
    if (b.minX < minX) minX = b.minX;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Recenters the collective design on the Gridfinity bin.
 * Replaces old horizontal / vertical / symmetry align tools with a unified Recenter tool.
 */
export function recenterToolsOnGrid(
  tools: PlacedTool[],
  gridWidth: number,
  gridHeight: number
): PlacedTool[] {
  const bounds = getAllToolsBounds(tools);
  if (!bounds) return tools;

  const targetCenterX = gridWidth / 2;
  const targetCenterY = gridHeight / 2;

  const dx = targetCenterX - bounds.centerX;
  const dy = targetCenterY - bounds.centerY;

  return tools.map((t) => ({
    ...t,
    x: Math.round((t.x + dx) * 10) / 10,
    y: Math.round((t.y + dy) * 10) / 10,
  }));
}

/**
 * Automatically determines the suitable number of Gridfinity units (cols × rows)
 * and safe bin height to fit all tools cleanly with wall/lip/chamfer margin,
 * optionally picks the most space-efficient 0°/90° orientation for single tools,
 * and centers the entire design on the generated grid.
 */
export function calculateAutoGridfinityLayout(
  tools: PlacedTool[],
  config: GridfinityConfig,
  options?: { optimizeOrientation?: boolean }
): {
  gridX: number;
  gridY: number;
  gridZ: number;
  customHeightMm: number;
  tools: PlacedTool[];
} {
  const currentHeightMm = config.customHeightMm ?? config.gridZ * HEIGHT_UNIT_MM;
  if (tools.length === 0) {
    return {
      gridX: config.gridX,
      gridY: config.gridY,
      gridZ: config.gridZ,
      customHeightMm: currentHeightMm,
      tools,
    };
  }

  const lipVal = config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
  const lipInfo = getStackingLipProfile(lipVal);
  const marginPerSide =
    (lipInfo.enabled ? lipInfo.bottomInset + 0.8 : config.wallThickness + 0.8) +
    Math.max(0, config.chamferSize);

  const unitsForSpan = (spanMm: number) =>
    Math.max(
      1,
      Math.min(12, Math.ceil((spanMm + 2 * marginPerSide + GRID_TOLERANCE) / GRID_UNIT))
    );

  let workingTools = tools;

  if (options?.optimizeOrientation && tools.length === 1) {
    const t = tools[0];
    const cand0 = { ...t, rotation: 0 };
    const cand90 = { ...t, rotation: 90 };
    const b0 = getToolBounds(cand0);
    const b90 = getToolBounds(cand90);
    const gx0 = unitsForSpan(b0.width);
    const gy0 = unitsForSpan(b0.height);
    const gx90 = unitsForSpan(b90.width);
    const gy90 = unitsForSpan(b90.height);
    const area0 = gx0 * gy0;
    const area90 = gx90 * gy90;

    // Choose orientation minimizing total units; tie-breaker favors landscape (gx >= gy)
    if (area90 < area0 || (area90 === area0 && gx90 >= gy90 && gx0 < gy0)) {
      workingTools = [cand90];
    } else {
      workingTools = [cand0];
    }
  }

  const allBounds = getAllToolsBounds(workingTools);
  const reqGridX = allBounds ? unitsForSpan(allBounds.width) : config.gridX;
  const reqGridY = allBounds ? unitsForSpan(allBounds.height) : config.gridY;

  let maxDepth = 0;
  for (const t of workingTools) {
    maxDepth = Math.max(maxDepth, t.depthOverride ?? t.tool.depth);
    const pockets = t.fingerPockets?.length ? t.fingerPockets : t.tool.fingerPockets;
    for (const p of pockets) {
      maxDepth = Math.max(maxDepth, p.depth);
    }
  }
  const minSafeHeightMm = Math.max(
    21,
    Math.ceil((maxDepth + BASE_PROFILE_HEIGHT + 2.2) / HEIGHT_UNIT_MM) * HEIGHT_UNIT_MM
  );
  const nextHeightMm = Math.min(84, Math.max(currentHeightMm, minSafeHeightMm));
  const nextGridZ = Math.max(1, Math.round(nextHeightMm / HEIGHT_UNIT_MM));

  const { width: newBinWidth, length: newBinLength } = getBinDimensions(
    reqGridX,
    reqGridY,
    nextGridZ,
    nextHeightMm
  );

  const centeredTools = recenterToolsOnGrid(workingTools, newBinWidth, newBinLength);

  return {
    gridX: reqGridX,
    gridY: reqGridY,
    gridZ: nextGridZ,
    customHeightMm: nextHeightMm,
    tools: centeredTools,
  };
}

/**
 * Finds the clearest centered-X label position (on open deck outside tool cutouts)
 * preferring foreground/top margin when deck clearance exists.
 */
export function findBestClearTextPosition(
  tools: PlacedTool[],
  binWidth: number,
  binLength: number,
  fontSize: number = 9
): Point2D {
  const cx = Math.round((binWidth / 2) * 10) / 10;
  const halfText = Math.max(4, fontSize * 0.5 + 1.5);
  const safeMinY = Math.min(binLength / 2, 4.5 + halfText);
  const safeMaxY = Math.max(binLength / 2, binLength - 4.5 - halfText);

  if (tools.length === 0) {
    return { x: cx, y: Math.round((binLength / 2) * 10) / 10 };
  }

  const allBounds = getAllToolsBounds(tools);
  if (!allBounds) {
    return { x: cx, y: Math.round((binLength / 2) * 10) / 10 };
  }

  const frontClear = allBounds.minY - halfText - 3.0; // clear space near y=0 (foreground in 3D Iso)
  const backClear = binLength - 3.5 - (allBounds.maxY + halfText);

  if (frontClear >= 4.0) {
    const targetY = Math.max(safeMinY, Math.min(binLength / 2, (4.2 + allBounds.minY) / 2));
    return { x: cx, y: Math.round(targetY * 10) / 10 };
  }
  if (backClear >= 4.0) {
    const targetY = Math.min(safeMaxY, Math.max(binLength / 2, (binLength - 4.2 + allBounds.maxY) / 2));
    return { x: cx, y: Math.round(targetY * 10) / 10 };
  }

  return { x: cx, y: Math.round(safeMinY * 10) / 10 };
}

/**
 * Smart Snapping Detection:
 * Detects existing tool contours (edges and centerlines) and grid lines,
 * snaps the moving tool to them, and returns active visual guide lines.
 */
export function findSmartSnapping(
  movingTool: PlacedTool,
  otherTools: PlacedTool[],
  gridWidth: number,
  gridHeight: number,
  snapToleranceMm: number = 2.5
): {
  snappedX: number;
  snappedY: number;
  guides: SnapGuide[];
} {
  let snappedX = movingTool.x;
  let snappedY = movingTool.y;
  const guides: SnapGuide[] = [];

  // Compute moving tool bounding box relative to its current (x, y)
  const currentBounds = getToolBounds(movingTool);
  const offsetXFromCenter = {
    left: currentBounds.minX - movingTool.x,
    center: currentBounds.centerX - movingTool.x,
    right: currentBounds.maxX - movingTool.x,
  };
  const offsetYFromCenter = {
    top: currentBounds.minY - movingTool.y,
    center: currentBounds.centerY - movingTool.y,
    bottom: currentBounds.maxY - movingTool.y,
  };

  // Collect candidate target vertical lines (X coords) and horizontal lines (Y coords)
  const verticalTargets: { pos: number; label: string; source: SnapGuide['source'] }[] = [];
  const horizontalTargets: { pos: number; label: string; source: SnapGuide['source'] }[] = [];

  // 1. Grid center lines
  verticalTargets.push({ pos: gridWidth / 2, label: 'Grid Center X', source: 'grid-center' });
  horizontalTargets.push({ pos: gridHeight / 2, label: 'Grid Center Y', source: 'grid-center' });

  // 2. Existing tools: Left, Center, Right, Top, Center, Bottom
  for (const other of otherTools) {
    if (other.instanceId === movingTool.instanceId) continue;
    const b = getToolBounds(other);
    const name = other.tool.name;

    verticalTargets.push({ pos: b.minX, label: `${name} Left`, source: 'tool-edge' });
    verticalTargets.push({ pos: b.centerX, label: `${name} Center`, source: 'tool-center' });
    verticalTargets.push({ pos: b.maxX, label: `${name} Right`, source: 'tool-edge' });

    horizontalTargets.push({ pos: b.minY, label: `${name} Top`, source: 'tool-edge' });
    horizontalTargets.push({ pos: b.centerY, label: `${name} Center`, source: 'tool-center' });
    horizontalTargets.push({ pos: b.maxY, label: `${name} Bottom`, source: 'tool-edge' });
  }

  // Find best X snap
  let bestDeltaX = Infinity;
  let bestSnapX: number | null = null;
  let bestGuideX: SnapGuide | null = null;

  const testXPoints = [
    { key: 'left', offset: offsetXFromCenter.left },
    { key: 'center', offset: offsetXFromCenter.center },
    { key: 'right', offset: offsetXFromCenter.right },
  ];

  for (const pt of testXPoints) {
    const currentWorldX = movingTool.x + pt.offset;
    for (const target of verticalTargets) {
      const delta = Math.abs(currentWorldX - target.pos);
      if (delta <= snapToleranceMm && delta < bestDeltaX) {
        bestDeltaX = delta;
        bestSnapX = target.pos - pt.offset;
        bestGuideX = {
          type: 'x',
          position: target.pos,
          source: target.source,
          label: target.label,
          from: 0,
          to: gridHeight,
        };
      }
    }
  }

  if (bestSnapX !== null && bestGuideX !== null) {
    snappedX = bestSnapX;
    guides.push(bestGuideX);
  }

  // Find best Y snap
  let bestDeltaY = Infinity;
  let bestSnapY: number | null = null;
  let bestGuideY: SnapGuide | null = null;

  const testYPoints = [
    { key: 'top', offset: offsetYFromCenter.top },
    { key: 'center', offset: offsetYFromCenter.center },
    { key: 'bottom', offset: offsetYFromCenter.bottom },
  ];

  for (const pt of testYPoints) {
    const currentWorldY = movingTool.y + pt.offset;
    for (const target of horizontalTargets) {
      const delta = Math.abs(currentWorldY - target.pos);
      if (delta <= snapToleranceMm && delta < bestDeltaY) {
        bestDeltaY = delta;
        bestSnapY = target.pos - pt.offset;
        bestGuideY = {
          type: 'y',
          position: target.pos,
          source: target.source,
          label: target.label,
          from: 0,
          to: gridWidth,
        };
      }
    }
  }

  if (bestSnapY !== null && bestGuideY !== null) {
    snappedY = bestSnapY;
    guides.push(bestGuideY);
  }

  return { snappedX, snappedY, guides };
}

/**
 * Ray-casting point-in-polygon check for interactive 2D tool & pill selection.
 */
export function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Generates polygon points for a negative pill / rounded slot finger pocket.
 * Supports independent length, width, and cornerRadius:
 * - When cornerRadius == min(width, length)/2, creates a classic full-pill capsule.
 * - Smaller cornerRadius values create a rounded-corner finger cutout slot.
 */
export function generatePillContour(pocket: FingerPocket, numArcPoints: number = 20): Point2D[] {
  const { width, length, rotation, cornerRadius } = pocket;
  const hx = Math.max(2, length / 2);
  const hy = Math.max(2, width / 2);
  const r = Math.max(0.5, Math.min(cornerRadius ?? hy, hx, hy));
  const segsPerCorner = Math.max(3, Math.ceil(numArcPoints / 2));

  const corners = [
    { cx: hx - r, cy: hy - r, startA: 0, endA: Math.PI / 2 }, // Top-right
    { cx: -(hx - r), cy: hy - r, startA: Math.PI / 2, endA: Math.PI }, // Top-left
    { cx: -(hx - r), cy: -(hy - r), startA: Math.PI, endA: (3 * Math.PI) / 2 }, // Bottom-left
    { cx: hx - r, cy: -(hy - r), startA: (3 * Math.PI) / 2, endA: Math.PI * 2 }, // Bottom-right
  ];

  const localPts: Point2D[] = [];
  for (const c of corners) {
    for (let i = 0; i <= segsPerCorner; i++) {
      const a = c.startA + (i / segsPerCorner) * (c.endA - c.startA);
      const px = c.cx + r * Math.cos(a);
      const py = c.cy + r * Math.sin(a);
      const prev = localPts[localPts.length - 1];
      if (!prev || Math.hypot(px - prev.x, py - prev.y) > 1e-4) {
        localPts.push({ x: px, y: py });
      }
    }
  }

  // Drop duplicate closure point if first == last
  if (localPts.length > 3) {
    const first = localPts[0];
    const last = localPts[localPts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
      localPts.pop();
    }
  }

  // Rotate and translate by pocket offset
  return localPts.map((p) => {
    const rot = rotatePoint(p, rotation);
    return {
      x: rot.x + pocket.x,
      y: rot.y + pocket.y,
    };
  });
}

/**
 * Perpendicular distance from point P to line segment AB.
 */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lineLengthSq = dx * dx + dy * dy;
  if (lineLengthSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lineLengthSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const rx = p.x - projX;
  const ry = p.y - projY;
  return Math.sqrt(rx * rx + ry * ry);
}

/**
 * Ramer-Douglas-Peucker polygon contour decimation.
 * Drastically reduces dense point clouds (e.g. 1000 down to 40)
 * to maintain silky-smooth 60fps dragging and instant geometry updates.
 */
export function simplifyContour(points: Point2D[], tolerance: number = 0.3): Point2D[] {
  if (points.length <= 4) return points;

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[end]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyContour(points.slice(0, index + 1), tolerance);
    const right = simplifyContour(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [points[0], points[end]];
  }
}
