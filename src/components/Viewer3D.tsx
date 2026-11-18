import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
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
} from '../utils/geometry';
import { buildTopDeckAndCutouts } from '../utils/cutoutGeometry';
import earcut from 'earcut';
import { Layers } from 'lucide-react';

interface Viewer3DProps {
  config: GridfinityConfig;
  tools: PlacedTool[];
  selectedToolId: string | null;
}

export const Viewer3D: React.FC<Viewer3DProps> = ({
  config,
  tools,
  selectedToolId,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Material color preset (default Green for crisp CAD visibility)
  const [colorPreset, setColorPreset] = useState<'green' | 'slate' | 'orange' | 'white'>('green');
  const [viewPreset, setViewPreset] = useState<'iso' | 'top' | 'bottom'>('iso');
  const [wireframe, setWireframe] = useState<boolean>(false);

  // Three.js internal references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const isInteractingRef = useRef<boolean>(false);
  const needsRenderRef = useRef<boolean>(true);

  // Camera Orbit state
  const orbitRef = useRef<{
    theta: number; // horizontal angle
    phi: number; // vertical angle
    radius: number; // distance from center
    target: THREE.Vector3;
    isOrbiting: boolean;
    isPanning: boolean;
    lastMouseX: number;
    lastMouseY: number;
  }>({
    theta: Math.PI / 4,
    phi: Math.PI / 3,
    radius: 180,
    target: new THREE.Vector3(0, 0, 0),
    isOrbiting: false,
    isPanning: false,
    lastMouseX: 0,
    lastMouseY: 0,
  });

  const { width: binWidth, length: binLength, height: binHeight } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  // Build high-precision Three.js BufferGeometry for the Gridfinity Bin
  const buildBinGeometry = useCallback((): THREE.BufferGeometry => {
    const chamfer = Math.max(0.2, Math.min(3.0, config.chamferSize));
    const vertices: number[] = [];
    const normals: number[] = [];

    // Helper to push a triangle (preserving smooth per-vertex normals when provided)
    const addTri = (
      v1: [number, number, number],
      v2: [number, number, number],
      v3: [number, number, number],
      customNorm?: [number, number, number],
      vertexNormals?: [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]
    ) => {
      vertices.push(...v1, ...v2, ...v3);
      if (vertexNormals) {
        normals.push(...vertexNormals[0], ...vertexNormals[1], ...vertexNormals[2]);
        return;
      }

      let n = customNorm;
      if (!n) {
        const ax = v2[0] - v1[0], ay = v2[1] - v1[1], az = v2[2] - v1[2];
        const bx = v3[0] - v1[0], by = v3[1] - v1[1], bz = v3[2] - v1[2];
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        n = [nx / len, ny / len, nz / len];
      }

      normals.push(...n, ...n, ...n);
    };

    // Helper: Rounded rectangle polygon centered at (ox, oy)
    const createRoundedRectAt = (
      ox: number,
      oy: number,
      w: number,
      l: number,
      r: number,
      segs: number = 6
    ): Point2D[] => {
      const pts: Point2D[] = [];
      const rad = Math.min(r, w / 2, l / 2);
      const minX = ox - w / 2, maxX = ox + w / 2;
      const minY = oy - l / 2, maxY = oy + l / 2;

      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * (Math.PI / 2);
        pts.push({ x: maxX - rad + rad * Math.sin(a), y: maxY - rad + rad * Math.cos(a) });
      }
      for (let i = 0; i <= segs; i++) {
        const a = Math.PI / 2 + (i / segs) * (Math.PI / 2);
        pts.push({ x: maxX - rad + rad * Math.sin(a), y: minY + rad + rad * Math.cos(a) });
      }
      for (let i = 0; i <= segs; i++) {
        const a = Math.PI + (i / segs) * (Math.PI / 2);
        pts.push({ x: minX + rad + rad * Math.sin(a), y: minY + rad + rad * Math.cos(a) });
      }
      for (let i = 0; i <= segs; i++) {
        const a = (3 * Math.PI) / 2 + (i / segs) * (Math.PI / 2);
        pts.push({ x: minX + rad + rad * Math.sin(a), y: maxY - rad + rad * Math.cos(a) });
      }
      return pts;
    };

    const createRoundedRect = (w: number, l: number, r: number, segs: number = 8): Point2D[] =>
      createRoundedRectAt(0, 0, w, l, r, segs);

    // Helper: outward-facing quad strip between two clockwise rings at zA and zB
    const addRingStrip = (ringA: Point2D[], zA: number, ringB: Point2D[], zB: number) => {
      for (let i = 0; i < ringA.length; i++) {
        const next = (i + 1) % ringA.length;
        const a1 = ringA[i];
        const a2 = ringA[next];
        const b1 = ringB[i];
        const b2 = ringB[next];

        addTri([a1.x, a1.y, zA], [b2.x, b2.y, zB], [a2.x, a2.y, zA]);
        addTri([a1.x, a1.y, zA], [b1.x, b1.y, zB], [b2.x, b2.y, zB]);
      }
    };

    // 1. Per-unit Gridfinity v5 Stepped Base Feet (Z = 0 -> 4.75mm: 0.8 + 1.8 + 2.15mm)
    const z0 = 0;
    const z1 = BASE_LOWER_CHAMFER; // 0.8mm
    const z2 = BASE_LOWER_CHAMFER + BASE_VERTICAL_STEP; // 2.6mm
    const z3 = BASE_PROFILE_HEIGHT; // 4.75mm

    const footCenters = getUnitFootCenters(config.gridX, config.gridY);
    const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
    const hasHoleRecesses = magnetMode !== 'none' || config.hasScrews;
    const magnetPos = hasHoleRecesses
      ? getMagnetPositions(config.gridX, config.gridY, magnetMode !== 'none' ? magnetMode : 'corners').map((m) => ({
          x: m.x - binWidth / 2,
          y: m.y - binLength / 2,
        }))
      : [];
    const holeRadius = magnetMode !== 'none' ? config.magnetDiameter / 2 : config.screwDiameter / 2;
    const holeDepth = magnetMode !== 'none' ? config.magnetDepth : BASE_PROFILE_HEIGHT;

    for (const unit of footCenters) {
      const fx = unit.cx - binWidth / 2;
      const fy = unit.cy - binLength / 2;

      const r0 = createRoundedRectAt(fx, fy, BASE_FOOT_BOTTOM_SIZE, BASE_FOOT_BOTTOM_SIZE, BASE_BOTTOM_CORNER_RADIUS, 5);
      const r1 = createRoundedRectAt(fx, fy, BASE_FOOT_MID_SIZE, BASE_FOOT_MID_SIZE, BASE_MID_CORNER_RADIUS, 5);
      const r2 = r1;
      const r3 = createRoundedRectAt(fx, fy, BASE_FOOT_TOP_SIZE, BASE_FOOT_TOP_SIZE, CORNER_RADIUS, 5);

      // Stepped 45° / vertical base profile walls
      addRingStrip(r0, z0, r1, z1);
      addRingStrip(r1, z1, r2, z2);
      addRingStrip(r2, z2, r3, z3);

      // Bottom flat face (Z = 0), with magnet/screw holes cut out per active mode
      const footCoords: number[] = [];
      for (const p of r0) footCoords.push(p.x, p.y);
      const footHoles: number[] = [];

      if (hasHoleRecesses) {
        const halfFoot = BASE_FOOT_BOTTOM_SIZE / 2;
        for (const m of magnetPos) {
          if (Math.abs(m.x - fx) < halfFoot && Math.abs(m.y - fy) < halfFoot) {
            footHoles.push(footCoords.length / 2);
            const segs = 14;
            for (let s = 0; s < segs; s++) {
              const a = (s / segs) * Math.PI * 2;
              footCoords.push(m.x + holeRadius * Math.cos(a), m.y + holeRadius * Math.sin(a));
            }
          }
        }
      }

      const footBottomIdx = earcut(footCoords, footHoles.length > 0 ? footHoles : undefined);
      for (let i = 0; i < footBottomIdx.length; i += 3) {
        const idx1 = footBottomIdx[i] * 2;
        const idx2 = footBottomIdx[i + 1] * 2;
        const idx3 = footBottomIdx[i + 2] * 2;
        addTri(
          [footCoords[idx1], footCoords[idx1 + 1], 0],
          [footCoords[idx3], footCoords[idx3 + 1], 0],
          [footCoords[idx2], footCoords[idx2 + 1], 0],
          [0, 0, -1]
        );
      }
    }

    // 2. Magnet or Screw cylinder walls + ceiling (Z = 0 -> holeDepth)
    if (hasHoleRecesses) {
      for (const m of magnetPos) {
        const segs = 14;
        for (let s = 0; s < segs; s++) {
          const a1 = (s / segs) * Math.PI * 2;
          const a2 = ((s + 1) / segs) * Math.PI * 2;
          const x1 = m.x + holeRadius * Math.cos(a1);
          const y1 = m.y + holeRadius * Math.sin(a1);
          const x2 = m.x + holeRadius * Math.cos(a2);
          const y2 = m.y + holeRadius * Math.sin(a2);

          addTri([x1, y1, 0], [x2, y2, 0], [x1, y1, holeDepth]);
          addTri([x2, y2, 0], [x2, y2, holeDepth], [x1, y1, holeDepth]);
          addTri([m.x, m.y, holeDepth], [x2, y2, holeDepth], [x1, y1, holeDepth], [0, 0, 1]);
        }
      }
    }

    // Outer continuous footprint above base profile (Z = 4.75mm upward)
    const outerPts = createRoundedRect(binWidth, binLength, CORNER_RADIUS, 8);

    // Underside bridge plate at Z = 4.75mm so inter-unit 0.5mm gaps are sealed
    const bridgeCoords: number[] = [];
    for (const p of outerPts) bridgeCoords.push(p.x, p.y);
    const bridgeIndices = earcut(bridgeCoords);
    for (let i = 0; i < bridgeIndices.length; i += 3) {
      const p1 = outerPts[bridgeIndices[i]];
      const p2 = outerPts[bridgeIndices[i + 1]];
      const p3 = outerPts[bridgeIndices[i + 2]];
      addTri([p1.x, p1.y, z3], [p3.x, p3.y, z3], [p2.x, p2.y, z3], [0, 0, -1]);
    }

    // 3. Vertical Outer Walls + Adjustable Stackable Lip (NO outer rim chamfer — chamfer is for model cutouts!)
    const topDeckZ = Math.max(z3 + 1.5, binHeight);
    const requestedLipHeight = config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
    const lipProfile = getStackingLipProfile(requestedLipHeight);
    const outerWallTopZ = lipProfile.enabled ? topDeckZ + lipProfile.height : topDeckZ;
    addRingStrip(outerPts, z3, outerPts, outerWallTopZ);

    let deckBoundaryPts = outerPts;
    let safeCutoutPts = createRoundedRect(
      Math.max(10, binWidth - 2 * config.wallThickness),
      Math.max(10, binLength - 2 * config.wallThickness),
      Math.max(0.5, CORNER_RADIUS - config.wallThickness),
      8
    );

    if (lipProfile.enabled) {
      const zLipTop = topDeckZ + lipProfile.height;
      const zMidBot = topDeckZ + lipProfile.lowerBevelH;
      const zMidTop = zMidBot + lipProfile.verticalWallH;

      const makeInsetRing = (inset: number) =>
        createRoundedRect(
          Math.max(4, binWidth - inset * 2),
          Math.max(4, binLength - inset * 2),
          Math.max(0.5, CORNER_RADIUS - inset),
          8
        );

      const lipTopLand = makeInsetRing(lipProfile.topInset);
      const lipMidTop = makeInsetRing(lipProfile.midInset);
      const lipMidBot = lipMidTop;
      const lipInnerBot = makeInsetRing(lipProfile.bottomInset);

      addRingStrip(outerPts, zLipTop, lipTopLand, zLipTop); // flat top rim land
      addRingStrip(lipTopLand, zLipTop, lipMidTop, zMidTop); // upper 45° bevel
      if (lipProfile.verticalWallH > 1e-4) {
        addRingStrip(lipMidTop, zMidTop, lipMidBot, zMidBot); // inner vertical stacking wall
      }
      addRingStrip(lipMidBot, zMidBot, lipInnerBot, topDeckZ); // lower 45° bevel down to deck

      deckBoundaryPts = lipInnerBot;
      safeCutoutPts = makeInsetRing(lipProfile.bottomInset + 0.6);
    }

    // 4. Top Deck, 45° Model Cutout Chamfers, Tool Cavities, Rounded Negative Pill Slots & CAPSLOCK Text Relief
    const cutoutTris = buildTopDeckAndCutouts({
      topDeckBoundary: deckBoundaryPts,
      safeCutoutBoundary: safeCutoutPts,
      tools,
      topDeckZ,
      chamferSize: chamfer,
      textLabel: config.textLabel,
      shiftX: -binWidth / 2,
      shiftY: -binLength / 2,
    });

    for (const tri of cutoutTris) {
      addTri(tri.v1, tri.v2, tri.v3, tri.normal, tri.vertexNormals);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
  }, [binWidth, binLength, binHeight, config, tools]);

  // Initialize Three.js scene once
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const { clientWidth, clientHeight } = container;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d16);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(38, clientWidth / clientHeight, 1, 2000);
    cameraRef.current = camera;

    // Lighting (Studio three-point lighting)
    const ambLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(100, 150, 120);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.5);
    dirLight2.position.set(-120, -80, 80);
    scene.add(dirLight2);

    const floorLight = new THREE.DirectionalLight(0x38bdf8, 0.3);
    floorLight.position.set(0, 0, -100);
    scene.add(floorLight);

    // Renderer (Software WebGL friendly, on-demand render)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Mesh group for dynamic bin model
    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    // Ground shadow plane / subtle grid
    const gridHelper = new THREE.GridHelper(300, 30, 0x1e293b, 0x0f172a);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.z = -0.5;
    scene.add(gridHelper);

    // Update camera position from orbit coordinates
    const updateCamera = () => {
      const o = orbitRef.current;
      camera.position.x = o.target.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta);
      camera.position.y = o.target.y - o.radius * Math.sin(o.phi) * Math.cos(o.theta);
      camera.position.z = o.target.z + o.radius * Math.cos(o.phi);
      camera.up.set(0, 0, 1); // Z is UP in CAD!
      camera.lookAt(o.target);
      renderer.render(scene, camera);
    };

    updateCamera();

    // Render loop triggered when needsRenderRef is true
    let animId: number;
    const renderLoop = () => {
      if (needsRenderRef.current) {
        updateCamera();
        needsRenderRef.current = false;
      }
      animId = requestAnimationFrame(renderLoop);
    };
    animId = requestAnimationFrame(renderLoop);

    // Resize observer for container size changes (when swapping 2D/3D/Split)
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      needsRenderRef.current = true;
    };
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Debounced geometry update (ensures silky-smooth dragging without UI lag!)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!meshGroupRef.current) return;
      const group = meshGroupRef.current;

      // Dispose existing children to avoid memory leaks
      while (group.children.length > 0) {
        const obj = group.children[0] as THREE.Mesh;
        if (obj.geometry) obj.geometry.dispose();
        group.remove(obj);
      }

      // Material colors (Green default for high-contrast CAD legibility)
      const colorMap = {
        green: 0x22c55e,
        slate: 0x334155,
        orange: 0xea580c,
        white: 0xe2e8f0,
      };

      const material = new THREE.MeshStandardMaterial({
        color: colorMap[colorPreset],
        roughness: 0.42,
        metalness: 0.08,
        wireframe,
        side: THREE.DoubleSide,
      });

      const geo = buildBinGeometry();
      const mesh = new THREE.Mesh(geo, material);
      group.add(mesh);

      // Subtle edge line
      const edges = new THREE.EdgesGeometry(geo, 25);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: colorPreset === 'green' ? 0x14532d : 0x64748b,
        linewidth: 1,
        transparent: true,
        opacity: colorPreset === 'green' ? 0.55 : 0.4,
      });
      const wireMesh = new THREE.LineSegments(edges, lineMaterial);
      group.add(wireMesh);

      needsRenderRef.current = true;
    }, 80); // 80ms debounce

    return () => clearTimeout(timer);
  }, [buildBinGeometry, colorPreset, wireframe]);

  // Camera Orbit Preset Change
  const setCameraPreset = (preset: 'iso' | 'top' | 'bottom') => {
    setViewPreset(preset);
    const o = orbitRef.current;
    if (preset === 'iso') {
      o.theta = Math.PI / 4;
      o.phi = Math.PI / 3;
      o.radius = Math.max(binWidth, binLength) * 2.2;
    } else if (preset === 'top') {
      o.theta = 0;
      o.phi = 0.05; // almost direct top view
      o.radius = Math.max(binWidth, binLength) * 2.0;
    } else if (preset === 'bottom') {
      // Flip to bottom face to inspect the 4 corner magnet holes!
      o.theta = 0;
      o.phi = Math.PI - 0.1;
      o.radius = Math.max(binWidth, binLength) * 2.0;
    }
    needsRenderRef.current = true;
  };

  // Pointer Interaction for Smooth CAD Orbit / Pan / Zoom
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isInteractingRef.current = true;
    orbitRef.current.isOrbiting = e.button === 0 && !e.shiftKey;
    orbitRef.current.isPanning = e.button === 1 || e.button === 2 || e.shiftKey;
    orbitRef.current.lastMouseX = e.clientX;
    orbitRef.current.lastMouseY = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isInteractingRef.current) return;
    const o = orbitRef.current;
    const dx = e.clientX - o.lastMouseX;
    const dy = e.clientY - o.lastMouseY;
    o.lastMouseX = e.clientX;
    o.lastMouseY = e.clientY;

    if (o.isOrbiting) {
      o.theta -= dx * 0.008;
      o.phi = Math.max(0.05, Math.min(Math.PI - 0.05, o.phi - dy * 0.008));
      needsRenderRef.current = true;
    } else if (o.isPanning) {
      const panSpeed = o.radius * 0.0015;
      o.target.x -= dx * panSpeed;
      o.target.y += dy * panSpeed;
      needsRenderRef.current = true;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isInteractingRef.current = false;
    orbitRef.current.isOrbiting = false;
    orbitRef.current.isPanning = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.88 : 1.14;
    orbitRef.current.radius = Math.max(40, Math.min(800, orbitRef.current.radius * zoomFactor));
    needsRenderRef.current = true;
  };

  return (
    <div
      className="relative w-full h-full bg-slate-950 flex flex-col overflow-hidden select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 3D Viewport Controls Overlay */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 shadow-xl">
        {/* Preset views */}
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setCameraPreset('iso')}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              viewPreset === 'iso' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Iso
          </button>
          <button
            type="button"
            onClick={() => setCameraPreset('top')}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              viewPreset === 'top' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Top
          </button>
          <button
            type="button"
            onClick={() => setCameraPreset('bottom')}
            title="Inspect 4 corner magnet holes on bottom face"
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
              viewPreset === 'bottom' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Bottom
          </button>
        </div>

        <div className="h-4 w-px bg-slate-700/60" />

        {/* Wireframe toggle */}
        <button
          type="button"
          onClick={() => setWireframe(!wireframe)}
          title="Toggle CAD Wireframe"
          className={`p-1 rounded text-xs transition-colors ${
            wireframe ? 'bg-indigo-950 text-indigo-400 border border-indigo-700' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
        </button>

        {/* Color Palette Switcher */}
        <div className="flex items-center gap-1">
          {(['green', 'slate', 'orange', 'white'] as const).map((col) => (
            <button
              key={col}
              type="button"
              aria-label={`Model Color: ${col}`}
              onClick={() => setColorPreset(col)}
              className={`w-3.5 h-3.5 rounded-full border transition-all ${
                col === 'green'
                  ? 'bg-emerald-500'
                  : col === 'slate'
                  ? 'bg-slate-600'
                  : col === 'orange'
                  ? 'bg-orange-500'
                  : 'bg-slate-200'
              } ${colorPreset === col ? 'border-white scale-110 shadow-sm' : 'border-transparent opacity-60 hover:opacity-100'}`}
            />
          ))}
        </div>
      </div>

      {/* Real-time CAD Specs Overlay (Bottom-right) */}
      {(() => {
        const lipVal = config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
        const lipInfo = getStackingLipProfile(lipVal);
        const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
        const magnetLabel =
          magnetMode === 'full'
            ? `Full (${config.gridX * config.gridY * 4} Magnets)`
            : magnetMode === 'corners'
            ? '4 Corner Magnets'
            : 'None';
        return (
          <div className="absolute bottom-3 right-3 z-20 bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 shadow-xl text-[10px] font-mono text-slate-400 pointer-events-none flex flex-col gap-0.5">
            <div className="text-white font-semibold flex items-center justify-between gap-4">
              <span>{config.gridX}x{config.gridY} Gridfinity</span>
              <span className="text-cyan-400">
                {binWidth.toFixed(1)} x {binLength.toFixed(1)} x {(binHeight + (lipInfo.enabled ? lipInfo.height : 0)).toFixed(1)} mm
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Cutout Chamfer:</span>
              <span className="text-emerald-400">{config.chamferSize}mm @ 45°</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Stacking Lip:</span>
              <span className={lipInfo.enabled ? 'text-amber-300' : 'text-slate-500'}>
                {lipInfo.enabled ? `${lipInfo.height.toFixed(1)}mm Lip` : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Magnets:</span>
              <span className={magnetMode !== 'none' ? 'text-cyan-300' : 'text-slate-500'}>
                {magnetLabel}
              </span>
            </div>
          </div>
        );
      })()}

      {/* WebGL Canvas Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing block" />
    </div>
  );
};
