import React from 'react';
import { Box, Camera, Download, Layers, Sparkles } from 'lucide-react';

export type NavTab = 'studio' | 'scanner' | 'export';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  toolCount: number;
  gridDimensions: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  toolCount,
  gridDimensions,
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white select-none sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Box className="w-5 h-5 text-slate-950 font-bold" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-white text-base font-['Plus_Jakarta_Sans',sans-serif]">
                AI Gridfinity Studio
              </span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60 font-mono">
                CAD v2.5
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
              <span>{gridDimensions}</span>
              <span className="text-slate-600">•</span>
              <span>{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs - Tool Scanner & Calibration first, Studio & 3D CAD second, Export third */}
        <nav className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800/80">
          <button
            type="button"
            onClick={() => onTabChange('scanner')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'scanner'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Tool Scanner &amp; Calibration</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('studio')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'studio'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Studio &amp; 3D CAD</span>
          </button>

          <button
            type="button"
            onClick={() => onTabChange('export')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              currentTab === 'export'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export &amp; Production</span>
          </button>
        </nav>

        {/* Quick status badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-2.5 py-1 rounded-full font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Gridfinity Standard</span>
          </div>
        </div>
      </div>
    </header>
  );
};
