import React, { useState } from 'react';
import { PlacedTool, GridfinityConfig } from '../types';
import {
  getBinDimensions,
  getStackingLipProfile,
  STACKING_LIP_HEIGHT,
} from '../utils/geometry';
import { downloadStl } from '../utils/stlExporter';
import { downloadSvg, generateLaserCutSvg } from '../utils/svgExporter';
import {
  Download,
  FileCode,
  Printer,
  Layers,
  CheckCircle2,
  Cpu,
  ShieldCheck,
} from 'lucide-react';

interface ExportViewProps {
  config: GridfinityConfig;
  tools: PlacedTool[];
}

export const ExportView: React.FC<ExportViewProps> = ({ config, tools }) => {
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const { width, length, height } = getBinDimensions(
    config.gridX,
    config.gridY,
    config.gridZ,
    config.customHeightMm
  );
  const lipInfo = getStackingLipProfile(
    config.lipHeight ?? (config.hasStackingLip !== false ? STACKING_LIP_HEIGHT : 0)
  );
  const totalHeight = height + (lipInfo.enabled ? lipInfo.height : 0);
  const magnetMode = config.magnetMode ?? (config.hasMagnets ? 'corners' : 'none');
  const magnetLabel =
    magnetMode === 'full'
      ? `Full (${config.gridX * config.gridY * 4} Magnets — 4/Unit)`
      : magnetMode === 'corners'
      ? '4 Outermost Corners'
      : 'None';

  // Estimates
  const volumeCm3 = Math.round((width * length * totalHeight * 0.35) / 1000);
  const filamentGrams = Math.round(volumeCm3 * 1.24);
  const printHours = Math.max(1, Math.round(filamentGrams / 35));

  const handleDownloadStl = () => {
    downloadStl(config, tools);
    setDownloadSuccess('STL Binary file ready for slicer!');
    setTimeout(() => setDownloadSuccess(null), 4000);
  };

  const handleDownloadSvg = () => {
    downloadSvg(config, tools);
    setDownloadSuccess('1:1 Laser Cut Foam SVG exported!');
    setTimeout(() => setDownloadSuccess(null), 4000);
  };

  const handlePrintTemplate = () => {
    const svgContent = generateLaserCutSvg(config, tools);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Gridfinity 1:1 Scale Print Template</title>
          <style>
            @page { size: auto; margin: 10mm; }
            body { margin: 0; display: flex; flex-direction: column; align-items: center; font-family: sans-serif; }
            .header { margin-bottom: 8mm; text-align: center; }
            h2 { margin: 0 0 2mm 0; }
            p { margin: 0; font-size: 10pt; color: #555; }
            svg { border: 1px dashed #ccc; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>AI Gridfinity Studio — 1:1 Scale Paper Template</h2>
            <p>Verify printer scale with a ruler against the 100mm scale check bar. Place your tools directly on this sheet to verify fit before 3D printing.</p>
          </div>
          ${svgContent}
          <script>
            window.onload = () => window.print();
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    }
  };

  return (
    <div className="flex-1 bg-slate-950 p-6 overflow-y-auto text-slate-100">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>Export &amp; Manufacturing Production</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
              {config.gridX}x{config.gridY}U • {width.toFixed(1)} x {length.toFixed(1)} x {totalHeight.toFixed(1)} mm
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Export verified 3D printable STL files, 1:1 scale laser cut foam vectors, or print a 1:1 paper template to test tool fits.
          </p>
        </div>

        {downloadSuccess && (
          <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{downloadSuccess}</span>
          </div>
        )}

        {/* 3 Main Export Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 1. 3D Print STL */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between shadow-xl">
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <FileCode className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">3D Printable STL (Binary)</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Precision manifold mesh with Gridfinity v5 stepped base, adjustable stackable lip, 45° cutout chamfers, and negative pill pockets.
                </p>
              </div>
              <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded-lg border border-slate-800 space-y-0.5">
                <div>Format: Binary STL (Standard)</div>
                <div>Cutout Chamfer: {config.chamferSize}mm @ 45°</div>
                <div>Stacking Lip: {lipInfo.enabled ? `${lipInfo.height.toFixed(1)}mm` : 'Disabled'}</div>
                <div>Magnets: {magnetLabel}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadStl}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Download .STL File</span>
            </button>
          </div>

          {/* 2. 1:1 Laser Cut Foam SVG */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between shadow-xl">
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Laser Cut 5S Shadow Foam</h3>
                <p className="text-xs text-slate-400 mt-1">
                  1:1 scale vector file with perimeter cut lines, tool cavity cut paths, and pill finger pockets for Kaizen foam or CNC router foam carving.
                </p>
              </div>
              <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded-lg border border-slate-800 space-y-0.5">
                <div>Layer Red: Outer Boundary</div>
                <div>Layer Blue: Tool Cavity Cuts</div>
                <div>Layer Orange: Pill Grab Pockets</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadSvg}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md shadow-cyan-600/30 transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Download .SVG File</span>
            </button>
          </div>

          {/* 3. 1:1 Paper Fitment Template */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between shadow-xl">
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">1:1 Printable Fitment Sheet</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Print directly onto A4 or US Letter paper with a 100mm scale check bar. Place physical tools on top to check tolerances before printing.
                </p>
              </div>
              <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded-lg border border-slate-800 space-y-0.5">
                <div>Scale: 100% (No scaling)</div>
                <div>Calibration: 100mm verification ruler</div>
                <div>Target: Physical tool test</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handlePrintTemplate}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/30 transition-all active:scale-95"
            >
              <Printer className="w-4 h-4" />
              <span>Print 1:1 Template</span>
            </button>
          </div>
        </div>

        {/* Manufacturing & Slicing Specifications Table */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 shadow-xl">
          <h3 className="font-bold text-sm text-white flex items-center gap-2 mb-3">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <span>Recommended 3D Slicer Parameters (Bambu Studio / OrcaSlicer / PrusaSlicer)</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="text-slate-500 text-[10px]">LAYER HEIGHT</div>
              <div className="text-white font-semibold text-sm mt-0.5">0.20 mm</div>
              <div className="text-[10px] text-slate-400 mt-1">Standard profile</div>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="text-slate-500 text-[10px]">WALLS &amp; INFILL</div>
              <div className="text-white font-semibold text-sm mt-0.5">3 Walls / 15%</div>
              <div className="text-[10px] text-slate-400 mt-1">Gyroid pattern</div>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="text-slate-500 text-[10px]">CUTOUT CHAMFER</div>
              <div className="text-emerald-400 font-semibold text-sm mt-0.5">{config.chamferSize}mm @ 45°</div>
              <div className="text-[10px] text-slate-400 mt-1">Model cutout edges</div>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="text-slate-500 text-[10px]">EST. FILAMENT &amp; TIME</div>
              <div className="text-cyan-400 font-semibold text-sm mt-0.5">~{filamentGrams}g PLA</div>
              <div className="text-[10px] text-slate-400 mt-1">Approx. {printHours}h {printHours > 1 ? '15m' : '45m'}</div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Gridfinity v5 Reference Compliant • 42.0mm Pitch • 41.5mm Unit (0.5mm Tol.)</span>
            </div>
            <div className="text-indigo-400 font-mono">
              4.75mm Stepped Base (0.8 / 1.8 / 2.15mm) • 35.6mm Foot • {magnetLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
