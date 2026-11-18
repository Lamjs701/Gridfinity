import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PlacedTool, GridfinityConfig, SnapGuide, Point2D, FingerPocket } from '../types';
import {
  getBinDimensions,
  getTransformedContour,
  getMagnetPositions,
  findSmartSnapping,
  generatePillContour,
  pointInPolygon,
  rotatePoint,
  GRID_UNIT,
  BASE_FOOT_BOTTOM_SIZE,
  BASE_BOTTOM_CORNER_RADIUS,
  getUnitFootCenters,
} from '../utils/geometry';
import { transformPocketContour } from '../utils/cutoutGeometry';
import {
  buildTextMultiPolygon,
  measureVectorText,
  multiPolygonToPointRings,
} from '../utils/vectorText';
import {
  RotateCw,
  Maximize2,
  Trash2,
  Plus,
  Crosshair,
  Sparkles,
} from 'lucide-react';

interface Canvas2DProps {
  config: GridfinityConfig;
  tools: PlacedTool[];
  selectedToolId: string | null;
  onSelectTool: (id: string | null) => void;
  onUpdateTool: (tool: PlacedTool) => void;
  onUpdateTools: (tools: PlacedTool[]) => void;
  onUpdateTextPosition: (x: number, y: number) => void;
  onRecenterTools: () => void;
  onAddFingerPocket: (toolId: string) => void;
}

type DragTargetType =
  | 'tool'
  | 'rotate'
  | 'pan'
  | 'pocket-move'
  | 'pocket-length'
  | 'pocket-width'
  | 'pocket-radius'
  | 'text-label';

export const Canvas2D: React.FC<Canvas2DProps> = ({
  config,
  tools,
  selectedToolId,
  onSelectTool,
  onUpdateTool,
  onUpdateTools,
  onUpdateTextPosition,
  onRecenterTools,
  onAddFingerPocket,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // View transform: pan & zoom
  const [scale, setScale] = useState<number>(3.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 40, y: 40 });
  const [selectedPocketId, setSelectedPocketId] = useState<string | null>(null);
  const [hoverCursor, setHoverCursor] = useState<string>('crosshair');

  // Dragging state
  const isDraggingRef = useRef<boolean>(false);
  const dragTargetRef = useRef<{
    type: DragTargetType;
    toolId: string;
    pocketId?: string;
    handleSign?: number;
    startMouseX: number;
    startMouseY: number;
    startWorldX: number;
    startWorldY: number;
    initialToolX: number;
    initialToolY: number;
    initialPocketX: number;
    initialPocketY: number;
    initialLength: number;
    initialWidth: number;
    initialRadius: number;
    initialRotation: number;
    initialPanX: number;
    initialPanY: number;
  } | null>(null);

  // Active smart snapping visual guides
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);

  const { width: binWidth, length: binLength } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  // Keep selectedPocketId synced when switching tools
  useEffect(() => {
    const tool = tools.find((t) => t.instanceId === selectedToolId);
    if (!tool) {
      setSelectedPocketId(null);
      return;
    }
    const pockets = tool.fingerPockets?.length ? tool.fingerPockets : tool.tool.fingerPockets;
    if (pockets.length === 0) {
      setSelectedPocketId(null);
    } else if (!selectedPocketId || !pockets.some((p) => p.id === selectedPocketId)) {
      setSelectedPocketId(pockets[0].id);
    }
  }, [selectedToolId, tools, selectedPocketId]);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number): Point2D => ({
      x: (screenX - pan.x) / scale,
      y: (screenY - pan.y) / scale,
    }),
    [pan, scale]
  );

  const worldToPocketLocal = (world: Point2D, tool: PlacedTool, pocket: FingerPocket): Point2D => {
    const relTool = rotatePoint({ x: world.x - tool.x, y: world.y - tool.y }, -tool.rotation);
    return rotatePoint({ x: relTool.x - pocket.x, y: relTool.y - pocket.y }, -pocket.rotation);
  };

  const pocketLocalToWorld = (local: Point2D, tool: PlacedTool, pocket: FingerPocket): Point2D => {
    const rotPocket = rotatePoint(local, pocket.rotation);
    const inTool = { x: pocket.x + rotPocket.x, y: pocket.y + rotPocket.y };
    const rotTool = rotatePoint(inTool, tool.rotation);
    return { x: tool.x + rotTool.x, y: tool.y + rotTool.y };
  };

  const getPocketHandlePositions = (pocket: FingerPocket) => {
    const hx = Math.max(2, pocket.length / 2);
    const hy = Math.max(2, pocket.width / 2);
    const maxR = Math.min(hx, hy);
    const r = Math.max(0.5, Math.min(pocket.cornerRadius ?? hy, maxR));
    return {
      lengthPos: { x: hx, y: 0 },
      lengthNeg: { x: -hx, y: 0 },
      widthPos: { x: 0, y: hy },
      widthNeg: { x: 0, y: -hy },
      // Corner radius knob placed diagonally inside upper-right corner proportional to r
      radiusHandle: { x: hx - r * 0.5, y: hy - r * 0.5 },
      cornerRef: { x: hx, y: hy },
      r,
      maxR,
    };
  };

  // Auto-fit tray into canvas
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const padding = 100;
    const fitScale = Math.min(
      (clientWidth - padding) / binWidth,
      (clientHeight - padding) / binLength,
      3.8
    );
    const newScale = Math.max(1.2, fitScale);
    const newPanX = (clientWidth - binWidth * newScale) / 2;
    const newPanY = (clientHeight - binLength * newScale) / 2;

    setScale(newScale);
    setPan({ x: newPanX, y: newPanY });
  }, [binWidth, binLength]);

  useEffect(() => {
    fitToView();
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      fitToView();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [config.gridX, config.gridY, fitToView]);

  // Main high-performance render loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    // 1. Draw Gridfinity outer bin boundary (Z=0 footprint)
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(0, 0, binWidth, binLength, 3.75);
    ctx.fill();
    ctx.lineWidth = 1.0 / scale;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    // 2. Draw 42mm Grid lines
    ctx.lineWidth = 0.8 / scale;
    ctx.strokeStyle = '#1e293b';
    ctx.setLineDash([2 / scale, 2 / scale]);
    for (let gx = 1; gx < config.gridX; gx++) {
      const x = gx * GRID_UNIT;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, binLength);
      ctx.stroke();
    }
    for (let gy = 1; gy < config.gridY; gy++) {
      const y = gy * GRID_UNIT;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(binWidth, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // 3. Per-unit Gridfinity v5 stepped foot outlines (35.6mm bottom foot)
    ctx.font = `3.5px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const footCenters = getUnitFootCenters(config.gridX, config.gridY);
    for (const unit of footCenters) {
      ctx.lineWidth = 0.6 / scale;
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';
      ctx.setLineDash([1.5 / scale, 1.5 / scale]);
      ctx.beginPath();
      ctx.roundRect(
        unit.cx - BASE_FOOT_BOTTOM_SIZE / 2,
        unit.cy - BASE_FOOT_BOTTOM_SIZE / 2,
        BASE_FOOT_BOTTOM_SIZE,
        BASE_FOOT_BOTTOM_SIZE,
        BASE_BOTTOM_CORNER_RADIUS
      );
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#475569';
      ctx.fillText(`U(${unit.col + 1},${unit.row + 1})`, unit.cx, unit.cy);
    }

    // 4. Draw Magnets or Screws per active mode ('corners' | 'full' | 'none')
    const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
    if (magnetMode !== 'none' || config.hasScrews) {
      const magnetPositions = getMagnetPositions(
        config.gridX,
        config.gridY,
        magnetMode !== 'none' ? magnetMode : 'corners'
      );
      const radius = magnetMode !== 'none' ? config.magnetDiameter / 2 : config.screwDiameter / 2;

      for (const m of magnetPositions) {
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 0.8 / scale;
        ctx.strokeStyle = magnetMode !== 'none' ? '#22c55e' : '#f59e0b';
        ctx.stroke();

        ctx.strokeStyle = magnetMode !== 'none' ? '#16a34a' : '#d97706';
        ctx.beginPath();
        ctx.moveTo(m.x - radius * 0.6, m.y);
        ctx.lineTo(m.x + radius * 0.6, m.y);
        ctx.moveTo(m.x, m.y - radius * 0.6);
        ctx.lineTo(m.x, m.y + radius * 0.6);
        ctx.stroke();
      }
    }

    // 5. Draw Placed Tools & Draggable Pill Pockets
    for (const tool of tools) {
      const isSelected = tool.instanceId === selectedToolId;

      ctx.save();
      ctx.translate(tool.x, tool.y);
      ctx.rotate((tool.rotation * Math.PI) / 180);

      // Tool Cavity Fill & Stroke (skipped if standalone pill cutout with empty contour)
      const pts = tool.tool.contour;
      if (pts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = isSelected ? 'rgba(34, 197, 94, 0.22)' : 'rgba(30, 41, 59, 0.85)';
        ctx.fill();

        ctx.lineWidth = (isSelected ? 1.5 : 1.0) / scale;
        ctx.strokeStyle = isSelected ? '#4ade80' : '#64748b';
        ctx.stroke();

        if (tool.tool.clearance > 0) {
          ctx.setLineDash([1.5 / scale, 1.5 / scale]);
          ctx.strokeStyle = isSelected ? 'rgba(74, 222, 128, 0.45)' : 'rgba(100, 116, 139, 0.3)';
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Negative Pill Shape Finger Pockets
      const pockets =
        tool.fingerPockets && tool.fingerPockets.length > 0
          ? tool.fingerPockets
          : tool.tool.fingerPockets;

      for (const pocket of pockets) {
        const isPocketSelected = isSelected && pocket.id === selectedPocketId;
        const pillPts = generatePillContour(pocket, 12);
        if (pillPts.length > 0) {
          ctx.beginPath();
          ctx.moveTo(pillPts[0].x, pillPts[0].y);
          for (let i = 1; i < pillPts.length; i++) {
            ctx.lineTo(pillPts[i].x, pillPts[i].y);
          }
          ctx.closePath();

          const rad = Math.max(4, pocket.width / 2);
          const grad = ctx.createRadialGradient(pocket.x, pocket.y, 1, pocket.x, pocket.y, rad * 1.4);
          grad.addColorStop(0, isPocketSelected ? 'rgba(249, 115, 22, 0.65)' : 'rgba(249, 115, 22, 0.48)');
          grad.addColorStop(0.7, 'rgba(234, 88, 12, 0.28)');
          grad.addColorStop(1, 'rgba(194, 65, 12, 0.08)');

          ctx.fillStyle = grad;
          ctx.fill();

          ctx.lineWidth = (isPocketSelected ? 1.8 : 1.0) / scale;
          ctx.strokeStyle = isPocketSelected ? '#fb923c' : '#ea580c';
          ctx.stroke();

          // Pill dimension label inside pill
          ctx.save();
          ctx.translate(pocket.x, pocket.y);
          ctx.rotate((pocket.rotation * Math.PI) / 180);
          ctx.fillStyle = '#ffedd5';
          ctx.font = `2.6px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            `${pocket.length.toFixed(0)}×${pocket.width.toFixed(0)} R${(pocket.cornerRadius ?? pocket.width / 2).toFixed(1)}`,
            0,
            0
          );

          // Direct drag handles on selected pill (Length, Width, Corner Radius)
          if (isPocketSelected) {
            const handles = getPocketHandlePositions(pocket);
            const hs = 2.8 / scale; // handle half-size in mm

            // Dashed corner bounding box for radius context
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.35)';
            ctx.lineWidth = 0.8 / scale;
            ctx.setLineDash([1.5 / scale, 1.5 / scale]);
            ctx.strokeRect(
              -handles.cornerRef.x,
              -handles.cornerRef.y,
              handles.cornerRef.x * 2,
              handles.cornerRef.y * 2
            );
            ctx.setLineDash([]);

            // Length handles (+X, -X) — Cyan squares
            for (const lp of [handles.lengthPos, handles.lengthNeg]) {
              ctx.fillStyle = '#22d3ee';
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.0 / scale;
              ctx.fillRect(lp.x - hs, lp.y - hs, hs * 2, hs * 2);
              ctx.strokeRect(lp.x - hs, lp.y - hs, hs * 2, hs * 2);
            }

            // Width handles (+Y, -Y) — Emerald squares
            for (const wp of [handles.widthPos, handles.widthNeg]) {
              ctx.fillStyle = '#4ade80';
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.0 / scale;
              ctx.fillRect(wp.x - hs, wp.y - hs, hs * 2, hs * 2);
              ctx.strokeRect(wp.x - hs, wp.y - hs, hs * 2, hs * 2);
            }

            // Corner Radius handle (diagonal inside corner) — White/Amber circle + leader
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 0.9 / scale;
            ctx.beginPath();
            ctx.moveTo(handles.cornerRef.x, handles.cornerRef.y);
            ctx.lineTo(handles.radiusHandle.x, handles.radiusHandle.y);
            ctx.stroke();

            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(handles.radiusHandle.x, handles.radiusHandle.y, 3.2 / scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.0 / scale;
            ctx.stroke();
          }

          ctx.restore();
        }
      }

      // Tool Name & Depth label (only when tool has a body contour)
      if (pts.length >= 3) {
        const hasCenterPocket = pockets.some((p) => Math.hypot(p.x, p.y) < 14);
        const labelY = hasCenterPocket ? 20 : 0;

        ctx.fillStyle = isSelected ? '#dcfce7' : '#94a3b8';
        ctx.font = `3.2px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tool.tool.name, 0, labelY);

        ctx.font = `2.6px monospace`;
        ctx.fillStyle = isSelected ? '#86efac' : '#64748b';
        ctx.fillText(`-${tool.depthOverride ?? tool.tool.depth}mm`, 0, labelY + 4);
      }

      // Selected Tool Overlay Handles (Rotation Handle & Center Cross)
      if (isSelected) {
        const rotHandleY = -35;
        ctx.beginPath();
        ctx.moveTo(0, -25);
        ctx.lineTo(0, rotHandleY);
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeStyle = '#22c55e';
        ctx.stroke();

        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(0, rotHandleY, 3.5 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, rotHandleY, 1.5 / scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.0 / scale;
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.moveTo(0, -4);
        ctx.lineTo(0, 4);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 5b. Draw CAPSLOCK Emboss/Engrave Text Label (Draggable)
    if (
      config.textLabel &&
      config.textLabel.mode !== 'none' &&
      config.textLabel.text.trim().length > 0
    ) {
      const tl = config.textLabel;
      const textMp = buildTextMultiPolygon(tl, { flipY: false });
      const textPolys = multiPolygonToPointRings(textMp);
      const isEmboss = tl.mode === 'emboss';

      ctx.save();
      for (const poly of textPolys) {
        if (poly.length === 0) continue;
        ctx.beginPath();
        for (const ring of poly) {
          if (ring.length < 3) continue;
          ctx.moveTo(ring[0].x, ring[0].y);
          for (let i = 1; i < ring.length; i++) {
            ctx.lineTo(ring[i].x, ring[i].y);
          }
          ctx.closePath();
        }
        ctx.fillStyle = isEmboss ? 'rgba(56, 189, 248, 0.42)' : 'rgba(192, 132, 252, 0.36)';
        ctx.fill('evenodd');
        ctx.lineWidth = 0.9 / scale;
        ctx.strokeStyle = isEmboss ? '#38bdf8' : '#c084fc';
        ctx.stroke();
      }

      // Subtle dashed drag bounds around text
      const dims = measureVectorText(tl.text, tl.fontSize);
      const pad = 2.5;
      ctx.translate(tl.x, tl.y);
      ctx.rotate((tl.rotation * Math.PI) / 180);
      ctx.strokeStyle = isEmboss ? 'rgba(56, 189, 248, 0.45)' : 'rgba(192, 132, 252, 0.45)';
      ctx.lineWidth = 0.7 / scale;
      ctx.setLineDash([1.5 / scale, 1.5 / scale]);
      ctx.strokeRect(
        -dims.width / 2 - pad,
        -dims.height / 2 - pad,
        dims.width + pad * 2,
        dims.height + pad * 2
      );
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 6. Smart Snapping Visual Guide Lines
    if (activeGuides.length > 0) {
      for (const guide of activeGuides) {
        ctx.save();
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeStyle = guide.source === 'grid-center' ? '#10b981' : '#06b6d4';
        ctx.setLineDash([4 / scale, 3 / scale]);

        ctx.beginPath();
        if (guide.type === 'x') {
          ctx.moveTo(guide.position, -20);
          ctx.lineTo(guide.position, binLength + 20);
        } else {
          ctx.moveTo(-20, guide.position);
          ctx.lineTo(binWidth + 20, guide.position);
        }
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.font = `3.2px sans-serif`;
        ctx.fillStyle = guide.source === 'grid-center' ? '#34d399' : '#22d3ee';
        if (guide.type === 'x') {
          ctx.textAlign = 'center';
          ctx.fillText(guide.label, guide.position, -5);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(guide.label, -5, guide.position);
        }
        ctx.restore();
      }
    }

    ctx.restore();
    ctx.restore();
  }, [
    binWidth,
    binLength,
    config,
    pan,
    scale,
    tools,
    selectedToolId,
    selectedPocketId,
    activeGuides,
  ]);

  useEffect(() => {
    const animId = requestAnimationFrame(renderCanvas);
    return () => cancelAnimationFrame(animId);
  }, [renderCanvas]);

  // Hit-testing helper for pointer down & hover cursor
  const hitTestAtWorld = (world: Point2D) => {
    const handleHitDist = Math.max(3.5, 9 / scale);

    // 1. Check selected pill resize handles first
    if (selectedToolId && selectedPocketId) {
      const tool = tools.find((t) => t.instanceId === selectedToolId);
      if (tool) {
        const pockets = tool.fingerPockets?.length ? tool.fingerPockets : tool.tool.fingerPockets;
        const pocket = pockets.find((p) => p.id === selectedPocketId);
        if (pocket) {
          const h = getPocketHandlePositions(pocket);
          const checkHandle = (localPt: Point2D) => {
            const wp = pocketLocalToWorld(localPt, tool, pocket);
            return Math.hypot(world.x - wp.x, world.y - wp.y) <= handleHitDist;
          };

          if (checkHandle(h.radiusHandle)) {
            return { type: 'pocket-radius' as const, tool, pocket, handleSign: 1 };
          }
          if (checkHandle(h.lengthPos)) {
            return { type: 'pocket-length' as const, tool, pocket, handleSign: 1 };
          }
          if (checkHandle(h.lengthNeg)) {
            return { type: 'pocket-length' as const, tool, pocket, handleSign: -1 };
          }
          if (checkHandle(h.widthPos)) {
            return { type: 'pocket-width' as const, tool, pocket, handleSign: 1 };
          }
          if (checkHandle(h.widthNeg)) {
            return { type: 'pocket-width' as const, tool, pocket, handleSign: -1 };
          }
        }
      }
    }

    // 2. Check pill pocket bodies (allows direct drag of any pill pocket)
    for (let i = tools.length - 1; i >= 0; i--) {
      const t = tools[i];
      const pockets = t.fingerPockets?.length ? t.fingerPockets : t.tool.fingerPockets;
      for (let j = pockets.length - 1; j >= 0; j--) {
        const p = pockets[j];
        const worldPill = transformPocketContour(p, t, 8);
        if (pointInPolygon(world, worldPill)) {
          return { type: 'pocket-move' as const, tool: t, pocket: p, handleSign: 1 };
        }
      }
    }

    // 3. Check rotation handle of selected tool
    if (selectedToolId) {
      const selected = tools.find((t) => t.instanceId === selectedToolId);
      if (selected) {
        const rotHandleWorld = rotatePoint({ x: 0, y: -35 }, selected.rotation);
        const handleX = selected.x + rotHandleWorld.x;
        const handleY = selected.y + rotHandleWorld.y;
        if (Math.hypot(world.x - handleX, world.y - handleY) <= handleHitDist) {
          return { type: 'rotate' as const, tool: selected };
        }
      }
    }

    // 4. Check tool contours or tool center proximity
    for (let i = tools.length - 1; i >= 0; i--) {
      const t = tools[i];
      const worldPts = getTransformedContour(t);
      if ((worldPts.length >= 3 && pointInPolygon(world, worldPts)) || Math.hypot(world.x - t.x, world.y - t.y) < 16) {
        return { type: 'tool' as const, tool: t };
      }
    }

    // 5. Check CAPSLOCK text label bounding box
    if (
      config.textLabel &&
      config.textLabel.mode !== 'none' &&
      config.textLabel.text.trim().length > 0
    ) {
      const tl = config.textLabel;
      const dims = measureVectorText(tl.text, tl.fontSize);
      const local = rotatePoint({ x: world.x - tl.x, y: world.y - tl.y }, -tl.rotation);
      if (
        Math.abs(local.x) <= dims.width / 2 + 4 &&
        Math.abs(local.y) <= dims.height / 2 + 4
      ) {
        return { type: 'text-label' as const };
      }
    }

    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      isDraggingRef.current = true;
      dragTargetRef.current = {
        type: 'pan',
        toolId: '',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        initialToolX: 0,
        initialToolY: 0,
        initialPocketX: 0,
        initialPocketY: 0,
        initialLength: 0,
        initialWidth: 0,
        initialRadius: 0,
        initialRotation: 0,
        initialPanX: pan.x,
        initialPanY: pan.y,
      };
      return;
    }

    const hit = hitTestAtWorld(world);

    if (!hit) {
      onSelectTool(null);
      setSelectedPocketId(null);
      isDraggingRef.current = true;
      dragTargetRef.current = {
        type: 'pan',
        toolId: '',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        initialToolX: 0,
        initialToolY: 0,
        initialPocketX: 0,
        initialPocketY: 0,
        initialLength: 0,
        initialWidth: 0,
        initialRadius: 0,
        initialRotation: 0,
        initialPanX: pan.x,
        initialPanY: pan.y,
      };
      return;
    }

    if (hit.type === 'text-label') {
      isDraggingRef.current = true;
      dragTargetRef.current = {
        type: 'text-label',
        toolId: '',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        initialToolX: config.textLabel?.x ?? binWidth / 2,
        initialToolY: config.textLabel?.y ?? binLength / 2,
        initialPocketX: 0,
        initialPocketY: 0,
        initialLength: 0,
        initialWidth: 0,
        initialRadius: 0,
        initialRotation: 0,
        initialPanX: pan.x,
        initialPanY: pan.y,
      };
      return;
    }

    onSelectTool(hit.tool.instanceId);
    if ('pocket' in hit && hit.pocket) {
      setSelectedPocketId(hit.pocket.id);
    }

    isDraggingRef.current = true;
    const pocket = 'pocket' in hit ? hit.pocket : undefined;
    dragTargetRef.current = {
      type: hit.type,
      toolId: hit.tool.instanceId,
      pocketId: pocket?.id,
      handleSign: 'handleSign' in hit ? hit.handleSign : 1,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startWorldX: world.x,
      startWorldY: world.y,
      initialToolX: hit.tool.x,
      initialToolY: hit.tool.y,
      initialPocketX: pocket?.x ?? 0,
      initialPocketY: pocket?.y ?? 0,
      initialLength: pocket?.length ?? 32,
      initialWidth: pocket?.width ?? 18,
      initialRadius: pocket?.cornerRadius ?? (pocket ? pocket.width / 2 : 9),
      initialRotation: hit.tool.rotation,
      initialPanX: pan.x,
      initialPanY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    if (!isDraggingRef.current || !dragTargetRef.current) {
      const hit = hitTestAtWorld(world);
      if (!hit) setHoverCursor('crosshair');
      else if (hit.type === 'pocket-length' || hit.type === 'pocket-width') setHoverCursor('ew-resize');
      else if (hit.type === 'pocket-radius') setHoverCursor('nwse-resize');
      else if (hit.type === 'rotate') setHoverCursor('grab');
      else setHoverCursor('move');
      return;
    }

    const target = dragTargetRef.current;

    if (target.type === 'pan') {
      setPan({
        x: target.initialPanX + (e.clientX - target.startMouseX),
        y: target.initialPanY + (e.clientY - target.startMouseY),
      });
      return;
    }

    if (target.type === 'text-label') {
      const dxMm = (e.clientX - target.startMouseX) / scale;
      const dyMm = (e.clientY - target.startMouseY) / scale;
      let nextX = Math.round((target.initialToolX + dxMm) * 10) / 10;
      let nextY = Math.round((target.initialToolY + dyMm) * 10) / 10;
      if (Math.abs(nextX - binWidth / 2) < 2.5) nextX = Math.round((binWidth / 2) * 10) / 10;
      if (Math.abs(nextY - binLength / 2) < 2.5) nextY = Math.round((binLength / 2) * 10) / 10;
      nextX = Math.max(8, Math.min(binWidth - 8, nextX));
      nextY = Math.max(8, Math.min(binLength - 8, nextY));
      onUpdateTextPosition(nextX, nextY);
      return;
    }

    const tool = tools.find((t) => t.instanceId === target.toolId);
    if (!tool) return;

    if (target.type === 'rotate') {
      const angleRad = Math.atan2(world.y - tool.y, world.x - tool.x);
      let angleDeg = Math.round(((angleRad + Math.PI / 2) * 180) / Math.PI);
      if (e.shiftKey || Math.abs(angleDeg % 45) < 3) {
        angleDeg = Math.round(angleDeg / 15) * 15;
      }
      onUpdateTool({ ...tool, rotation: (angleDeg + 360) % 360 });
      return;
    }

    if (
      (target.type === 'pocket-move' ||
        target.type === 'pocket-length' ||
        target.type === 'pocket-width' ||
        target.type === 'pocket-radius') &&
      target.pocketId
    ) {
      const currentPockets = tool.fingerPockets?.length ? tool.fingerPockets : tool.tool.fingerPockets;
      const pocket = currentPockets.find((p) => p.id === target.pocketId);
      if (!pocket) return;

      let updatedPocket = { ...pocket };

      if (target.type === 'pocket-move') {
        const deltaWorld = {
          x: world.x - target.startWorldX,
          y: world.y - target.startWorldY,
        };
        const deltaToolLocal = rotatePoint(deltaWorld, -tool.rotation);
        const nextX = Math.round((target.initialPocketX + deltaToolLocal.x) * 10) / 10;
        const nextY = Math.round((target.initialPocketY + deltaToolLocal.y) * 10) / 10;
        // Clamp within bin bounds relative to tool
        const absWorld = rotatePoint({ x: nextX, y: nextY }, tool.rotation);
        const clampedWorldX = Math.max(8, Math.min(binWidth - 8, tool.x + absWorld.x));
        const clampedWorldY = Math.max(8, Math.min(binLength - 8, tool.y + absWorld.y));
        const clampedLocal = rotatePoint(
          { x: clampedWorldX - tool.x, y: clampedWorldY - tool.y },
          -tool.rotation
        );
        updatedPocket.x = Math.round(clampedLocal.x * 10) / 10;
        updatedPocket.y = Math.round(clampedLocal.y * 10) / 10;
      } else {
        const local = worldToPocketLocal(world, tool, pocket);
        if (target.type === 'pocket-length') {
          const halfLen = Math.max(4, Math.min(70, Math.abs(local.x)));
          const nextLength = Math.round(halfLen * 2 * 2) / 2; // 0.5mm increments
          updatedPocket.length = Math.max(6, Math.min(140, nextLength));
          updatedPocket.cornerRadius = Math.min(
            updatedPocket.cornerRadius ?? updatedPocket.width / 2,
            Math.min(updatedPocket.width, updatedPocket.length) / 2
          );
        } else if (target.type === 'pocket-width') {
          const halfW = Math.max(4, Math.min(45, Math.abs(local.y)));
          const nextWidth = Math.round(halfW * 2 * 2) / 2; // 0.5mm increments
          const prevWasFullPill =
            Math.abs((target.initialRadius ?? target.initialWidth / 2) - target.initialWidth / 2) < 0.35;
          updatedPocket.width = Math.max(6, Math.min(90, nextWidth));
          const maxR = Math.min(updatedPocket.width, updatedPocket.length) / 2;
          updatedPocket.cornerRadius = prevWasFullPill
            ? maxR
            : Math.min(updatedPocket.cornerRadius ?? maxR, maxR);
        } else if (target.type === 'pocket-radius') {
          const hx = updatedPocket.length / 2;
          const hy = updatedPocket.width / 2;
          const maxR = Math.min(hx, hy);
          // Handle sits at (hx - r*0.5, hy - r*0.5) => r = (hx - local.x + hy - local.y)
          const rawR = hx - local.x + (hy - local.y);
          updatedPocket.cornerRadius = Math.max(1, Math.min(maxR, Math.round(rawR * 2) / 2));
        }
      }

      onUpdateTool({
        ...tool,
        fingerPockets: currentPockets.map((p) => (p.id === updatedPocket.id ? updatedPocket : p)),
      });
      return;
    }

    if (target.type === 'tool') {
      const dxMm = (e.clientX - target.startMouseX) / scale;
      const dyMm = (e.clientY - target.startMouseY) / scale;

      let candidateX = Math.round((target.initialToolX + dxMm) * 10) / 10;
      let candidateY = Math.round((target.initialToolY + dyMm) * 10) / 10;

      if (config.smartSnapping) {
        const snap = findSmartSnapping(
          { ...tool, x: candidateX, y: candidateY },
          tools,
          binWidth,
          binLength,
          config.snapTolerance || 2.5
        );
        candidateX = snap.snappedX;
        candidateY = snap.snappedY;
        setActiveGuides(snap.guides);
      } else {
        setActiveGuides([]);
      }

      const margin = 8;
      candidateX = Math.max(margin, Math.min(binWidth - margin, candidateX));
      candidateY = Math.max(margin, Math.min(binLength - margin, candidateY));

      onUpdateTool({
        ...tool,
        x: candidateX,
        y: candidateY,
      });
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    dragTargetRef.current = null;
    setActiveGuides([]);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newScale = Math.max(1.0, Math.min(12.0, scale * zoomFactor));

    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setScale(newScale);
    setPan({
      x: mouseX - (mouseX - pan.x) * (newScale / scale),
      y: mouseY - (mouseY - pan.y) * (newScale / scale),
    });
  };

  const selectedTool = tools.find((t) => t.instanceId === selectedToolId);
  const activePockets = selectedTool
    ? selectedTool.fingerPockets?.length
      ? selectedTool.fingerPockets
      : selectedTool.tool.fingerPockets
    : [];
  const selectedPocket =
    activePockets.find((p) => p.id === selectedPocketId) ?? activePockets[0] ?? null;

  const updateSelectedPocket = (patch: Partial<FingerPocket>) => {
    if (!selectedTool || !selectedPocket) return;
    const nextPockets = activePockets.map((p) =>
      p.id === selectedPocket.id ? { ...p, ...patch } : p
    );
    onUpdateTool({ ...selectedTool, fingerPockets: nextPockets });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-950 flex flex-col overflow-hidden select-none"
    >
      {/* 2D Canvas Toolbar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 shadow-xl">
        <button
          type="button"
          onClick={onRecenterTools}
          title="Recenter all tools on Gridfinity bin"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all active:scale-95"
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span>Recenter on Grid</span>
        </button>

        <div className="h-4 w-px bg-slate-700/60" />

        <div className="flex items-center gap-1 text-xs text-slate-300">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-medium text-[11px]">Smart Snap:</span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              config.smartSnapping
                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {config.smartSnapping ? 'ACTIVE' : 'OFF'}
          </span>
        </div>

        <div className="h-4 w-px bg-slate-700/60" />

        <button
          type="button"
          onClick={fitToView}
          title="Fit view to bin"
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <span className="text-[11px] font-mono text-slate-400">
          {Math.round(scale * 10)}%
        </span>
      </div>

      {/* Empty Bin Helper Hint */}
      {tools.length === 0 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/85 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-slate-800 text-[11px] text-slate-400">
          Empty Gridfinity tray — scan a tool on A4 paper or click <strong className="text-orange-300">+ Pill Slot</strong> above to cut into the model.
        </div>
      )}

      {/* Selected Tool & Pill Slot Inspector Overlay (Bottom-left) */}
      {selectedTool && (
        <div className="absolute bottom-3 left-3 z-20 bg-slate-900/95 backdrop-blur-md p-3 rounded-xl border border-slate-800 shadow-2xl flex flex-col gap-2 min-w-[295px] max-w-[320px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div>
              <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                <span>{selectedTool.tool.name}</span>
              </div>
              <div className="text-[10px] font-mono text-emerald-400">
                X: {selectedTool.x.toFixed(1)}mm • Y: {selectedTool.y.toFixed(1)}mm • {selectedTool.rotation}°
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onUpdateTools(tools.filter((t) => t.instanceId !== selectedTool.instanceId));
                onSelectTool(null);
              }}
              title="Remove cutout"
              className="p-1 rounded text-rose-400 hover:bg-rose-950/50 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick rotation & add pill button */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                onUpdateTool({
                  ...selectedTool,
                  rotation: (selectedTool.rotation + 45) % 360,
                })
              }
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              <RotateCw className="w-3 h-3 text-cyan-400" />
              <span>Rotate 45°</span>
            </button>

            <button
              type="button"
              onClick={() => onAddFingerPocket(selectedTool.instanceId)}
              title="Add smooth negative pill shape finger grab pocket"
              className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-orange-950/80 hover:bg-orange-900 border border-orange-800 text-orange-200 text-xs font-medium transition-colors"
            >
              <Plus className="w-3 h-3 text-orange-400" />
              <span>+ Pill Pocket</span>
            </button>
          </div>

          {/* Tool Cavity Depth Slider (shown when tool has contour) */}
          {selectedTool.tool.contour.length >= 3 && (
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
              <span className="text-slate-400">Pocket Depth:</span>
              <input
                aria-label="Tool Pocket Depth"
                type="range"
                min="3"
                max="35"
                step="0.5"
                value={selectedTool.depthOverride ?? selectedTool.tool.depth}
                onChange={(e) =>
                  onUpdateTool({
                    ...selectedTool,
                    depthOverride: parseFloat(e.target.value),
                  })
                }
                className="w-24 accent-emerald-500"
              />
              <span className="font-mono text-emerald-300 w-12 text-right">
                {(selectedTool.depthOverride ?? selectedTool.tool.depth).toFixed(1)}mm
              </span>
            </div>
          )}

          {/* Selected Pill Slot Interactive Geometry Controls */}
          {selectedPocket && (() => {
            const maxRadius = Math.min(selectedPocket.width, selectedPocket.length) / 2;
            const currentRadius = Math.min(
              selectedPocket.cornerRadius ?? selectedPocket.width / 2,
              maxRadius
            );
            return (
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-orange-300">
                  <span>Pill Slot Geometry (Drag Handles in 2D)</span>
                  {activePockets.length > 0 && (
                    <button
                      type="button"
                      aria-label="Remove Pill Slot"
                      onClick={() => {
                        const nextPockets = activePockets.filter((p) => p.id !== selectedPocket.id);
                        if (nextPockets.length === 0 && selectedTool.tool.contour.length < 3) {
                          onUpdateTools(tools.filter((t) => t.instanceId !== selectedTool.instanceId));
                          onSelectTool(null);
                        } else {
                          onUpdateTool({ ...selectedTool, fingerPockets: nextPockets });
                          setSelectedPocketId(nextPockets[0]?.id ?? null);
                        }
                      }}
                      className="text-rose-400 hover:text-rose-300 p-0.5 rounded"
                      title="Delete selected pill slot"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Length Slider */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className="text-cyan-300">Pill Length:</span>
                  <input
                    aria-label="Pill Slot Length"
                    type="range"
                    min="6"
                    max="140"
                    step="0.5"
                    value={selectedPocket.length}
                    onChange={(e) => {
                      const nextLength = parseFloat(e.target.value);
                      updateSelectedPocket({
                        length: nextLength,
                        cornerRadius: Math.min(
                          currentRadius,
                          Math.min(selectedPocket.width, nextLength) / 2
                        ),
                      });
                    }}
                    className="w-24 accent-cyan-500"
                  />
                  <span className="font-mono text-cyan-300 w-12 text-right">
                    {selectedPocket.length.toFixed(1)}mm
                  </span>
                </div>

                {/* Width Slider */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className="text-emerald-300">Pill Width:</span>
                  <input
                    aria-label="Pill Slot Width"
                    type="range"
                    min="6"
                    max="90"
                    step="0.5"
                    value={selectedPocket.width}
                    onChange={(e) => {
                      const nextWidth = parseFloat(e.target.value);
                      const wasFull = Math.abs(currentRadius - selectedPocket.width / 2) < 0.35;
                      const nextMaxR = Math.min(nextWidth, selectedPocket.length) / 2;
                      updateSelectedPocket({
                        width: nextWidth,
                        cornerRadius: wasFull ? nextMaxR : Math.min(currentRadius, nextMaxR),
                      });
                    }}
                    className="w-24 accent-emerald-500"
                  />
                  <span className="font-mono text-emerald-300 w-12 text-right">
                    {selectedPocket.width.toFixed(1)}mm
                  </span>
                </div>

                {/* Corner Radius Slider */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className="text-yellow-300">Corner Radius:</span>
                  <input
                    aria-label="Pill Corner Radius"
                    type="range"
                    min="1"
                    max={Math.max(1, maxRadius)}
                    step="0.5"
                    value={currentRadius}
                    onChange={(e) =>
                      updateSelectedPocket({ cornerRadius: parseFloat(e.target.value) })
                    }
                    className="w-24 accent-yellow-400"
                  />
                  <span className="font-mono text-yellow-300 w-12 text-right">
                    {currentRadius.toFixed(1)}mm
                  </span>
                </div>

                {/* Depth Slider */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className="text-orange-300">Finger Slot Depth:</span>
                  <input
                    aria-label="Finger Slot Depth"
                    type="range"
                    min="2"
                    max="35"
                    step="0.5"
                    value={selectedPocket.depth}
                    onChange={(e) =>
                      updateSelectedPocket({ depth: parseFloat(e.target.value) })
                    }
                    className="w-24 accent-orange-500"
                  />
                  <span className="font-mono text-orange-300 w-12 text-right">
                    {selectedPocket.depth.toFixed(1)}mm
                  </span>
                </div>

                {/* Pill Rotation Slider */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                  <span className="text-slate-400">Pill Angle:</span>
                  <input
                    aria-label="Pill Slot Rotation"
                    type="range"
                    min="0"
                    max="360"
                    step="15"
                    value={selectedPocket.rotation}
                    onChange={(e) =>
                      updateSelectedPocket({ rotation: parseFloat(e.target.value) })
                    }
                    className="w-24 accent-indigo-500"
                  />
                  <span className="font-mono text-indigo-300 w-12 text-right">
                    {selectedPocket.rotation}°
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Main Interactive HTML5 Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="studio-canvas-2d"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{ cursor: hoverCursor }}
        className="w-full h-full block"
      />
    </div>
  );
};

