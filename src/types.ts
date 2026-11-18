export interface Point2D {
  x: number;
  y: number;
}

export interface FingerPocket {
  id: string;
  x: number; // offset from tool center in mm
  y: number; // offset from tool center in mm
  width: number; // pill width (mm) e.g. 18mm
  length: number; // pill length (mm) e.g. 32mm
  depth: number; // cutout depth (mm) e.g. 12mm
  rotation: number; // angle in degrees
  cornerRadius: number; // pill end radius
  slopeAngle?: number; // angle of smooth slope entry
}

export interface ToolDef {
  id: string;
  name: string;
  category: string;
  contour: Point2D[]; // in mm, centered around (0,0)
  depth: number; // pocket depth in mm (e.g. 12mm)
  clearance: number; // tolerance offset in mm (e.g. 0.5mm)
  fingerPockets: FingerPocket[];
  scannedImageUrl?: string; // base64 or URL of scanned image
  imageScale?: number; // mm per pixel
  imageOffset?: Point2D;
  imageRotation?: number;
}

export interface PlacedTool {
  instanceId: string;
  toolId: string;
  tool: ToolDef;
  x: number; // center position on bin in mm (0 to totalWidth)
  y: number; // center position on bin in mm (0 to totalHeight)
  rotation: number; // rotation in degrees
  depthOverride?: number;
  fingerPockets: FingerPocket[];
}

export type MagnetMode = 'corners' | 'full' | 'none';
export type TextReliefMode = 'none' | 'engrave' | 'emboss';

export interface GridfinityTextConfig {
  text: string; // Enforced CAPSLOCK in UI & geometry
  mode: TextReliefMode; // 'engrave' | 'emboss' | 'none'
  fontSize: number; // letter height in mm (5 to 24)
  depth: number; // relief height/depth in mm (0.4 to 3.0)
  x: number; // bin X position in mm
  y: number; // bin Y position in mm
  rotation: number; // degrees
}

export interface GridfinityConfig {
  gridX: number; // number of 42mm columns (1-12)
  gridY: number; // number of 42mm rows (1-12)
  gridZ: number; // height unit (1 unit = 7mm, e.g. 1U=7mm to 10U=70mm)
  customHeightMm?: number; // total bin body height in mm (overrides gridZ if set)
  wallThickness: number; // standard 1.2 to 2.4mm
  floorThickness: number; // solid base floor height before cavities (default 6.0mm)
  chamferSize: number; // 45 degree model cutout chamfer in mm (0.0 to 2.5mm)
  lipHeight: number; // adjustable stackable lip wall height in mm (0 = off, default 5.0mm)
  hasStackingLip?: boolean; // legacy toggle sync (true when lipHeight > 0)
  magnetMode: MagnetMode; // 'corners' (4 outer corners) | 'full' (4 per 1x1 unit) | 'none'
  hasMagnets?: boolean; // legacy sync
  hasScrews: boolean; // M3 screw holes
  magnetDiameter: number; // standard 6.5mm for 6x2mm magnets
  magnetDepth: number; // standard 2.4mm
  screwDiameter: number; // standard 3.0mm for M3 per Gridfinity v5 spec
  smartSnapping: boolean; // auto-detect contours & align with visual guide lines
  snapTolerance: number; // in mm (e.g. 2.5mm)
  textLabel?: GridfinityTextConfig; // CAPSLOCK embossed/engraved label on Gridfinity
}

export interface SnapGuide {
  type: 'x' | 'y';
  position: number; // coordinate along the snapped axis
  source: 'tool-edge' | 'tool-center' | 'grid-center' | 'grid-line';
  label: string;
  from: number; // start along perpendicular axis for drawing
  to: number;   // end along perpendicular axis for drawing
}
