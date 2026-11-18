import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBinDimensions,
  getUnitFootCenters,
  getFourOuterCornerMagnetPositions,
  getMagnetPositions,
  getStackingLipProfile,
  recenterToolsOnGrid,
  calculateAutoGridfinityLayout,
  findSmartSnapping,
  generatePillContour,
  simplifyContour,
  GRID_UNIT,
  GRID_TOLERANCE,
  MAGNET_CORNER_INSET,
  BASE_PROFILE_HEIGHT,
  BASE_FOOT_BOTTOM_SIZE,
  BASE_FOOT_MID_SIZE,
  BASE_FOOT_TOP_SIZE,
  CORNER_RADIUS,
  BASE_MID_CORNER_RADIUS,
  BASE_BOTTOM_CORNER_RADIUS,
} from './geometry';
import { normalizeCapslockText, buildTextMultiPolygon } from './vectorText';
import { PlacedTool, ToolDef, FingerPocket, GridfinityConfig } from '../types';

const mockToolDef: ToolDef = {
  id: 'tool-test',
  name: 'Test Wrench',
  category: 'Wrenches',
  contour: [
    { x: -10, y: -20 },
    { x: 10, y: -20 },
    { x: 10, y: 20 },
    { x: -10, y: 20 },
  ],
  depth: 10,
  clearance: 0.5,
  fingerPockets: [],
};

test('Gridfinity v5 reference dimensions match 42mm pitch, 41.5mm outer, 35.6mm base, and 4.75mm profile', () => {
  assert.equal(GRID_UNIT, 42.0);
  assert.equal(GRID_TOLERANCE, 0.5);
  assert.ok(Math.abs(BASE_PROFILE_HEIGHT - 4.75) < 1e-9);
  assert.ok(Math.abs(BASE_FOOT_TOP_SIZE - 41.5) < 1e-9);
  assert.ok(Math.abs(BASE_FOOT_MID_SIZE - 37.2) < 1e-9);
  assert.ok(Math.abs(BASE_FOOT_BOTTOM_SIZE - 35.6) < 1e-9);
  assert.equal(CORNER_RADIUS, 3.75); // 7.5 diameter
  assert.equal(BASE_MID_CORNER_RADIUS, 1.6); // 3.2 diameter
  assert.equal(BASE_BOTTOM_CORNER_RADIUS, 0.8); // 1.6 diameter
  assert.ok(Math.abs(MAGNET_CORNER_INSET - 7.75) < 1e-9); // 2.15 + 0.8 + 4.8

  // 1x1x1U reference size
  const dims1x1 = getBinDimensions(1, 1, 1);
  assert.equal(dims1x1.width, 41.5);
  assert.equal(dims1x1.length, 41.5);
  assert.equal(dims1x1.height, 7.0);

  // Arbitrary 6 columns x 4 rows grid
  const dims6x4 = getBinDimensions(6, 4, 3);
  assert.equal(dims6x4.width, 6 * 42 - 0.5); // 251.5mm
  assert.equal(dims6x4.length, 4 * 42 - 0.5); // 167.5mm
  assert.equal(dims6x4.height, 21.0); // 3 * 7mm

  const feet = getUnitFootCenters(6, 4);
  assert.equal(feet.length, 24);
  assert.equal(feet[0].cx, 20.75);
  assert.equal(feet[0].cy, 20.75);
  assert.equal(feet[5].cx, 5 * 42 + 20.75);
});

test('getFourOuterCornerMagnetPositions returns exactly 4 outermost corners with 26mm 1x1 spacing', () => {
  // 1x1 unit: spacing between opposing magnets must equal 26.0mm (41.5 - 2*7.75)
  const magnets1x1 = getFourOuterCornerMagnetPositions(1, 1);
  assert.equal(magnets1x1.length, 4);
  assert.ok(Math.abs(magnets1x1[1].x - magnets1x1[0].x - 26.0) < 1e-9);

  // 2x2 grid (4 units)
  const magnets2x2 = getFourOuterCornerMagnetPositions(2, 2);
  assert.equal(magnets2x2.length, 4);

  const width = 2 * GRID_UNIT - GRID_TOLERANCE;
  const length = 2 * GRID_UNIT - GRID_TOLERANCE;

  assert.deepEqual(magnets2x2[0], { x: MAGNET_CORNER_INSET, y: MAGNET_CORNER_INSET });
  assert.deepEqual(magnets2x2[1], { x: width - MAGNET_CORNER_INSET, y: MAGNET_CORNER_INSET });
  assert.deepEqual(magnets2x2[2], { x: MAGNET_CORNER_INSET, y: length - MAGNET_CORNER_INSET });
  assert.deepEqual(magnets2x2[3], { x: width - MAGNET_CORNER_INSET, y: length - MAGNET_CORNER_INSET });
});

test('getMagnetPositions supports corners (4 total), full (4 per unit), and none (0)', () => {
  assert.equal(getMagnetPositions(4, 2, 'corners').length, 4);
  assert.equal(getMagnetPositions(4, 2, 'none').length, 0);

  const full4x2 = getMagnetPositions(4, 2, 'full');
  assert.equal(full4x2.length, 4 * 2 * 4); // 32 magnets total (4 per unit)
  // First unit's left-to-right magnet spacing should be 26mm
  assert.ok(Math.abs(full4x2[1].x - full4x2[0].x - 26.0) < 1e-9);
});

test('getStackingLipProfile handles 0mm, standard 5mm, and custom taller stackable lip heights', () => {
  const off = getStackingLipProfile(0);
  assert.equal(off.enabled, false);
  assert.equal(off.height, 0);

  const std = getStackingLipProfile(5.0);
  assert.equal(std.enabled, true);
  assert.equal(std.height, 5.0);
  assert.ok(Math.abs(std.lowerBevelH - 0.7) < 1e-6);
  assert.ok(Math.abs(std.verticalWallH - 2.4) < 1e-6);
  assert.ok(Math.abs(std.upperBevelH - 1.9) < 1e-6);

  const tall = getStackingLipProfile(8.0);
  assert.equal(tall.enabled, true);
  assert.ok(Math.abs(tall.lowerBevelH + tall.verticalWallH + tall.upperBevelH - 8.0) < 1e-6);
  assert.ok(Math.abs(tall.verticalWallH - 5.4) < 1e-6);

  const compact = getStackingLipProfile(1.3);
  assert.equal(compact.enabled, true);
  assert.equal(compact.verticalWallH, 0);
  assert.ok(Math.abs(compact.lowerBevelH + compact.upperBevelH - 1.3) < 1e-6);
});

test('recenterToolsOnGrid centers all placed tools on the tray', () => {
  const toolA: PlacedTool = {
    instanceId: 'inst-1',
    toolId: 'tool-test',
    tool: mockToolDef,
    x: 20,
    y: 20,
    rotation: 0,
    fingerPockets: [],
  };

  const trayWidth = 84;
  const trayHeight = 84;

  const recentered = recenterToolsOnGrid([toolA], trayWidth, trayHeight);
  assert.equal(recentered[0].x, 42);
  assert.equal(recentered[0].y, 42);
});

test('calculateAutoGridfinityLayout auto-sizes units and centers tool with optional landscape orientation', () => {
  const baseConfig: GridfinityConfig = {
    gridX: 4,
    gridY: 4,
    gridZ: 4,
    customHeightMm: 28,
    wallThickness: 1.6,
    floorThickness: 6.0,
    chamferSize: 1.0,
    hasStackingLip: true,
    lipHeight: 5.0,
    hasMagnets: true,
    magnetMode: 'corners',
    magnetDiameter: 6.5,
    magnetDepth: 2.4,
    hasScrews: false,
    screwDiameter: 3.0,
    smartSnapping: true,
    snapTolerance: 2.5,
  };

  // Compact 20x40 tool should shrink an oversized 4x4 bin down to 2x1 and center it
  const smallPlaced: PlacedTool = {
    instanceId: 'inst-small',
    toolId: 'tool-test',
    tool: mockToolDef,
    x: 25,
    y: 120,
    rotation: 0,
    fingerPockets: [],
  };

  const shrunk = calculateAutoGridfinityLayout([smallPlaced], baseConfig, {
    optimizeOrientation: true,
  });
  // mockToolDef is 20x40; with clearance 0.5 -> 21x41, plus margins -> fits tightly in 2x1 (83.5 x 41.5 -> wait: 41 + 2*~3.5 = 48 -> needs 2 units along long axis, 1 unit along 21mm axis -> 2x1)
  assert.equal(shrunk.gridX, 2);
  assert.equal(shrunk.gridY, 1);
  assert.equal(shrunk.tools[0].rotation, 90);
  const shrunkDims = getBinDimensions(shrunk.gridX, shrunk.gridY, shrunk.gridZ, shrunk.customHeightMm);
  assert.ok(Math.abs(shrunk.tools[0].x - shrunkDims.width / 2) < 0.15);
  assert.ok(Math.abs(shrunk.tools[0].y - shrunkDims.length / 2) < 0.15);

  // Large 155x65 tool should expand bin and center cleanly
  const largeDef: ToolDef = {
    ...mockToolDef,
    contour: [
      { x: -77, y: -32 },
      { x: 77, y: -32 },
      { x: 77, y: 32 },
      { x: -77, y: 32 },
    ],
  };
  const largePlaced: PlacedTool = {
    instanceId: 'inst-large',
    toolId: 'tool-large',
    tool: largeDef,
    x: 15,
    y: 15,
    rotation: 0,
    fingerPockets: [],
  };

  const expanded = calculateAutoGridfinityLayout([largePlaced], { ...baseConfig, gridX: 2, gridY: 1 });
  assert.ok(expanded.gridX >= 4);
  assert.ok(expanded.gridY >= 2);
  const expDims = getBinDimensions(expanded.gridX, expanded.gridY, expanded.gridZ, expanded.customHeightMm);
  assert.ok(Math.abs(expanded.tools[0].x - expDims.width / 2) < 0.15);
  assert.ok(Math.abs(expanded.tools[0].y - expDims.length / 2) < 0.15);
});

test('normalizeCapslockText & buildTextMultiPolygon force CAPSLOCK and preserve interior glyph holes', () => {
  assert.equal(normalizeCapslockText('12mm wrench'), '12MM WRENCH');

  const mp = buildTextMultiPolygon({
    text: 'ab0o',
    mode: 'engrave',
    fontSize: 10,
    depth: 1.0,
    x: 50,
    y: 30,
    rotation: 0,
  });

  // 'A', 'B', '0', 'O' all produce valid polygons with interior holes (ring count > 1)
  assert.ok(mp.length >= 4);
  assert.ok(mp.some((poly) => poly.length >= 2), 'Expected interior holes on closed glyphs like A, B, O, 0');
});

test('findSmartSnapping aligns to center and tool edges with visual guides', () => {
  const tool1: PlacedTool = {
    instanceId: 'tool-1',
    toolId: 't1',
    tool: mockToolDef,
    x: 42,
    y: 42,
    rotation: 0,
    fingerPockets: [],
  };

  // Tool 2 close to center X (at x=43, tolerance=2.5mm)
  const movingTool: PlacedTool = {
    instanceId: 'tool-2',
    toolId: 't2',
    tool: mockToolDef,
    x: 43,
    y: 20,
    rotation: 0,
    fingerPockets: [],
  };

  const snap = findSmartSnapping(movingTool, [tool1], 84, 84, 2.5);
  // Snapped to center X = 42
  assert.equal(snap.snappedX, 42);
  assert.ok(snap.guides.length > 0);
  assert.ok(snap.guides.some((g) => g.type === 'x'));
});

test('generatePillContour creates smooth rounded pill shape and honors cornerRadius', () => {
  const pocket: FingerPocket = {
    id: 'fp-1',
    x: 0,
    y: 0,
    width: 20,
    length: 36,
    depth: 10,
    rotation: 0,
    cornerRadius: 10,
  };

  const pts = generatePillContour(pocket, 6);
  assert.ok(pts.length >= 12);
  const maxX = Math.max(...pts.map((p) => p.x));
  const minX = Math.min(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const minY = Math.min(...pts.map((p) => p.y));
  assert.ok(Math.abs(maxX - 18) < 0.1);
  assert.ok(Math.abs(minX - (-18)) < 0.1);
  assert.ok(Math.abs(maxY - 10) < 0.1);
  assert.ok(Math.abs(minY - (-10)) < 0.1);

  // With a tighter cornerRadius (e.g. 3mm), corner points sit much closer to (18, 10) than a full semicircle (r=10mm)
  const tightSlot = generatePillContour({ ...pocket, cornerRadius: 3 }, 8);
  const tightCornerDist = Math.min(...tightSlot.map((p) => Math.hypot(18 - p.x, 10 - p.y)));
  const pillCornerDist = Math.min(...pts.map((p) => Math.hypot(18 - p.x, 10 - p.y)));
  assert.ok(tightCornerDist < 1.5);
  assert.ok(pillCornerDist > 3.8);
});

test('simplifyContour reduces point count while preserving shape', () => {
  // A straight line with 10 collinear points in between
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0.01 },
    { x: 2, y: -0.01 },
    { x: 3, y: 0.02 },
    { x: 4, y: 0 },
    { x: 5, y: 5 }, // corner
    { x: 10, y: 5 },
  ];

  const simplified = simplifyContour(points, 0.1);
  assert.ok(simplified.length < points.length);
  assert.equal(simplified[0].x, 0);
  assert.equal(simplified[simplified.length - 1].x, 10);
});
