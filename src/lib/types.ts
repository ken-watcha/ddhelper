export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 요소 타입 — 비교 시 "버튼↔버튼", "텍스트↔텍스트"로만 매칭하기 위함
 */
export type ElementType =
  | "button"
  | "text"
  | "heading"
  | "card"
  | "container"
  | "icon"
  | "image"
  | "input"
  | "tag"
  | "divider"
  | "unknown";

export interface DesignToken {
  element: string; // 사람이 읽는 이름 (예: "Primary CTA Button")
  elementType: ElementType; // 비교 매칭용 카테고리
  property: string; // 속성명 (예: "background-color", "font-size")
  value: string; // 값 (예: "#FF0558", "16px")
  category: "color" | "typography" | "spacing" | "sizing" | "border";
  nodeId?: string; // Figma node id (시각적 뷰에서 위치 찾기용)
  bbox?: BoundingBox;
}

export interface ComparisonResult {
  element: string;
  elementType?: ElementType;
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

/**
 * Viewport 분류 — 사용자가 디자인하는 일반적인 브레이크포인트 기준.
 * Small: 모바일, Medium: 태블릿, Large: 데스크톱, XLarge: 큰 데스크톱.
 */
export type ViewportCategory = "small" | "medium" | "large" | "xlarge";

export const VIEWPORT_LABELS: Record<ViewportCategory, string> = {
  small: "Small (모바일)",
  medium: "Medium (태블릿)",
  large: "Large (데스크톱)",
  xlarge: "XLarge (와이드)",
};

export const VIEWPORT_RANGES: Record<ViewportCategory, string> = {
  small: "≤ 767px",
  medium: "768~999px",
  large: "1000~1279px",
  xlarge: "1280px+",
};

/**
 * 페이지 안의 한 프레임 단위 — viewport 라벨 + 그 프레임에서 추출한 모든 정보 묶음
 *
 * sectionName: 이 시안이 속한 Figma SECTION 노드의 이름.
 *   예: "로그인/구독 케이스", "비로그인/비구독 케이스"
 *   같은 viewport에 여러 케이스(로그인 vs 비로그인 등)가 있을 때 분리하기 위한 그룹 키.
 *   SECTION 안에 없으면 null.
 */
export interface FrameSet {
  frameId: string;
  name: string;
  width: number;
  height: number;
  viewport: ViewportCategory;
  sectionName: string | null;
  /**
   * 시안 이름에서 추출한 viewport 너비 범위.
   *   "1280 미만" → { min: 0, max: 1279 }
   *   "1280 이상" → { min: 1280, max: 9999 }
   *   "600~1279"  → { min: 600, max: 1279 }
   *   "(~767)"    → { min: 0, max: 767 }
   * 인식 못 하면 null (시안 자체 폭으로 fallback).
   */
  viewportRange: { min: number; max: number } | null;
  tokens: DesignToken[];
  frame: FigmaFrameInfo | null;
}

/**
 * 스테이징 페이지의 viewport별 캡처 결과
 */
export interface StagingCaptureItem {
  viewport: { width: number; height: number };
  capture: {
    imageDataUrl: string;
    pageWidth: number;
    pageHeight: number;
  } | null;
}

/**
 * 디자인 viewport 카테고리에 매핑되는 캡처 너비
 * - small (≤767):  375
 * - medium (768~999): 768
 * - large (1000~1279): 1024 ← '1280 미만' 시안의 표준 데스크톱 크기
 * - xlarge (1280+): 1440
 */
export const VIEWPORT_CAPTURE_WIDTHS: Record<ViewportCategory, number> = {
  small: 375,
  medium: 768,
  large: 1024,
  xlarge: 1440,
};

/**
 * 디자인 시스템 카탈로그 토큰 — 피그마 Styles / Variables에서 추출
 */
export interface DesignSystemToken {
  name: string; // 예: "Brand/Pink", "Spacing/Large"
  value: string; // 예: "#FF0558", "16px"
  type: "color" | "typography" | "effect" | "spacing";
  description?: string;
}

export interface FigmaExtractResult {
  tokens: DesignToken[];
  frame: FigmaFrameInfo | null;
  catalog?: DesignSystemToken[];
}

/**
 * 요소 타입별 체크리스트 — 어떤 속성을 꼭 추출해야 하는지 정의
 */
export const ELEMENT_CHECKLIST: Record<ElementType, string[]> = {
  button: [
    "background-color",
    "text-color",
    "font-size",
    "font-weight",
    "padding-horizontal",
    "padding-vertical",
    "border-radius",
    "border-color",
    "border-width",
    "height",
  ],
  text: ["color", "font-size", "font-weight", "line-height"],
  heading: [
    "color",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
  ],
  card: [
    "background-color",
    "border-color",
    "border-width",
    "border-radius",
    "padding",
    "gap",
  ],
  container: [
    "background-color",
    "padding",
    "gap",
    "width",
    "height",
  ],
  icon: ["color", "width", "height"],
  image: ["width", "height", "border-radius"],
  input: [
    "background-color",
    "text-color",
    "border-color",
    "border-width",
    "border-radius",
    "padding-horizontal",
    "padding-vertical",
    "font-size",
  ],
  tag: [
    "background-color",
    "text-color",
    "font-size",
    "padding-horizontal",
    "padding-vertical",
    "border-radius",
  ],
  divider: ["background-color", "height", "width"],
  unknown: [],
};
