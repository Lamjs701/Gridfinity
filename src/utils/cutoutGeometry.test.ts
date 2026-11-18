import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offsetPolygonOutward,
  transformPocketContour,
  buildTopDeckAndCutouts,
} from './cutoutGeometry';
import { PlacedTool, Point2D, ToolDef } from '../types';

test('offsetPolygonOutward expands polygon outward symmetrically by chamfer width', () => {
  const square: Point2D[] = [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 10, y: 10 },
    { x: -10, y: 10 },
  ];

  const expanded = offsetPolygonOutward(square, 1.5);
  assert.equal(expanded.length, 4);
  assert.ok(Math.abs(Math.max(...expanded.map((p) => p.x)) - 11.5) < 1e-6);
  assert.ok(Math.abs(Math.min(...expanded.map((p) => p.x)) - (-11.5)) < 1e-6);
  assert.ok(Math.abs(Math.max(...expanded.map((p) => p.y)) - 11.5) < 1e-6);
  assert.ok(Math.abs(Math.min(...expanded.map((p) => p.y)) - (-11.5)) < 1e-6);
});

test('transformPocketContour applies both pocket and parent tool rotation', () => {
  const toolDef: ToolDef = {
    id: 't1',
    name: 'Wrench',
    category: 'Wrenches',
    contour: [],
    depth: 10,
    clearance: 0.5,
    fingerPockets: [],
  };

  const placed: PlacedTool = {
    instanceId: 'inst-1',
    toolId: 't1',
    tool: toolDef,
    x: 50,
    y: 40,
    rotation: 90,
    fingerPockets: [
      {
        id: 'fp-1',
        x: 0,
        y: 0,
        width: 16,
        length: 32,
        depth: 14,
        rotation: 0, // local X-axis pill -> rotated 90° should become world Y-axis
        cornerRadius: 8,
      },
    ],
  };

  const pts = transformPocketContour(placed.fingerPockets[0], placed, 6);
  const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const spanY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  assert.ok(Math.abs(spanX - 16) < 0.2);
  assert.ok(Math.abs(spanY - 32) < 0.2);
});

test('buildTopDeckAndCutouts creates 45° cutout chamfer and deeper adjustable pill floor', () => {
  const deck: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const safe: Point2D[] = [
    { x: 3, y: 3 },
    { x: 97, y: 3 },
    { x: 97, y: 97 },
    { x: 3, y: 97 },
  ];

  const toolDef: ToolDef = {
    id: 't-bar',
    name: 'Bar',
    category: 'Hand',
    contour: [
      { x: -30, y: -6 },
      { x: 30, y: -6 },
      { x: 30, y: 6 },
      { x: -30, y: 6 },
    ],
    depth: 10,
    clearance: 0.5,
    fingerPockets: [],
  };

  const placed: PlacedTool = {
    instanceId: 'inst-bar',
    toolId: 't-bar',
    tool: toolDef,
    x: 50,
    y: 50,
    rotation: 0,
    depthOverride: 10,
    fingerPockets: [
      {
        id: 'fp-1',
        x: 0,
        y: 0,
        width: 18,
        length: 30,
        depth: 16, // 6mm deeper than tool pocket
        rotation: 90,
        cornerRadius: 9,
      },
    ],
  };

  const topDeckZ = 28;
  const chamferSize = 1.5;
  const tris = buildTopDeckAndCutouts({
    topDeckBoundary: deck,
    safeCutoutBoundary: safe,
    tools: [placed],
    topDeckZ,
    chamferSize,
  });

  assert.ok(tris.length > 20);
  // Collect all Z coordinates present on horizontal faces
  const zVals = new Set<number>();
  for (const t of tris) {
    if (
      Math.abs(t.v1[2] - t.v2[2]) < 1e-4 &&
      Math.abs(t.v2[2] - t.v3[2]) < 1e-4
    ) {
      zVals.add(Math.round(t.v1[2] * 100) / 100);
    }
  }

  // Should have flat planes at topDeckZ (28), tool cavity floor (18), and pill cavity floor (12)
  assert.ok(zVals.has(28));
  assert.ok(zVals.has(18));
  assert.ok(zVals.has(12));

  // Should have 45° chamfer sloped triangles connecting Z=26.5 to Z=28
  const hasChamferSlope = tris.some(
    (t) =>
      (Math.abs(t.v1[2] - 26.5) < 1e-3 || Math.abs(t.v2[2] - 26.5) < 1e-3 || Math.abs(t.v3[2] - 26.5) < 1e-3) &&
      (Math.abs(t.v1[2] - 28) < 1e-3 || Math.abs(t.v2[2] - 28) < 1e-3 || Math.abs(t.v3[2] - 28) < 1e-3)
  );
  assert.equal(hasChamferSlope, true);
});

test('buildTopDeckAndCutouts keeps centered deck boundary intact when shiftX/shiftY shifts tools', () => {
  const centeredDeck: Point2D[] = [
    { x: -50, y: -50 },
    { x: 50, y: -50 },
    { x: 50, y: 50 },
    { x: -50, y: 50 },
  ];
  const centeredSafe: Point2D[] = [
    { x: -46, y: -46 },
    { x: 46, y: -46 },
    { x: 46, y: 46 },
    { x: -46, y: 46 },
  ];

  const toolDef: ToolDef = {
    id: 't-box',
    name: 'Box',
    category: 'Hand',
    contour: [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ],
    depth: 10,
    clearance: 0.5,
    fingerPockets: [],
  };

  const placed: PlacedTool = {
    instanceId: 'inst-box',
    toolId: 't-box',
    tool: toolDef,
    x: 50, // bin-space [0..100]
    y: 50,
    rotation: 0,
    depthOverride: 10,
    fingerPockets: [],
  };

  const tris = buildTopDeckAndCutouts({
    topDeckBoundary: centeredDeck,
    safeCutoutBoundary: centeredSafe,
    tools: [placed],
    topDeckZ: 28,
    chamferSize: 1.5,
    shiftX: -50,
    shiftY: -50,
  });

  const topDeckPts = tris
    .filter((t) => Math.abs(t.v1[2] - 28) < 1e-4 && Math.abs(t.v2[2] - 28) < 1e-4 && Math.abs(t.v3[2] - 28) < 1e-4)
    .flatMap((t) => [t.v1, t.v2, t.v3]);

  const minX = Math.min(...topDeckPts.map((p) => p[0]));
  const maxX = Math.max(...topDeckPts.map((p) => p[0]));
  const minY = Math.min(...topDeckPts.map((p) => p[1]));
  const maxY = Math.max(...topDeckPts.map((p) => p[1]));

  assert.ok(minX <= -49.9, `expected minX <= -49.9, got ${minX}`);
  assert.ok(maxX >= 49.9, `expected maxX >= 49.9, got ${maxX}`);
  assert.ok(minY <= -49.9, `expected minY <= -49.9, got ${minY}`);
  assert.ok(maxY >= 49.9, `expected maxY >= 49.9, got ${maxY}`);
});

test('buildTopDeckAndCutouts carves smooth rounded concave pill bowls (not flat cuts) with curved intermediate Z vertices', () => {
  const deck: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const safe: Point2D[] = [
    { x: 4, y: 4 },
    { x: 96, y: 4 },
    { x: 96, y: 96 },
    { x: 4, y: 96 },
  ];

  const standaloneTool: PlacedTool = {
    instanceId: 'inst-pill',
    toolId: 'pill-only',
    tool: {
      id: 'pill-only',
      name: 'Pill Slot',
      category: 'Finger Slots',
      contour: [],
      depth: 12,
      clearance: 0,
      fingerPockets: [],
    },
    x: 50,
    y: 50,
    rotation: 0,
    fingerPockets: [
      {
        id: 'fp-round',
        x: 0,
        y: 0,
        width: 20,
        length: 36,
        depth: 14,
        rotation: 0,
        cornerRadius: 10,
      },
    ],
  };

  const tris = buildTopDeckAndCutouts({
    topDeckBoundary: deck,
    safeCutoutBoundary: safe,
    tools: [standaloneTool],
    topDeckZ: 28,
    chamferSize: 1.5, // zChamferBottom = 26.5, floorZ = 14
  });

  // Check there are multiple curved intermediate Z steps strictly between floorZ (14) and zChamferBottom (26.5)
  const curvedZs = new Set<number>();
  for (const t of tris) {
    for (const v of [t.v1, t.v2, t.v3]) {
      if (v[2] > 14.2 && v[2] < 26.3) {
        curvedZs.add(Math.round(v[2] * 10) / 10);
      }
    }
  }
  assert.ok(
    curvedZs.size >= 5,
    `Expected smooth multi-ring concave pill curve (>=5 intermediate Z levels), got ${curvedZs.size}`
  );
});

test('buildTopDeckAndCutouts generates recessed engrave and raised emboss CAPSLOCK text triangles', () => {
  const deck: Point2D[] = [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 80 },
    { x: 0, y: 80 },
  ];
  const safe: Point2D[] = [
    { x: 4, y: 4 },
    { x: 116, y: 4 },
    { x: 116, y: 76 },
    { x: 4, y: 76 },
  ];

  const engravedTris = buildTopDeckAndCutouts({
    topDeckBoundary: deck,
    safeCutoutBoundary: safe,
    tools: [],
    topDeckZ: 28,
    chamferSize: 1.0,
    textLabel: {
      text: 'wrench',
      mode: 'engrave',
      fontSize: 10,
      depth: 1.2,
      x: 60,
      y: 40,
      rotation: 0,
    },
  });

  const hasEngraveFloor = engravedTris.some(
    (t) => Math.abs(t.v1[2] - 26.8) < 0.05 && Math.abs(t.v2[2] - 26.8) < 0.05 && Math.abs(t.v3[2] - 26.8) < 0.05
  );
  assert.equal(hasEngraveFloor, true, 'Expected engraved CAPSLOCK floor at topDeckZ - depth (26.8mm)');

  const embossedTris = buildTopDeckAndCutouts({
    topDeckBoundary: deck,
    safeCutoutBoundary: safe,
    tools: [],
    topDeckZ: 28,
    chamferSize: 1.0,
    textLabel: {
      text: '12mm',
      mode: 'emboss',
      fontSize: 10,
      depth: 1.2,
      x: 60,
      y: 40,
      rotation: 0,
    },
  });

  const hasEmbossCap = embossedTris.some(
    (t) => Math.abs(t.v1[2] - 29.2) < 0.05 && Math.abs(t.v2[2] - 29.2) < 0.05 && Math.abs(t.v3[2] - 29.2) < 0.05
  );
  assert.equal(hasEmbossCap, true, 'Expected embossed CAPSLOCK cap at topDeckZ + depth (29.2mm)');
});

test('rounded pill bowl maintains bounded rim slope and smooth analytical vertexNormals (no jagged Z-cliffs)', () => {
  const deck: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const safe: Point2D[] = [
    { x: 4, y: 4 },
    { x: 96, y: 4 },
    { x: 96, y: 96 },
    { x: 4, y: 96 },
  ];

  const barTool: PlacedTool = {
    instanceId: 'inst-bar',
    toolId: 'bar',
    tool: {
      id: 'bar',
      name: 'Bar',
      category: 'Hand',
      contour: [
        { x: -30, y: -8 },
        { x: 30, y: -8 },
        { x: 30, y: 8 },
        { x: -30, y: 8 },
      ],
      depth: 10,
      clearance: 0.5,
      fingerPockets: [],
    },
    x: 50,
    y: 50,
    rotation: 0,
    fingerPockets: [
      {
        id: 'fp-smooth',
        x: 0,
        y: 0,
        width: 20,
        length: 36,
        depth: 16,
        rotation: 90,
        cornerRadius: 10,
      },
    ],
  };

  const tris = buildTopDeckAndCutouts({
    topDeckBoundary: deck,
    safeCutoutBoundary: safe,
    tools: [barTool],
    topDeckZ: 28,
    chamferSize: 1.0,
  });

  const smoothTris = tris.filter((t) => t.vertexNormals !== undefined);
  assert.ok(smoothTris.length >= 24, 'Expected smooth vertexNormals on rounded pill bowl triangles');
  for (const t of smoothTris) {
    for (const vn of t.vertexNormals!) {
      const mag = Math.hypot(vn[0], vn[1], vn[2]);
      assert.ok(Math.abs(mag - 1) < 1e-4, `Expected unit normal, got ${mag}`);
      assert.ok(vn[2] > 0, 'Expected upward-pointing bowl normal');
    }
  }
});

test('overlapping 0° and 90° pills merge into one smooth compound bowl with zero internal crease walls', () => {
  const deck: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const safe: Point2D[] = [
    { x: 4, y: 4 },
    { x: 96, y: 4 },
    { x: 96, y: 96 },
    { x: 4, y: 96 },
  ];

  const toolWithCrossPills: PlacedTool = {
    instanceId: 'inst-cross',
    toolId: 'cross',
    tool: {
      id: 'cross',
      name: 'Cross Pills',
      category: 'Finger Slots',
      contour: [],
      depth: 10,
      clearance: 0,
      fingerPockets: [],
    },
    x: 50,
    y: 50,
    rotation: 0,
    fingerPockets: [
      {
        id: 'fp-h',
        x: 0,
        y: 0,
        width: 18,
        length: 44,
        depth: 14,
        rotation: 0,
        cornerRadius: 9,
      },
      {
        id: 'fp-v',
        x: 0,
        y: 0,
        width: 18,
        length: 44,
        depth: 14,
        rotation: 90,
        cornerRadius: 9,
      },
    ],
  };

  const tris = buildTopDeckAndCutouts({
    topDeckBoundary: deck,
    safeCutoutBoundary: safe,
    tools: [toolWithCrossPills],
    topDeckZ: 28,
    chamferSize: 1.0, // floorZ = 14
  });

  // Inside the central 12x12 overlapping core around (50,50), BOTH pills are near bottom keel (Z=14).
  // No triangle vertex inside the core should protrude up like an internal X-crease wall!
  const centerCoreHighVerts = tris.filter((t) => {
    const cx = (t.v1[0] + t.v2[0] + t.v3[0]) / 3;
    const cy = (t.v1[1] + t.v2[1] + t.v3[1]) / 3;
    const maxZ = Math.max(t.v1[2], t.v2[2], t.v3[2]);
    return Math.hypot(cx - 50, cy - 50) <= 5.5 && maxZ > 17.5;
  });

  assert.equal(
    centerCoreHighVerts.length,
    0,
    `Expected zero protruding internal crease triangles in overlapping center core, found ${centerCoreHighVerts.length}`
  );
});


