import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ToolDef, Point2D, FingerPocket } from '../types';
import {
  A4Corners,
  detectA4PaperInImage,
  extractToolFromA4Photo,
} from '../utils/contourExtraction';
import { A4Orientation, getA4DimensionsMm } from '../utils/a4Calibration';
import { simplifyContour, generatePillContour, pointInPolygon, rotatePoint } from '../utils/geometry';
import {
  Camera,
  Upload,
  Check,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Sparkles,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  FileText,
  Scan,
  ArrowRight,
} from 'lucide-react';

interface ToolScannerViewProps {
  onSaveTool: (tool: ToolDef) => void;
  onCancel: () => void;
  initialTool?: ToolDef | null;
}

type FinetuneDragTarget =
  | { type: 'point'; index: number }
  | {
      type: 'pocket-move' | 'pocket-length' | 'pocket-width' | 'pocket-radius';
      pocketId: string;
      handleSign?: number;
      startWorld: Point2D;
      initialX: number;
      initialY: number;
      initialLength: number;
      initialWidth: number;
      initialRadius: number;
    };

export const ToolScannerView: React.FC<ToolScannerViewProps> = ({
  onSaveTool,
  onCancel,
  initialTool,
}) => {
  // Wizard steps: 'upload' -> 'calibrate' -> 'finetune'
  const [step, setStep] = useState<'upload' | 'calibrate' | 'finetune'>(
    initialTool ? 'finetune' : 'upload'
  );

  // Uploaded source photo & A4 reference state (no preloaded sample photo)
  const [imageSrc, setImageSrc] = useState<string>(initialTool?.scannedImageUrl || '');
  const [rectifiedSrc, setRectifiedSrc] = useState<string>(initialTool?.scannedImageUrl || '');
  const [a4Orientation, setA4Orientation] = useState<A4Orientation>('landscape');
  const [a4AutoDetected, setA4AutoDetected] = useState<boolean>(false);
  const [a4Confidence, setA4Confidence] = useState<number>(0);
  const [a4Corners, setA4Corners] = useState<A4Corners>([
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ]);
  const [threshold, setThreshold] = useState<number>(145);
  const [invertMask, setInvertMask] = useState<boolean>(false);
  const [mmPerPixel, setMmPerPixel] = useState<number>(initialTool?.imageScale || 1 / 3);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Tool metadata
  const [toolName, setToolName] = useState<string>(initialTool?.name || 'A4 Traced Tool');
  const [category, setCategory] = useState<string>(initialTool?.category || 'Custom');
  const [depthMm, setDepthMm] = useState<number>(initialTool?.depth || 10.0);
  const [clearanceMm, setClearanceMm] = useState<number>(initialTool?.clearance || 0.6);

  // Tool contour points (in mm, centered at (0,0))
  const [contour, setContour] = useState<Point2D[]>(initialTool?.contour || []);
  const [fingerPockets, setFingerPockets] = useState<FingerPocket[]>(
    initialTool?.fingerPockets || []
  );

  // Scanned tool image overlay state (in Fine-Tune)
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.65);
  const [overlayScale, setOverlayScale] = useState<number>(1.0);
  const [overlayOffsetX, setOverlayOffsetX] = useState<number>(0);
  const [overlayOffsetY, setOverlayOffsetY] = useState<number>(0);
  const [imgLoadedTick, setImgLoadedTick] = useState<number>(0);

  // Calibration canvas & A4 corner drag refs
  const calibCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const calibImgRef = useRef<HTMLImageElement | null>(null);
  const [calibImgTick, setCalibImgTick] = useState<number>(0);
  const draggingCornerIdxRef = useRef<number | null>(null);

  // Fine-tuning canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [canvasZoom, setCanvasZoom] = useState<number>(2.5);
  const [canvasPan, setCanvasPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [selectedPocketId, setSelectedPocketId] = useState<string | null>(null);
  const dragTargetRef = useRef<FinetuneDragTarget | null>(null);
  const isPanningRef = useRef<boolean>(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Load source image for Calibration view
  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      calibImgRef.current = img;
      setCalibImgTick((t) => t + 1);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Load rectified image for Fine-Tune overlay
  useEffect(() => {
    if (!rectifiedSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImgLoadedTick((t) => t + 1);
    };
    img.src = rectifiedSrc;
  }, [rectifiedSrc]);

  // Auto-detect A4 corners on a source image
  const runAutoDetectA4 = useCallback(async (src: string) => {
    try {
      const detected = await detectA4PaperInImage(src);
      setA4Corners(detected.corners);
      setA4Orientation(detected.orientation);
      setA4AutoDetected(detected.detected);
      setA4Confidence(detected.confidence);
    } catch (err) {
      console.error('A4 auto-detect fallback:', err);
      setA4AutoDetected(false);
      setA4Confidence(0);
    }
  }, []);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const result = event.target?.result as string;
        setImageSrc(result);
        setRectifiedSrc(result);
        setA4AutoDetected(false);
        setA4Confidence(0);
        setStep('calibrate');
        await runAutoDetectA4(result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Run A4 Perspective Rectification + Object Contour Tracing
  const handleExtractContour = async () => {
    setIsProcessing(true);
    try {
      const res = await extractToolFromA4Photo(
        imageSrc,
        a4Corners,
        a4Orientation,
        threshold,
        invertMask
      );
      setContour(res.contour);
      setRectifiedSrc(res.rectifiedImageUrl);
      setMmPerPixel(res.mmPerPixel);
      setOverlayScale(1.0);
      // Align rectified A4 photo directly under the centered tool contour
      setOverlayOffsetX(res.a4WidthMm / 2 - res.centerMm.x);
      setOverlayOffsetY(res.a4HeightMm / 2 - res.centerMm.y);
      setCanvasPan({ x: 0, y: 0 });
      setStep('finetune');
    } catch (err) {
      console.error('A4 extraction error:', err);
      setStep('finetune');
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper: get image draw rect inside calibration canvas
  const getCalibImageRect = useCallback((canvasW: number, canvasH: number) => {
    const img = calibImgRef.current;
    if (!img) return { x: 0, y: 0, w: canvasW, h: canvasH };
    const iw = img.naturalWidth || img.width || 800;
    const ih = img.naturalHeight || img.height || 600;
    const pad = 24;
    const scale = Math.min((canvasW - pad * 2) / iw, (canvasH - pad * 2) / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    return {
      x: (canvasW - dw) / 2,
      y: (canvasH - dh) / 2,
      w: dw,
      h: dh,
    };
  }, []);

  // Render Calibration Canvas with interactive 4-corner A4 Reference Frame
  useEffect(() => {
    if (step !== 'calibrate') return;
    const canvas = calibCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const img = calibImgRef.current;
    if (img) {
      const box = getCalibImageRect(rect.width, rect.height);
      ctx.drawImage(img, box.x, box.y, box.w, box.h);

      // Convert normalized corners to canvas px
      const pts = a4Corners.map((c) => ({
        x: box.x + c.x * box.w,
        y: box.y + c.y * box.h,
      }));

      // Dim region outside A4 quad
      ctx.save();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();

      // Draw A4 paper perimeter outline
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y);
      ctx.lineTo(pts[3].x, pts[3].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Edge dimension badges
      const { widthMm, heightMm } = getA4DimensionsMm(a4Orientation);
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.fillText(`${widthMm} mm`, (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2 - 8);
      ctx.fillText(`${heightMm} mm`, (pts[1].x + pts[2].x) / 2 + 28, (pts[1].y + pts[2].y) / 2);

      // Draw 4 draggable corner handles
      const labels = ['TL', 'TR', 'BR', 'BL'];
      pts.forEach((p, idx) => {
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#22d3ee';
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[idx], p.x, p.y);
      });
    }

    ctx.restore();
  }, [step, a4Corners, a4Orientation, calibImgTick, getCalibImageRect]);

  // Calibration canvas corner dragging
  const handleCalibMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = calibCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const box = getCalibImageRect(rect.width, rect.height);

    let hitIdx: number | null = null;
    a4Corners.forEach((c, idx) => {
      const px = box.x + c.x * box.w;
      const py = box.y + c.y * box.h;
      if (Math.hypot(mx - px, my - py) <= 18) {
        hitIdx = idx;
      }
    });
    draggingCornerIdxRef.current = hitIdx;
  };

  const handleCalibMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const idx = draggingCornerIdxRef.current;
    if (idx === null || !calibCanvasRef.current) return;
    const rect = calibCanvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const box = getCalibImageRect(rect.width, rect.height);

    const nx = Math.max(0.0, Math.min(1.0, (mx - box.x) / box.w));
    const ny = Math.max(0.0, Math.min(1.0, (my - box.y) / box.h));

    setA4Corners((prev) => {
      const next = [...prev] as A4Corners;
      next[idx] = { x: nx, y: ny };
      return next;
    });
  };

  const handleCalibMouseUp = () => {
    draggingCornerIdxRef.current = null;
  };

  // Screen to fine-tune world coordinates (mm)
  const screenToWorld = useCallback(
    (screenX: number, screenY: number, width: number, height: number): Point2D => {
      const centerX = width / 2 + canvasPan.x;
      const centerY = height / 2 + canvasPan.y;
      return {
        x: (screenX - centerX) / canvasZoom,
        y: (screenY - centerY) / canvasZoom,
      };
    },
    [canvasPan, canvasZoom]
  );

  // Render Fine-Tuning Canvas with RECTIFIED A4 TOOL IMAGE OVERLAY
  useEffect(() => {
    if (step !== 'finetune') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const centerX = rect.width / 2 + canvasPan.x;
    const centerY = rect.height / 2 + canvasPan.y;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(canvasZoom, canvasZoom);

    // 1. SCANNED A4 TOOL IMAGE OVERLAY
    if (showOverlay && imgRef.current) {
      const img = imgRef.current;
      ctx.save();
      ctx.globalAlpha = overlayOpacity;

      const imgWidthMm = (img.naturalWidth || img.width) * mmPerPixel * overlayScale;
      const imgHeightMm = (img.naturalHeight || img.height) * mmPerPixel * overlayScale;

      ctx.drawImage(
        img,
        -imgWidthMm / 2 + overlayOffsetX,
        -imgHeightMm / 2 + overlayOffsetY,
        imgWidthMm,
        imgHeightMm
      );
      ctx.restore();
    }

    // 2. Coordinate axes & mm crosshair
    ctx.lineWidth = 1.0 / canvasZoom;
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(-150, 0);
    ctx.lineTo(150, 0);
    ctx.moveTo(0, -150);
    ctx.lineTo(0, 150);
    ctx.stroke();

    // 3. Draw Polygon Contour Outline
    if (contour.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(contour[0].x, contour[0].y);
      for (let i = 1; i < contour.length; i++) {
        ctx.lineTo(contour[i].x, contour[i].y);
      }
      ctx.closePath();

      ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
      ctx.fill();

      ctx.lineWidth = 1.5 / canvasZoom;
      ctx.strokeStyle = '#818cf8';
      ctx.stroke();

      // Clearance boundary
      if (clearanceMm > 0) {
        ctx.save();
        ctx.setLineDash([2 / canvasZoom, 2 / canvasZoom]);
        ctx.lineWidth = 0.8 / canvasZoom;
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();
        ctx.restore();
      }

      // 4. Draw Vertex Points
      for (let i = 0; i < contour.length; i++) {
        const pt = contour[i];
        const isSelected = i === selectedPointIndex;

        ctx.fillStyle = isSelected ? '#38bdf8' : '#ffffff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, (isSelected ? 4.5 : 3.0) / canvasZoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 1.0 / canvasZoom;
        ctx.strokeStyle = isSelected ? '#ffffff' : '#4f46e5';
        ctx.stroke();

        if (isSelected) {
          ctx.font = `${Math.max(2.5, 3)}px monospace`;
          ctx.fillStyle = '#38bdf8';
          ctx.fillText(`P${i}`, pt.x + 4 / canvasZoom, pt.y - 4 / canvasZoom);
        }
      }
    }

    // 5. Draw Draggable Negative Pill Shape Finger Pockets & Handles
    for (const pocket of fingerPockets) {
      const pillPts = generatePillContour(pocket, 12);
      const isSelectedPocket = pocket.id === selectedPocketId;
      if (pillPts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(pillPts[0].x, pillPts[0].y);
        for (let i = 1; i < pillPts.length; i++) {
          ctx.lineTo(pillPts[i].x, pillPts[i].y);
        }
        ctx.closePath();

        ctx.fillStyle = isSelectedPocket
          ? 'rgba(249, 115, 22, 0.42)'
          : 'rgba(249, 115, 22, 0.28)';
        ctx.fill();

        ctx.lineWidth = (isSelectedPocket ? 1.8 : 1.2) / canvasZoom;
        ctx.strokeStyle = isSelectedPocket ? '#fb923c' : '#f97316';
        ctx.stroke();

        ctx.fillStyle = '#fed7aa';
        ctx.font = `${Math.max(2.5, 3)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(
          `${pocket.length.toFixed(0)}×${pocket.width.toFixed(0)} R${(
            pocket.cornerRadius ?? pocket.width / 2
          ).toFixed(1)}`,
          pocket.x,
          pocket.y
        );

        // Draw direct drag handles for length, width, and corner radius
        const hx = Math.max(2, pocket.length / 2);
        const hy = Math.max(2, pocket.width / 2);
        const maxR = Math.min(hx, hy);
        const r = Math.max(0.5, Math.min(pocket.cornerRadius ?? hy, maxR));
        const toWorld = (lx: number, ly: number) => {
          const rot = rotatePoint({ x: lx, y: ly }, pocket.rotation);
          return { x: pocket.x + rot.x, y: pocket.y + rot.y };
        };
        const hSize = 5 / canvasZoom;

        [toWorld(hx, 0), toWorld(-hx, 0)].forEach((hp) => {
          ctx.fillStyle = '#06b6d4';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.fillRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
        });
        [toWorld(0, hy), toWorld(0, -hy)].forEach((hp) => {
          ctx.fillStyle = '#10b981';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / canvasZoom;
          ctx.fillRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
          ctx.strokeRect(hp.x - hSize / 2, hp.y - hSize / 2, hSize, hSize);
        });
        const rPt = toWorld(hx - r * 0.5, hy - r * 0.5);
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1 / canvasZoom;
        ctx.beginPath();
        ctx.arc(rPt.x, rPt.y, 3.2 / canvasZoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
    ctx.restore();
  }, [
    step,
    contour,
    selectedPointIndex,
    selectedPocketId,
    fingerPockets,
    showOverlay,
    overlayOpacity,
    overlayScale,
    overlayOffsetX,
    overlayOffsetY,
    canvasZoom,
    canvasPan,
    mmPerPixel,
    clearanceMm,
    imgLoadedTick,
  ]);

  // Fine-tuning canvas mouse interactions
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      isPanningRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const hitRadiusMm = 8 / canvasZoom;

    // 1. Check pill pocket resize handles & pill bodies first
    for (let i = fingerPockets.length - 1; i >= 0; i--) {
      const pocket = fingerPockets[i];
      const hx = Math.max(2, pocket.length / 2);
      const hy = Math.max(2, pocket.width / 2);
      const maxR = Math.min(hx, hy);
      const r = Math.max(0.5, Math.min(pocket.cornerRadius ?? hy, maxR));
      const local = rotatePoint({ x: world.x - pocket.x, y: world.y - pocket.y }, -pocket.rotation);

      if (Math.hypot(local.x - (hx - r * 0.5), local.y - (hy - r * 0.5)) <= hitRadiusMm) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-radius',
          pocketId: pocket.id,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }
      if (Math.hypot(local.x - hx, local.y) <= hitRadiusMm || Math.hypot(local.x + hx, local.y) <= hitRadiusMm) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-length',
          pocketId: pocket.id,
          handleSign: local.x >= 0 ? 1 : -1,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }
      if (Math.hypot(local.x, local.y - hy) <= hitRadiusMm || Math.hypot(local.x, local.y + hy) <= hitRadiusMm) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-width',
          pocketId: pocket.id,
          handleSign: local.y >= 0 ? 1 : -1,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }
      const pillPts = generatePillContour(pocket, 10);
      if (pointInPolygon(world, pillPts)) {
        setSelectedPocketId(pocket.id);
        setSelectedPointIndex(null);
        dragTargetRef.current = {
          type: 'pocket-move',
          pocketId: pocket.id,
          startWorld: world,
          initialX: pocket.x,
          initialY: pocket.y,
          initialLength: pocket.length,
          initialWidth: pocket.width,
          initialRadius: r,
        };
        return;
      }
    }

    // 2. Check contour vertices
    let hitIndex: number | null = null;
    for (let i = 0; i < contour.length; i++) {
      const d = Math.hypot(contour[i].x - world.x, contour[i].y - world.y);
      if (d <= hitRadiusMm) {
        hitIndex = i;
        break;
      }
    }

    if (hitIndex !== null) {
      setSelectedPointIndex(hitIndex);
      setSelectedPocketId(null);
      dragTargetRef.current = { type: 'point', index: hitIndex };
    } else {
      setSelectedPointIndex(null);
      isPanningRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - lastMousePosRef.current.x;
      const dy = e.clientY - lastMousePosRef.current.y;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      setCanvasPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    const drag = dragTargetRef.current;
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    if (drag.type === 'point') {
      setContour((prev) => {
        const next = [...prev];
        next[drag.index] = {
          x: Math.round(world.x * 10) / 10,
          y: Math.round(world.y * 10) / 10,
        };
        return next;
      });
      return;
    }

    setFingerPockets((prev) =>
      prev.map((p) => {
        if (p.id !== drag.pocketId) return p;
        if (drag.type === 'pocket-move') {
          return {
            ...p,
            x: Math.round((drag.initialX + (world.x - drag.startWorld.x)) * 10) / 10,
            y: Math.round((drag.initialY + (world.y - drag.startWorld.y)) * 10) / 10,
          };
        }
        const local = rotatePoint(
          { x: world.x - p.x, y: world.y - p.y },
          -p.rotation
        );
        if (drag.type === 'pocket-length') {
          const newLen = Math.round(Math.max(8, Math.min(120, Math.abs(local.x) * 2)) * 10) / 10;
          const maxR = Math.min(newLen / 2, p.width / 2);
          return {
            ...p,
            length: newLen,
            cornerRadius: Math.min(p.cornerRadius ?? maxR, maxR),
          };
        }
        if (drag.type === 'pocket-width') {
          const newW = Math.round(Math.max(6, Math.min(80, Math.abs(local.y) * 2)) * 10) / 10;
          const maxR = Math.min(p.length / 2, newW / 2);
          return {
            ...p,
            width: newW,
            cornerRadius: Math.min(p.cornerRadius ?? maxR, maxR),
          };
        }
        if (drag.type === 'pocket-radius') {
          const hx = p.length / 2;
          const hy = p.width / 2;
          const maxR = Math.min(hx, hy);
          const inset = Math.max(hx - local.x, hy - local.y);
          const newR = Math.round(Math.max(0.5, Math.min(maxR, inset / 0.5)) * 10) / 10;
          return {
            ...p,
            cornerRadius: newR,
          };
        }
        return p;
      })
    );
  };

  const handleCanvasMouseUp = () => {
    dragTargetRef.current = null;
    isPanningRef.current = false;
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setCanvasZoom((prev) => Math.max(0.5, Math.min(10.0, prev * factor)));
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || contour.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);

    setContour((prev) => {
      let bestDist = Infinity;
      let insertIdx = 0;
      for (let i = 0; i < prev.length; i++) {
        const next = (i + 1) % prev.length;
        const d1 = Math.hypot(prev[i].x - world.x, prev[i].y - world.y);
        const d2 = Math.hypot(prev[next].x - world.x, prev[next].y - world.y);
        if (d1 + d2 < bestDist) {
          bestDist = d1 + d2;
          insertIdx = next;
        }
      }
      const updated = [...prev];
      updated.splice(insertIdx, 0, {
        x: Math.round(world.x * 10) / 10,
        y: Math.round(world.y * 10) / 10,
      });
      setSelectedPointIndex(insertIdx);
      return updated;
    });
  };

  // Calculate live bounding box of contour
  const lengthMm =
    contour.length > 0
      ? Math.round((Math.max(...contour.map((p) => p.x)) - Math.min(...contour.map((p) => p.x))) * 10) / 10
      : 0;
  const widthMm =
    contour.length > 0
      ? Math.round((Math.max(...contour.map((p) => p.y)) - Math.min(...contour.map((p) => p.y))) * 10) / 10
      : 0;

  const { widthMm: a4W, heightMm: a4H } = getA4DimensionsMm(a4Orientation);

  // Save tool and transition to Studio & 3D CAD
  const handleSave = () => {
    const newTool: ToolDef = {
      id: initialTool?.id || `tool-${Date.now()}`,
      name: toolName,
      category,
      contour,
      depth: depthMm,
      clearance: clearanceMm,
      fingerPockets,
      scannedImageUrl: rectifiedSrc,
      imageScale: mmPerPixel,
    };
    onSaveTool(newTool);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top action header */}
      <div className="h-13 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-semibold text-sm text-white flex items-center gap-2">
              <span>Tool Scanner &amp; A4 Reference Calibration</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                A4 ({a4W}×{a4H}mm)
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                Step: {step.toUpperCase()}
              </span>
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {step === 'finetune' && (
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 active:scale-95 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save &amp; Open in Studio</span>
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            <span>Go to Studio &amp; 3D CAD</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Step 1: Upload A4 + Tool Photo */}
      {step === 'upload' && (
        <div className="flex-1 p-6 flex flex-col items-center justify-center max-w-2xl mx-auto">
          <div className="w-full bg-slate-900 rounded-2xl border border-slate-800 p-8 text-center flex flex-col items-center gap-5 shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <FileText className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">Upload Photo of Item on A4 Paper</h3>
              <p className="text-xs text-slate-400 mt-1.5 max-w-md leading-relaxed">
                Place your tool or item flat on a standard <strong className="text-cyan-300">A4 sheet (210 × 297 mm)</strong> over a darker desk surface. We detect the A4 paper corners to calibrate exact 1:1 millimeter scale and trace your item.
              </p>
            </div>

            {/* A4 Reference Guidelines */}
            <div className="w-full grid grid-cols-3 gap-2.5 text-left bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-[11px]">
              <div>
                <div className="font-semibold text-cyan-300">1. A4 Reference</div>
                <div className="text-slate-400 mt-0.5">Keep all 4 corners of the white A4 sheet visible.</div>
              </div>
              <div>
                <div className="font-semibold text-indigo-300">2. Contrast</div>
                <div className="text-slate-400 mt-0.5">Place item inside the A4 sheet on a contrasting surface.</div>
              </div>
              <div>
                <div className="font-semibold text-emerald-300">3. Auto Trace</div>
                <div className="text-slate-400 mt-0.5">Perspective-corrected to exact mm &amp; traced cleanly.</div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 w-full max-w-sm">
              <label className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs cursor-pointer shadow-lg shadow-indigo-600/30 transition-all">
                <Upload className="w-4 h-4" />
                <span>Upload A4 + Item Photo</span>
                <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
              <p className="text-[11px] text-slate-500">
                Supports PNG, JPG, and HEIC/WebP photos of tools placed on white A4 paper.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: A4 Corner Alignment & Tracing Calibration */}
      {step === 'calibrate' && (
        <div className="flex-1 p-5 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto w-full overflow-hidden">
          {/* Interactive A4 4-Corner Calibration Canvas */}
          <div className="md:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 p-3 flex flex-col relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  data-testid="a4-detect-status"
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border flex items-center gap-1.5 ${
                    a4AutoDetected
                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700/70'
                      : 'bg-cyan-950/80 text-cyan-300 border-cyan-800/60'
                  }`}
                >
                  <Scan className="w-3 h-3" />
                  <span>
                    {a4AutoDetected
                      ? `A4 Auto-Detected (${Math.round(a4Confidence * 100)}%)`
                      : 'Manual / Refining A4 Corners'}
                  </span>
                </span>
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Drag TL, TR, BR, BL handles if fine adjustment is needed
                </span>
              </div>
              <button
                type="button"
                onClick={() => runAutoDetectA4(imageSrc)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 border border-slate-700 transition-colors"
              >
                Re-Detect A4
              </button>
            </div>
            <div className="flex-1 relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
              <canvas
                ref={calibCanvasRef}
                onMouseDown={handleCalibMouseDown}
                onMouseMove={handleCalibMouseMove}
                onMouseUp={handleCalibMouseUp}
                onMouseLeave={handleCalibMouseUp}
                className="w-full h-full cursor-crosshair block"
              />
            </div>
          </div>

          {/* Calibration Settings Sidebar */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-sm text-white">A4 Reference Calibration</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Scales your photo to exact ISO 216 A4 dimensions and traces only the object on the sheet.
                </p>
              </div>

              {/* A4 Orientation Toggle */}
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1.5">
                  A4 Paper Orientation:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setA4Orientation('landscape')}
                    className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                      a4Orientation === 'landscape'
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Landscape (297×210mm)
                  </button>
                  <button
                    type="button"
                    onClick={() => setA4Orientation('portrait')}
                    className={`py-2 px-2 rounded-lg text-xs font-medium border transition-colors ${
                      a4Orientation === 'portrait'
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                  >
                    Portrait (210×297mm)
                  </button>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Reference Sheet:</span>
                  <span className="text-cyan-400">ISO A4 ({a4W} × {a4H} mm)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Trace Target:</span>
                  <span className="text-emerald-400">Largest item inside A4</span>
                </div>
              </div>

              <div className="h-px bg-slate-800" />

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                  <span>Object Trace Threshold:</span>
                  <span className="font-mono text-indigo-400">{threshold}</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="225"
                  value={threshold}
                  onChange={(e) => setThreshold(parseInt(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Adjust if lighting shadows on the white A4 paper affect the trace.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={invertMask}
                  onChange={(e) => setInvertMask(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-indigo-600"
                />
                <span>Light object on dark background (Invert)</span>
              </label>
            </div>

            <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleExtractContour}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition-all active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-cyan-300" />
                <span>{isProcessing ? 'Rectifying A4 & Tracing...' : 'Trace Item on A4 & Fine-Tune'}</span>
              </button>

              <button
                type="button"
                onClick={() => setStep('upload')}
                className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
              >
                Upload Different Photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: FINE-TUNING with RECTIFIED A4 SCANNED TOOL IMAGE OVERLAY */}
      {step === 'finetune' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Main Interactive Canvas Area */}
          <div className="flex-1 relative bg-slate-950 flex flex-col overflow-hidden">
            {/* Overlay Toolbar */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 shadow-xl">
              <button
                type="button"
                onClick={() => setShowOverlay(!showOverlay)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  showOverlay
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {showOverlay ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{showOverlay ? 'Overlay Visible' : 'Overlay Hidden'}</span>
              </button>

              {showOverlay && (
                <div className="flex items-center gap-2 px-2 border-l border-slate-700/60 text-xs text-slate-300">
                  <span className="text-[11px] text-slate-400">Opacity:</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={overlayOpacity}
                    onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                    className="w-20 accent-indigo-500"
                  />
                  <span className="font-mono text-[10px] text-indigo-300 w-8">
                    {Math.round(overlayOpacity * 100)}%
                  </span>
                </div>
              )}

              <div className="h-4 w-px bg-slate-700/60" />

              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.min(10.0, z * 1.2))}
                aria-label="Zoom in"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.max(0.5, z / 1.2))}
                aria-label="Zoom out"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Canvas Instructions Banner */}
            <div className="absolute bottom-3 left-3 z-20 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] text-slate-400 flex items-center gap-3">
              <span>A4 1:1 Scale Active</span>
              <span className="text-slate-600">•</span>
              <span>Drag vertices to adjust contour</span>
              <span className="text-slate-600">•</span>
              <span>Double-click to insert point</span>
              <span className="text-slate-600">•</span>
              <span>Shift+Drag to Pan</span>
            </div>

            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onWheel={handleCanvasWheel}
              onDoubleClick={handleCanvasDoubleClick}
              className="w-full h-full cursor-crosshair block"
            />
          </div>

          {/* Right Parameters Sidebar */}
          <div className="w-80 bg-slate-900 border-l border-slate-800 p-4 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-slate-400">
                  Tool Parameters &amp; Cutout
                </h3>
                <button
                  type="button"
                  onClick={() => setStep('calibrate')}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 underline"
                >
                  Re-calibrate A4
                </button>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  Tool Name:
                </label>
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              {/* Dimensions readout */}
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 grid grid-cols-2 gap-2 text-center font-mono">
                <div>
                  <div className="text-[10px] text-slate-500">LENGTH (A4 SCALED)</div>
                  <div className="text-sm font-semibold text-cyan-400">{lengthMm} mm</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">WIDTH (A4 SCALED)</div>
                  <div className="text-sm font-semibold text-indigo-400">{widthMm} mm</div>
                </div>
              </div>

              {/* Pocket Depth */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                  <span>Cavity Pocket Depth:</span>
                  <span className="font-mono text-indigo-400">{depthMm} mm</span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="25"
                  step="0.5"
                  value={depthMm}
                  onChange={(e) => setDepthMm(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              {/* Clearance */}
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
                  <span>Tolerance Clearance:</span>
                  <span className="font-mono text-cyan-400">{clearanceMm} mm</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="2.0"
                  step="0.1"
                  value={clearanceMm}
                  onChange={(e) => setClearanceMm(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="h-px bg-slate-800" />

              {/* Negative Pill Shape Finger Pocket Settings */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-xs text-orange-400">
                    Smooth Negative Pill Pocket
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newPocket: FingerPocket = {
                        id: `fp-${Date.now()}`,
                        x: 0,
                        y: 0,
                        width: 18,
                        length: 30,
                        depth: depthMm + 2.0,
                        rotation: 0,
                        cornerRadius: 9,
                        slopeAngle: 30,
                      };
                      setFingerPockets([...fingerPockets, newPocket]);
                    }}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-orange-950 text-orange-300 border border-orange-800/80 hover:bg-orange-900 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Pill</span>
                  </button>
                </div>

                {fingerPockets.map((fp, idx) => {
                  const maxCornerR = Math.min(fp.length / 2, fp.width / 2);
                  const currentR = Math.min(fp.cornerRadius ?? fp.width / 2, maxCornerR);
                  return (
                    <div
                      key={fp.id}
                      className="bg-slate-950 p-2.5 rounded-lg border border-orange-900/40 space-y-2 mb-2"
                    >
                      <div className="flex items-center justify-between text-[11px] text-orange-300 font-medium">
                        <span>Pill Shape #{idx + 1} (Drag on Canvas)</span>
                        <button
                          type="button"
                          aria-label={`Remove Pill Shape ${idx + 1}`}
                          onClick={() =>
                            setFingerPockets(fingerPockets.filter((p) => p.id !== fp.id))
                          }
                          className="text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400">
                        <div>
                          <span>Width: {fp.width}mm</span>
                          <input
                            type="range"
                            min="6"
                            max="60"
                            step="0.5"
                            value={fp.width}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              const nextMaxR = Math.min(fp.length / 2, val / 2);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id
                                    ? {
                                        ...p,
                                        width: val,
                                        cornerRadius: Math.min(p.cornerRadius ?? nextMaxR, nextMaxR),
                                      }
                                    : p
                                )
                              );
                            }}
                            className="w-full accent-orange-500"
                          />
                        </div>
                        <div>
                          <span>Length: {fp.length}mm</span>
                          <input
                            type="range"
                            min="8"
                            max="90"
                            step="0.5"
                            value={fp.length}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              const nextMaxR = Math.min(val / 2, fp.width / 2);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id
                                    ? {
                                        ...p,
                                        length: val,
                                        cornerRadius: Math.min(p.cornerRadius ?? nextMaxR, nextMaxR),
                                      }
                                    : p
                                )
                              );
                            }}
                            className="w-full accent-orange-500"
                          />
                        </div>
                        <div>
                          <span>Corner Radius: {currentR.toFixed(1)}mm</span>
                          <input
                            type="range"
                            min="0.5"
                            max={maxCornerR}
                            step="0.5"
                            value={currentR}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id ? { ...p, cornerRadius: val } : p
                                )
                              );
                            }}
                            className="w-full accent-amber-400"
                          />
                        </div>
                        <div>
                          <span>Depth: {fp.depth}mm</span>
                          <input
                            type="range"
                            min="3"
                            max="30"
                            step="0.5"
                            value={fp.depth}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setFingerPockets(
                                fingerPockets.map((p) =>
                                  p.id === fp.id ? { ...p, depth: val } : p
                                )
                              );
                            }}
                            className="w-full accent-orange-400"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => setContour(simplifyContour(contour, 0.5))}
                className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3 text-indigo-400" />
                <span>Smooth Curves ({contour.length} pts)</span>
              </button>
            </div>

            <div className="pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/30 transition-all active:scale-95"
              >
                <Check className="w-4 h-4" />
                <span>Save to Gridfinity Bin</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
