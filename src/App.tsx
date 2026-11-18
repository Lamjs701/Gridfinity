/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GridfinityConfig, PlacedTool, ToolDef } from './types';
import { Navbar, NavTab } from './components/Navbar';
import { StudioView } from './components/StudioView';
import { ToolScannerView } from './components/ToolScannerView';
import { ExportView } from './components/ExportView';
import {
  getBinDimensions,
  getStackingLipProfile,
  getToolBounds,
  calculateAutoGridfinityLayout,
  findBestClearTextPosition,
  STACKING_LIP_HEIGHT,
  V5_MAGNET_DIAMETER,
  V5_SCREW_DIAMETER,
} from './utils/geometry';

export default function App() {
  const initialTab: NavTab =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'studio'
      ? 'studio'
      : 'scanner';
  const [currentTab, setCurrentTab] = useState<NavTab>(initialTab);

  // Parametric Gridfinity Configuration
  const [config, setConfig] = useState<GridfinityConfig>({
    gridX: 4, // 4x2U standard tool bin (167.5 x 83.5 mm)
    gridY: 2,
    gridZ: 4, // 28mm standard drawer height
    customHeightMm: 28,
    wallThickness: 1.8,
    floorThickness: 6.0,
    chamferSize: 1.0, // Smooth 45° chamfer on model cutout edge (mm)
    lipHeight: STACKING_LIP_HEIGHT, // 5.0mm adjustable stackable lip wall
    hasStackingLip: true,
    magnetMode: 'corners', // 'corners' (4 outer corners) | 'full' (4 per unit) | 'none'
    hasMagnets: true,
    hasScrews: false,
    magnetDiameter: V5_MAGNET_DIAMETER, // 6.5Ø standard magnets per v5 reference
    magnetDepth: 2.4,
    screwDiameter: V5_SCREW_DIAMETER, // 3.0Ø M3 screws per v5 reference
    smartSnapping: true, // smart snapping with visual guide lines
    snapTolerance: 2.5,
    textLabel: {
      text: '',
      mode: 'engrave',
      fontSize: 9,
      depth: 1.0,
      x: 83.8,
      y: 70,
      rotation: 0,
    },
  });

  // Start clean with no sample tools placed
  const [tools, setTools] = useState<PlacedTool[]>([]);

  // Handle scanned tool save: auto-generate suitable Gridfinity units & center the entire design
  const handleSaveScannedTool = (newTool: ToolDef) => {
    const newPlacedDraft: PlacedTool = {
      instanceId: `inst-custom-${Date.now()}`,
      toolId: newTool.id,
      tool: newTool,
      x: 0,
      y: 0,
      rotation: 0,
      fingerPockets: [...newTool.fingerPockets],
    };

    let candidateTools: PlacedTool[];
    if (tools.length === 0) {
      candidateTools = [newPlacedDraft];
    } else {
      // Place below existing tools before auto-sizing and centering collective design
      let maxBottom = -Infinity;
      let sumX = 0;
      for (const t of tools) {
        const b = getToolBounds(t);
        if (b.maxY > maxBottom) maxBottom = b.maxY;
        sumX += b.centerX;
      }
      const newBounds = getToolBounds(newPlacedDraft);
      candidateTools = [
        ...tools,
        {
          ...newPlacedDraft,
          x: sumX / tools.length,
          y: maxBottom + newBounds.height / 2 + 8,
        },
      ];
    }

    const autoLayout = calculateAutoGridfinityLayout(candidateTools, config, {
      optimizeOrientation: tools.length === 0,
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

    setConfig((prev) => ({
      ...prev,
      gridX: autoLayout.gridX,
      gridY: autoLayout.gridY,
      gridZ: autoLayout.gridZ,
      customHeightMm: autoLayout.customHeightMm,
      textLabel: prev.textLabel
        ? {
            ...prev.textLabel,
            x: bestTextPos.x,
            y: bestTextPos.y,
          }
        : undefined,
    }));
    setTools(autoLayout.tools);
    setCurrentTab('studio');
  };

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

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        toolCount={tools.length}
        gridDimensions={`${config.gridX}x${config.gridY}U (${width.toFixed(0)}x${length.toFixed(0)}x${totalHeight.toFixed(1)}mm)`}
      />

      {/* Main View Router */}
      <main className="flex-1 flex overflow-hidden">
        {currentTab === 'studio' && (
          <StudioView
            config={config}
            onUpdateConfig={setConfig}
            tools={tools}
            onUpdateTools={setTools}
            onOpenScanner={() => setCurrentTab('scanner')}
          />
        )}

        {currentTab === 'scanner' && (
          <ToolScannerView
            onSaveTool={handleSaveScannedTool}
            onCancel={() => setCurrentTab('studio')}
          />
        )}

        {currentTab === 'export' && (
          <ExportView config={config} tools={tools} />
        )}
      </main>
    </div>
  );
}
