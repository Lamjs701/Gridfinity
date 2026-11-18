import React, { useState } from 'react';
import { PlacedTool, GridfinityConfig, FingerPocket, MagnetMode, GridfinityTextConfig, TextReliefMode } from '../types';
import { Canvas2D } from './Canvas2D';
import { Viewer3D } from './Viewer3D';
import {
  getBinDimensions,
  recenterToolsOnGrid,
  calculateAutoGridfinityLayout,
  findBestClearTextPosition,
  STACKING_LIP_HEIGHT,
} from '../utils/geometry';
import {
  Crosshair,
  Sparkles,
  Magnet,
  Plus,
  Layers,
  Box,
  Camera,
  Columns,
  Square,
  Type,
  Wand2,
} from 'lucide-react';

interface StudioViewProps {
  config: GridfinityConfig;
  onUpdateConfig: (config: GridfinityConfig) => void;
  tools: PlacedTool[];
  onUpdateTools: (tools: PlacedTool[]) => void;
  onOpenScanner: () => void;
}

export const StudioView: React.FC<StudioViewProps> = ({
  config,
  onUpdateConfig,
  tools,
  onUpdateTools,
  onOpenScanner,
}) => {
  // Selected tool instance ID
  const [selectedToolId, setSelectedToolId] = useState<string | null>(
    tools.length > 0 ? tools[0].instanceId : null
  );

  // View mode: 'split' | '2d-only' | '3d-only'
  const [viewMode, setViewMode] = useState<'split' | '2d-only' | '3d-only'>('split');

  // Tool action modal open/close (no sample preset tools)
  const [showToolDrawer, setShowToolDrawer] = useState<boolean>(false);
  const [showTextEditor, setShowTextEditor] = useState<boolean>(false);

  const { width: binWidth, length: binLength, height: binHeight } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );

  const currentLipHeight =
    config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0);
  const currentMagnetMode: MagnetMode =
    config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');

  const currentTextLabel: GridfinityTextConfig = config.textLabel ?? {
    text: '',
    mode: 'engrave',
    fontSize: 9,
    depth: 1.0,
    x: Math.round((binWidth / 2) * 10) / 10,
    y: Math.round(Math.max(10, binLength - 12) * 10) / 10,
    rotation: 0,
  };

  const updateTextLabel = (patch: Partial<GridfinityTextConfig>) => {
    const nextText = patch.text !== undefined ? patch.text.toUpperCase() : currentTextLabel.text.toUpperCase();
    onUpdateConfig({
      ...config,
      textLabel: {
        ...currentTextLabel,
        ...patch,
        text: nextText,
      },
    });
  };

  // Update a single placed tool
  const handleUpdateTool = (updated: PlacedTool) => {
    onUpdateTools(tools.map((t) => (t.instanceId === updated.instanceId ? updated : t)));
  };

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Recenter all tools/cutouts on grid
  const handleRecenterTools = () => {
    const recentered = recenterToolsOnGrid(tools, binWidth, binLength);
    onUpdateTools(recentered);
    setToastMessage('Design centered on Gridfinity grid!');
    setTimeout(() => setToastMessage(null), 2400);
  };

  // Auto-generate suitable Gridfinity unit count & center the design
  const handleAutoFitAndCenter = () => {
    if (tools.length === 0) {
      setToastMessage('Add a scanned tool or pill slot first to auto-size units.');
      setTimeout(() => setToastMessage(null), 2400);
      return;
    }
    const autoLayout = calculateAutoGridfinityLayout(tools, config, {
      optimizeOrientation: tools.length === 1,
    });
    const { width: newW, length: newL } = getBinDimensions(
      autoLayout.gridX,
      autoLayout.gridY,
      autoLayout.gridZ,
      autoLayout.customHeightMm
    );
    const bestTextPos = findBestClearTextPosition(
      autoLayout.tools,
      newW,
      newL,
      config.textLabel?.fontSize ?? 9
    );
    onUpdateConfig({
      ...config,
      gridX: autoLayout.gridX,
      gridY: autoLayout.gridY,
      gridZ: autoLayout.gridZ,
      customHeightMm: autoLayout.customHeightMm,
      textLabel: config.textLabel
        ? {
            ...config.textLabel,
            x: bestTextPos.x,
            y: bestTextPos.y,
          }
        : undefined,
    });
    onUpdateTools(autoLayout.tools);
    setToastMessage(`Auto-sized to ${autoLayout.gridX}×${autoLayout.gridY}U & centered!`);
    setTimeout(() => setToastMessage(null), 2600);
  };

  // Add negative pill shape finger grab pocket to selected tool
  const handleAddFingerPocket = (toolId: string) => {
    const target = tools.find((t) => t.instanceId === toolId);
    if (!target) return;

    const existingPockets = target.fingerPockets || [];
    const newPocket: FingerPocket = {
      id: `fp-${Date.now()}`,
      x: 0,
      y: 0,
      width: 18,
      length: 34,
      depth: (target.depthOverride ?? target.tool.depth) + 2.0,
      rotation: 0,
      cornerRadius: 9,
      slopeAngle: 30,
    };

    handleUpdateTool({
      ...target,
      fingerPockets: [...existingPockets, newPocket],
    });
  };

  // Add a standalone draggable & resizable pill slot cutout directly onto the bin
  const handleAddStandalonePillCutout = () => {
    const id = `pill-cutout-${Date.now()}`;
    const defaultDepth = Math.min(Math.max(8, binHeight - 10), 14);
    const pillTool: PlacedTool = {
      instanceId: `inst-${id}`,
      toolId: id,
      tool: {
        id,
        name: 'Pill Finger Slot',
        category: 'Cutouts',
        contour: [], // Pure negative pill cutout directly in bin
        depth: defaultDepth,
        clearance: 0,
        fingerPockets: [],
      },
      x: Math.round((binWidth / 2) * 10) / 10,
      y: Math.round((binLength / 2) * 10) / 10,
      rotation: 0,
      depthOverride: defaultDepth,
      fingerPockets: [
        {
          id: `fp-${Date.now()}`,
          x: 0,
          y: 0,
          width: 20,
          length: 40,
          depth: defaultDepth,
          rotation: 0,
          cornerRadius: 10,
          slopeAngle: 30,
        },
      ],
    };

    onUpdateTools([...tools, pillTool]);
    setSelectedToolId(pillTool.instanceId);
    setShowToolDrawer(false);
  };

  const handleSetMagnetMode = (mode: MagnetMode) => {
    onUpdateConfig({
      ...config,
      magnetMode: mode,
      hasMagnets: mode !== 'none',
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      {/* Studio Top Controls Bar */}
      <div className="min-h-12 py-1.5 bg-slate-900 border-b border-slate-800 px-3 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Parametric Gridfinity Sliders & Selectors */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Adjustable Columns (X) & Rows (Y) */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs whitespace-nowrap shrink-0">
            <span className="text-slate-400 font-mono text-[11px]">COLS:</span>
            <button
              type="button"
              aria-label="Decrease Columns"
              onClick={() => onUpdateConfig({ ...config, gridX: Math.max(1, config.gridX - 1) })}
              disabled={config.gridX <= 1}
              className="w-5 h-5 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-35 text-slate-200 font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              aria-label="Grid Columns"
              min={1}
              max={12}
              value={config.gridX}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  onUpdateConfig({ ...config, gridX: Math.max(1, Math.min(12, val)) });
                }
              }}
              className="w-7 bg-transparent text-center text-white font-mono font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="Increase Columns"
              onClick={() => onUpdateConfig({ ...config, gridX: Math.min(12, config.gridX + 1) })}
              disabled={config.gridX >= 12}
              className="w-5 h-5 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-35 text-slate-200 font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
            >
              +
            </button>

            <span className="text-slate-600 font-mono px-0.5">×</span>

            <span className="text-slate-400 font-mono text-[11px]">ROWS:</span>
            <button
              type="button"
              aria-label="Decrease Rows"
              onClick={() => onUpdateConfig({ ...config, gridY: Math.max(1, config.gridY - 1) })}
              disabled={config.gridY <= 1}
              className="w-5 h-5 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-35 text-slate-200 font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              aria-label="Grid Rows"
              min={1}
              max={12}
              value={config.gridY}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val)) {
                  onUpdateConfig({ ...config, gridY: Math.max(1, Math.min(12, val)) });
                }
              }}
              className="w-7 bg-transparent text-center text-white font-mono font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              aria-label="Increase Rows"
              onClick={() => onUpdateConfig({ ...config, gridY: Math.min(12, config.gridY + 1) })}
              disabled={config.gridY >= 12}
              className="w-5 h-5 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-35 text-slate-200 font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
            >
              +
            </button>

            <span className="text-cyan-400 font-mono text-[10px] pl-1 border-l border-slate-800">
              {binWidth.toFixed(1)}×{binLength.toFixed(1)}mm
            </span>
          </div>

          {/* Sliding Height Adjuster (mm + U readout) */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs whitespace-nowrap shrink-0">
            <span className="text-slate-400 font-mono text-[11px]">HEIGHT:</span>
            <input
              aria-label="Bin Height Slider"
              type="range"
              min="7"
              max="84"
              step="1"
              value={binHeight}
              onChange={(e) => {
                const h = parseFloat(e.target.value);
                onUpdateConfig({
                  ...config,
                  customHeightMm: h,
                  gridZ: Math.max(1, Math.round(h / 7)),
                });
              }}
              className="w-16 accent-emerald-500 cursor-pointer"
            />
            <span className="font-mono text-white font-bold text-[11px] min-w-[60px] text-right">
              {binHeight.toFixed(0)}mm ({(binHeight / 7).toFixed(1).replace(/\.0$/, '')}U)
            </span>
          </div>

          {/* Sliding Stackable Lip Wall Height Adjuster (0 = Off, default 5.0mm) */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs whitespace-nowrap shrink-0">
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  ...config,
                  lipHeight: currentLipHeight > 0 ? 0 : STACKING_LIP_HEIGHT,
                  hasStackingLip: currentLipHeight <= 0,
                })
              }
              title="Click to toggle stacking lip on/off or slide to adjust lip wall height"
              className="flex items-center gap-1 text-slate-300 hover:text-amber-300 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px]">Lip:</span>
            </button>
            <input
              aria-label="Stackable Lip Wall Height"
              type="range"
              min="0"
              max="12"
              step="0.5"
              value={currentLipHeight}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                onUpdateConfig({
                  ...config,
                  lipHeight: val,
                  hasStackingLip: val >= 0.2,
                });
              }}
              className="w-14 accent-amber-400 cursor-pointer"
            />
            <span className="font-mono text-amber-300 text-[11px] w-10 text-right">
              {currentLipHeight >= 0.2 ? `${currentLipHeight.toFixed(1)}mm` : 'Off'}
            </span>
          </div>

          {/* Model Cutout 45° Chamfer Size */}
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-slate-800 text-xs whitespace-nowrap shrink-0">
            <span className="text-slate-400 text-[11px]" title="45° chamfer around model cutout edges">
              Cutout 45°:
            </span>
            <input
              aria-label="Model cutout 45 degree chamfer size in mm"
              type="range"
              min="0"
              max="2.5"
              step="0.1"
              value={config.chamferSize}
              onChange={(e) =>
                onUpdateConfig({ ...config, chamferSize: parseFloat(e.target.value) })
              }
              className="w-12 accent-emerald-500 cursor-pointer"
            />
            <span className="font-mono text-emerald-400 text-[11px] w-8 text-right">
              {config.chamferSize}mm
            </span>
          </div>

          {/* Magnets 3-Option Mode Selector: 4 Corners | Full (4/Unit) | None */}
          <div
            className="flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded-xl border border-slate-800 text-[11px] whitespace-nowrap shrink-0"
            role="group"
            aria-label="Magnet Mode"
          >
            <Magnet className="w-3.5 h-3.5 text-cyan-400 mx-0.5 shrink-0" />
            {(
              [
                { id: 'corners', label: '4 Corners' },
                { id: 'full', label: 'Full' },
                { id: 'none', label: 'None' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={currentMagnetMode === opt.id}
                onClick={() => handleSetMagnetMode(opt.id)}
                className={`px-2 py-0.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  currentMagnetMode === opt.id
                    ? 'bg-cyan-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Smart Snapping Toggle */}
          <button
            type="button"
            onClick={() => onUpdateConfig({ ...config, smartSnapping: !config.smartSnapping })}
            title="Toggle smart snapping mode (aligns tool edges and centerlines with visual guides)"
            className={`flex items-center gap-1.5 px-2 py-1 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
              config.smartSnapping
                ? 'bg-indigo-950/80 text-indigo-300 border-indigo-800 shadow-sm'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Snap</span>
          </button>
        </div>

        {/* Right: Actions & View layout switcher */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleAutoFitAndCenter}
            title="Auto-generate suitable Gridfinity units and center the design"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs shadow-md shadow-emerald-700/20 active:scale-95 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5 shrink-0" />
            <span>Auto-Fit Grid</span>
          </button>

          <button
            type="button"
            onClick={handleRecenterTools}
            title="Recenter all cutouts on Gridfinity bin"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/25 active:scale-95 transition-all whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5 shrink-0" />
            <span>Recenter</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTextEditor((v) => !v)}
            aria-expanded={showTextEditor}
            title="Add CAPSLOCK embossed or engraved text on Gridfinity"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-semibold text-xs border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showTextEditor || (currentTextLabel.mode !== 'none' && currentTextLabel.text.trim().length > 0)
                ? 'bg-purple-950/80 text-purple-200 border-purple-600 shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <Type className="w-3.5 h-3.5 text-purple-300 shrink-0" />
            <span>
              {currentTextLabel.text.trim() && currentTextLabel.mode !== 'none'
                ? `Text (${currentTextLabel.mode.toUpperCase()})`
                : 'Text Label'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleAddStandalonePillCutout}
            title="Add a draggable rounded negative pill slot cutout onto the model"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-orange-950/80 hover:bg-orange-900 text-orange-200 font-semibold text-xs border border-orange-700/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span>Pill Slot</span>
          </button>

          <button
            type="button"
            onClick={() => setShowToolDrawer(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Scan Tool</span>
          </button>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-0.5 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0" role="group" aria-label="Viewport Mode">
            <button
              type="button"
              onClick={() => setViewMode('2d-only')}
              title="Swap to 2D Plan View"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === '2d-only' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Square className="w-3.5 h-3.5 shrink-0" />
              <span>2D View</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('3d-only')}
              title="Swap to 3D CAD View"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === '3d-only' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Box className="w-3.5 h-3.5 shrink-0" />
              <span>3D View</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('split')}
              title="Split 2D + 3D View"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                viewMode === 'split' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Columns className="w-3.5 h-3.5 shrink-0" />
              <span>Split</span>
            </button>
          </div>
        </div>
      </div>

      {/* CAPSLOCK Text Emboss / Engrave Controls Strip */}
      {showTextEditor && (
        <div className="bg-slate-900/95 border-b border-purple-900/50 px-4 py-2 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-purple-300 uppercase tracking-wider">
              CAPSLOCK Label:
            </span>
            <input
              aria-label="Gridfinity CAPSLOCK Text"
              type="text"
              placeholder="E.G. 12MM WRENCH"
              value={currentTextLabel.text}
              onChange={(e) => updateTextLabel({ text: e.target.value.toUpperCase() })}
              className="w-44 bg-slate-950 border border-slate-700 focus:border-purple-500 rounded-lg px-2.5 py-1 text-xs font-mono font-bold uppercase text-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800" role="group" aria-label="Text Relief Mode">
            {(
              [
                { id: 'engrave', label: 'Engrave' },
                { id: 'emboss', label: 'Emboss' },
                { id: 'none', label: 'Off' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={currentTextLabel.mode === m.id}
                onClick={() => updateTextLabel({ mode: m.id as TextReliefMode })}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  currentTextLabel.mode === m.id
                    ? m.id === 'emboss'
                      ? 'bg-sky-600 text-white'
                      : m.id === 'engrave'
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-200'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400">Size:</span>
            <input
              aria-label="Text Font Size"
              type="range"
              min="5"
              max="24"
              step="0.5"
              value={currentTextLabel.fontSize}
              onChange={(e) => updateTextLabel({ fontSize: parseFloat(e.target.value) })}
              className="w-16 accent-purple-500 cursor-pointer"
            />
            <span className="font-mono text-purple-300 text-[11px] w-10 text-right">
              {currentTextLabel.fontSize.toFixed(1)}mm
            </span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400">
              {currentTextLabel.mode === 'emboss' ? 'Height:' : 'Depth:'}
            </span>
            <input
              aria-label="Text Relief Depth"
              type="range"
              min="0.4"
              max="3.0"
              step="0.2"
              value={currentTextLabel.depth}
              onChange={(e) => updateTextLabel({ depth: parseFloat(e.target.value) })}
              className="w-14 accent-sky-400 cursor-pointer"
            />
            <span className="font-mono text-sky-300 text-[11px] w-10 text-right">
              {currentTextLabel.depth.toFixed(1)}mm
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              const best = findBestClearTextPosition(
                tools,
                binWidth,
                binLength,
                currentTextLabel.fontSize
              );
              updateTextLabel({
                x: best.x,
                y: best.y,
              });
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium border border-slate-700 cursor-pointer"
          >
            Center Text
          </button>

          <span className="text-[10px] text-slate-500 ml-auto">
            Tip: Drag text directly on the 2D Gridfinity plan
          </span>
        </div>
      )}

      {/* Main Workspace: 2D Canvas & 3D Viewer */}
      <div className="flex-1 flex overflow-hidden relative">
        {toastMessage && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-indigo-600/95 text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-2xl border border-indigo-400/50 flex items-center gap-2 animate-bounce">
            <Crosshair className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* 2D Canvas Pane */}
        {(viewMode === 'split' || viewMode === '2d-only') && (
          <div className={`${viewMode === 'split' ? 'w-1/2 border-r border-slate-800' : 'w-full'} h-full relative`}>
            <div className="absolute top-3 left-44 z-10 text-[10px] uppercase font-mono font-bold tracking-wider text-slate-500 pointer-events-none">
              2D INTERACTIVE PLAN
            </div>
            <Canvas2D
              config={config}
              tools={tools}
              selectedToolId={selectedToolId}
              onSelectTool={setSelectedToolId}
              onUpdateTool={handleUpdateTool}
              onUpdateTools={onUpdateTools}
              onUpdateTextPosition={(x, y) => updateTextLabel({ x, y })}
              onRecenterTools={handleRecenterTools}
              onAddFingerPocket={handleAddFingerPocket}
            />
          </div>
        )}

        {/* 3D WebGL CAD Pane */}
        {(viewMode === 'split' || viewMode === '3d-only') && (
          <div className={`${viewMode === 'split' ? 'w-1/2' : 'w-full'} h-full relative`}>
            <div className="absolute top-3 left-3 z-10 text-[10px] uppercase font-mono font-bold tracking-wider text-slate-500 pointer-events-none">
              3D REAL-TIME CAD (PARAMETRIC)
            </div>
            <Viewer3D
              config={config}
              tools={tools}
              selectedToolId={selectedToolId}
            />
          </div>
        )}

        {/* Custom Tool / Cutout Modal (Zero sample tools) */}
        {showToolDrawer && (
          <div className="absolute inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 max-w-md w-full shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-base text-white">Add Tool Cutout</h3>
                  <p className="text-xs text-slate-400">
                    Scan your physical item on A4 paper or insert a custom pill cutout.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowToolDrawer(false)}
                  className="text-slate-400 hover:text-white text-xs px-2.5 py-1 rounded-lg bg-slate-800"
                >
                  Close
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowToolDrawer(false);
                  onOpenScanner();
                }}
                className="w-full flex items-center gap-4 p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/70 to-cyan-950/70 border border-indigo-700/60 hover:border-indigo-500 text-left transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 group-hover:scale-105 transition-transform">
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-xs text-white flex items-center gap-1.5">
                    <span>Scan Item on A4 Reference Sheet</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-300 font-mono">
                      1:1 Scale
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Upload a photo of your item on A4 paper to trace its exact contour and fine-tune vertices.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={handleAddStandalonePillCutout}
                className="w-full flex items-center gap-4 p-3.5 rounded-xl bg-slate-950 border border-orange-800/60 hover:border-orange-500 text-left transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-orange-600/20 border border-orange-500/40 flex items-center justify-center text-orange-400">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-xs text-white">Add Draggable Pill Slot Cutout</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Drop an adjustable negative pill pocket directly onto the bin and drag handles to resize length, width, and corner radius.
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

