export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignToken {
  element: string;
  property: string;
  value: string;
  category: "color" | "typography" | "spacing" | "sizing" | "border";
  nodeId?: string; // Figma node id (for position lookup)
  bbox?: BoundingBox; // absolute position in Figma frame
}

export interface ComparisonResult {
  element: string;
  property: string;
  designValue: string;
  implValue: string;
  status: "match" | "mismatch" | "missing_in_impl" | "extra_in_impl";
  severity: "critical" | "warning" | "info";
  notes: string;
  nodeId?: string;
  bbox?: BoundingBox;
}

export interface FigmaFrameInfo {
  imageUrl: string;
  frameWidth: number;
  frameHeight: number;
  frameX: number;
  frameY: number;
}

export interface FigmaExtractResult {
  tokens: DesignToken[];
  frame: FigmaFrameInfo | null;
}
