import {
  DesignToken,
  BoundingBox,
  ElementType,
  FigmaFrameInfo,
  DesignSystemToken,
  ViewportCategory,
  FrameSet,
} from "./types";

export function parseFigmaUrl(url: string): {
  fileKey: string;
  nodeId: string;
} {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);

  let fileKey: string;
  const branchIndex = pathParts.indexOf("branch");
  if (branchIndex !== -1) {
    fileKey = pathParts[branchIndex + 1];
  } else {
    fileKey = pathParts[1];
  }

  const nodeIdParam = urlObj.searchParams.get("node-id") || "";
  const nodeId = nodeIdParam.replace("-", ":");

  return { fileKey, nodeId };
}

/**
 * Figma 노드 조회.
 * @param depth - 트리 깊이 제한 (기본 5). 페이지 단위 fetch 시 응답 크기 폭주 방지용.
 *               5면 페이지(0)→프레임(1)→자식(2)→손자(3)→증손자(4)→고손자(5)까지.
 *               토큰 추출에 충분하면서 거대 파일에서도 빠름.
 */
export async function fetchFigmaNode(
  fileKey: string,
  nodeId: string,
  depth: number = 5
): Promise<object> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new Error("FIGMA_ACCESS_TOKEN is not set");

  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(
    nodeId
  )}&depth=${depth}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });

  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Figma 노드의 렌더링 이미지 URL을 가져옴 (PNG, 2x)
 */
export async function fetchFigmaImage(
  fileKey: string,
  nodeId: string
): Promise<string | null> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`,
      { headers: { "X-Figma-Token": token } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.images?.[nodeId] || null;
  } catch {
    return null;
  }
}

/**
 * Figma JSON을 순회하면서 (nodeId → {name, type, bbox}) 맵을 만듦
 */
interface NodeMeta {
  id: string;
  name: string;
  type: string;
  bbox: BoundingBox;
  text?: string;
}

function collectNodes(data: unknown, result: NodeMeta[] = []): NodeMeta[] {
  if (!data || typeof data !== "object") return result;

  const obj = data as Record<string, unknown>;

  if (typeof obj.id === "string" && obj.absoluteBoundingBox) {
    const box = obj.absoluteBoundingBox as Record<string, number>;
    if (typeof box.x === "number" && typeof box.width === "number") {
      result.push({
        id: obj.id,
        name: typeof obj.name === "string" ? obj.name : "",
        type: typeof obj.type === "string" ? obj.type : "",
        bbox: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
        text:
          typeof obj.characters === "string"
            ? obj.characters.slice(0, 40)
            : undefined,
      });
    }
  }

  // 자식 순회
  if (Array.isArray(obj.children)) {
    for (const child of obj.children) {
      collectNodes(child, result);
    }
  }

  // nodes 객체 (최상위 응답 구조)
  if (obj.nodes && typeof obj.nodes === "object") {
    for (const v of Object.values(obj.nodes)) {
      if (v && typeof v === "object" && "document" in v) {
        collectNodes((v as Record<string, unknown>).document, result);
      }
    }
  }

  // document 객체
  if (obj.document) collectNodes(obj.document, result);

  return result;
}

/**
 * 프레임(최상위 노드)의 정보 추출
 */
function findFrame(data: unknown, targetNodeId: string): NodeMeta | null {
  const all = collectNodes(data);
  const normalized = targetNodeId.replace("-", ":");
  return all.find((n) => n.id === normalized) || all[0] || null;
}

/**
 * RGBA 플로트(0-1) → hex 변환 (미리 처리해서 AI 부담 줄이기)
 */
function rgbaToHex(c: {
  r: number;
  g: number;
  b: number;
  a?: number;
}): string {
  const toByte = (v: number) => {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return n.toString(16).padStart(2, "0").toUpperCase();
  };
  const hex = `#${toByte(c.r)}${toByte(c.g)}${toByte(c.b)}`;
  if (c.a !== undefined && c.a < 1) {
    return `${hex}${toByte(c.a)}`;
  }
  return hex;
}

/**
 * 피그마 fills/strokes 배열에서 solid color를 hex로 추출
 */
function extractSolidColor(
  items: Array<Record<string, unknown>> | undefined
): string | null {
  if (!items || items.length === 0) return null;
  const solid = items.find((i) => i.type === "SOLID" && i.visible !== false);
  if (!solid || !solid.color) return null;
  return rgbaToHex(solid.color as { r: number; g: number; b: number; a?: number });
}

/**
 * 핵심: Figma 노드 트리를 AI가 분류하기 쉬운 간결한 형태로 변환
 * - 색상 미리 hex로 변환
 * - 필요한 속성만 추출 (원본의 약 1/5 크기)
 * - AI가 classify + 이름 부여만 하면 됨
 */
interface SimplifiedNode {
  id: string;
  name: string;
  type: string;
  text?: string;
  bg?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
  paddingH?: number;
  paddingV?: number;
  gap?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  childCount?: number;
  opacity?: number;
}

function simplifyFigmaNode(
  node: Record<string, unknown>,
  depth = 0,
  maxDepth = 6
): SimplifiedNode | null {
  if (!node || typeof node !== "object") return null;
  if (node.visible === false) return null;

  const id = node.id as string;
  const name = node.name as string;
  const type = node.type as string;

  if (!id || !type) return null;

  // vector 노드는 스킵 (아이콘 디테일은 우리 수준에서 불필요)
  if (type === "VECTOR" || type === "BOOLEAN_OPERATION") {
    return null;
  }

  const result: SimplifiedNode = { id, name, type };

  // 텍스트
  if (node.characters && typeof node.characters === "string") {
    result.text = node.characters.slice(0, 40);
  }

  // 색상
  const bg = extractSolidColor(node.fills as Array<Record<string, unknown>>);
  if (bg) result.bg = bg;

  const borderColor = extractSolidColor(
    node.strokes as Array<Record<string, unknown>>
  );
  if (borderColor) {
    result.borderColor = borderColor;
    if (typeof node.strokeWeight === "number") {
      result.borderWidth = node.strokeWeight;
    }
  }

  // 크기 (bounding box에서)
  const bbox = node.absoluteBoundingBox as
    | { width?: number; height?: number }
    | undefined;
  if (bbox) {
    if (typeof bbox.width === "number")
      result.width = Math.round(bbox.width);
    if (typeof bbox.height === "number")
      result.height = Math.round(bbox.height);
  }

  // 패딩 (가로/세로로 묶음 — 좌우 같으면 하나로)
  const pl = node.paddingLeft as number | undefined;
  const pr = node.paddingRight as number | undefined;
  const pt = node.paddingTop as number | undefined;
  const pb = node.paddingBottom as number | undefined;
  if (pl !== undefined && pr !== undefined && pl === pr) {
    result.paddingH = pl;
  } else if (pl !== undefined || pr !== undefined) {
    result.paddingH = Math.max(pl || 0, pr || 0);
  }
  if (pt !== undefined && pb !== undefined && pt === pb) {
    result.paddingV = pt;
  } else if (pt !== undefined || pb !== undefined) {
    result.paddingV = Math.max(pt || 0, pb || 0);
  }

  // 레이아웃
  if (typeof node.itemSpacing === "number") {
    result.gap = node.itemSpacing;
  }
  if (typeof node.cornerRadius === "number") {
    result.radius = node.cornerRadius;
  }
  if (typeof node.opacity === "number" && node.opacity < 1) {
    result.opacity = node.opacity;
  }

  // 타이포그래피
  const style = node.style as
    | {
        fontSize?: number;
        fontWeight?: number;
        fontFamily?: string;
        lineHeightPx?: number;
      }
    | undefined;
  if (style) {
    if (typeof style.fontSize === "number") result.fontSize = style.fontSize;
    if (typeof style.fontWeight === "number")
      result.fontWeight = style.fontWeight;
    if (style.fontFamily) result.fontFamily = style.fontFamily;
    if (typeof style.lineHeightPx === "number") {
      result.lineHeight = Math.round(style.lineHeightPx);
    }

    // 텍스트 컬러는 fills에서 추출 (bg로 들어왔을 텐데, type이 TEXT면 재할당)
    if (type === "TEXT" && result.bg) {
      result.textColor = result.bg;
      delete result.bg;
    }
  }

  // 자식 개수 (재귀 대신 카운트만)
  const children = node.children as Array<Record<string, unknown>> | undefined;
  if (children) {
    result.childCount = children.length;
  }

  return result;
}

/**
 * 루트 노드부터 의미있는 하위 노드들을 평탄화해서 간결한 리스트 반환
 */
function flattenSimplifiedNodes(
  data: unknown,
  maxNodes = 80
): SimplifiedNode[] {
  const results: SimplifiedNode[] = [];
  const queue: Array<{ node: unknown; depth: number }> = [
    { node: data, depth: 0 },
  ];

  while (queue.length > 0 && results.length < maxNodes) {
    const { node, depth } = queue.shift()!;

    if (!node || typeof node !== "object") continue;

    const obj = node as Record<string, unknown>;

    // Figma API 응답 구조: data.nodes[id].document
    if (obj.nodes && typeof obj.nodes === "object") {
      for (const v of Object.values(obj.nodes)) {
        if (v && typeof v === "object" && "document" in v) {
          queue.push({
            node: (v as Record<string, unknown>).document,
            depth: depth + 1,
          });
        }
      }
      continue;
    }

    // document 래퍼
    if (obj.document) {
      queue.push({ node: obj.document, depth: depth + 1 });
      continue;
    }

    // 실제 노드
    if (obj.id && obj.type) {
      const simplified = simplifyFigmaNode(obj, depth);
      if (simplified) {
        results.push(simplified);
      }
      // 자식 노드들도 큐에 추가
      const children = obj.children as Array<unknown> | undefined;
      if (children && depth < 8) {
        for (const child of children) {
          queue.push({ node: child, depth: depth + 1 });
        }
      }
    }
  }

  return results;
}

/**
 * 노드의 이름/타입/속성을 보고 ElementType을 휴리스틱으로 분류.
 * AI 대신 결정적인 규칙으로 분류 → 동일 입력엔 항상 동일 결과.
 */
function classifyElement(n: SimplifiedNode): ElementType {
  const lname = (n.name || "").toLowerCase();
  const w = n.width;
  const h = n.height;

  // 1) 텍스트는 폰트 크기로 heading/text 판정
  if (n.type === "TEXT") {
    if (n.fontSize !== undefined && n.fontSize >= 20) return "heading";
    return "text";
  }

  // 2) divider: 매우 얇은 사각형
  if (h !== undefined && h < 4 && w !== undefined && w > 30) return "divider";
  if (w !== undefined && w < 4 && h !== undefined && h > 30) return "divider";

  // 3) icon: 작고(<=32) bg 또는 borderColor 있는 그래픽
  if (
    w !== undefined &&
    h !== undefined &&
    w <= 32 &&
    h <= 32 &&
    (n.bg || n.borderColor)
  ) {
    if (!/(button|btn|cta)/.test(lname)) return "icon";
  }

  // 4) input: 이름에 검색/필드 단어 + 가로 길고 height 30~60
  if (
    h !== undefined &&
    h >= 28 &&
    h <= 60 &&
    /(input|field|search|textarea|검색)/.test(lname)
  ) {
    return "input";
  }

  // 5) tag: pill 형태 (radius >= height/2-1) + 작은 사이즈
  if (
    n.bg &&
    n.radius !== undefined &&
    h !== undefined &&
    h <= 32 &&
    n.radius >= h / 2 - 1
  ) {
    return "tag";
  }

  // 6) button: bg가 있고, 이름이 버튼처럼 보이거나 (radius + padding) 조건
  const buttonNamePattern =
    /(button|btn|cta|구매|선물|평가|보기|로그인|회원|시청|감상|결제|확인|취소|보내기|등록|전송|수정|저장|닫기|제출)/;
  if (
    n.bg &&
    h !== undefined &&
    h >= 28 &&
    h <= 80 &&
    (buttonNamePattern.test(lname) ||
      (n.radius !== undefined &&
        n.radius > 0 &&
        (n.paddingH !== undefined || n.paddingV !== undefined)))
  ) {
    return "button";
  }

  // 7) image: 이름에 image/poster/thumbnail 등 또는 큰 사각형(bg는 있지만 자식이 없음)
  if (
    /(image|img|poster|thumbnail|thumb|cover|photo|배너|이미지|썸네일)/.test(
      lname
    )
  ) {
    return "image";
  }

  // 8) card: bg + radius + 자식이 있고 어느 정도 큰 사이즈
  if (
    n.bg &&
    n.radius !== undefined &&
    n.radius > 0 &&
    n.childCount !== undefined &&
    n.childCount > 0 &&
    ((w !== undefined && w > 100) || (h !== undefined && h > 100))
  ) {
    return "card";
  }

  // 9) container: 그 외의 FRAME/GROUP/COMPONENT/INSTANCE
  if (
    n.type === "FRAME" ||
    n.type === "GROUP" ||
    n.type === "COMPONENT" ||
    n.type === "COMPONENT_SET" ||
    n.type === "INSTANCE"
  ) {
    return "container";
  }

  return "unknown";
}

/**
 * 자동 생성된 generic 이름을 좀 정리해서 표시
 */
function cleanElementName(name: string, et: ElementType): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return labelForType(et);
  // "Frame 1234", "Group 12", "Rectangle 5" 같은 자동 이름은 타입 라벨로 대체
  if (/^(frame|group|rectangle|ellipse|line|vector)\s*\d+$/i.test(trimmed)) {
    return labelForType(et);
  }
  return trimmed;
}

function labelForType(et: ElementType): string {
  switch (et) {
    case "button":
      return "버튼";
    case "heading":
      return "헤딩";
    case "text":
      return "본문";
    case "card":
      return "카드";
    case "container":
      return "컨테이너";
    case "icon":
      return "아이콘";
    case "image":
      return "이미지";
    case "input":
      return "입력 필드";
    case "tag":
      return "태그";
    case "divider":
      return "구분선";
    default:
      return "요소";
  }
}

function pxValue(n: number | undefined): string | undefined {
  if (n === undefined || n === null) return undefined;
  return `${Math.round(n)}px`;
}

/**
 * SimplifiedNode + 분류 결과 → DesignToken 리스트
 * 각 elementType마다 비교에 의미 있는 속성만 추출.
 */
function simplifiedToTokens(
  n: SimplifiedNode,
  et: ElementType
): DesignToken[] {
  const tokens: DesignToken[] = [];
  const elementName = cleanElementName(n.name, et);

  const push = (
    property: string,
    value: string | undefined,
    category: DesignToken["category"]
  ) => {
    if (value === undefined || value === null || value === "") return;
    tokens.push({
      element: elementName,
      elementType: et,
      property,
      value,
      category,
      nodeId: n.id,
    });
  };

  switch (et) {
    case "button":
      push("background-color", n.bg, "color");
      push("text-color", n.textColor, "color");
      push("font-size", pxValue(n.fontSize), "typography");
      push(
        "font-weight",
        n.fontWeight !== undefined ? `${n.fontWeight}` : undefined,
        "typography"
      );
      push("padding-horizontal", pxValue(n.paddingH), "spacing");
      push("padding-vertical", pxValue(n.paddingV), "spacing");
      push("border-radius", pxValue(n.radius), "border");
      push("border-color", n.borderColor, "color");
      push("border-width", pxValue(n.borderWidth), "border");
      push("height", pxValue(n.height), "sizing");
      break;
    case "heading":
    case "text":
      push("color", n.textColor || n.bg, "color");
      push("font-size", pxValue(n.fontSize), "typography");
      push(
        "font-weight",
        n.fontWeight !== undefined ? `${n.fontWeight}` : undefined,
        "typography"
      );
      push("line-height", pxValue(n.lineHeight), "typography");
      push("font-family", n.fontFamily, "typography");
      break;
    case "card":
      push("background-color", n.bg, "color");
      push("border-radius", pxValue(n.radius), "border");
      push("border-color", n.borderColor, "color");
      push("border-width", pxValue(n.borderWidth), "border");
      push("padding-horizontal", pxValue(n.paddingH), "spacing");
      push("padding-vertical", pxValue(n.paddingV), "spacing");
      push("gap", pxValue(n.gap), "spacing");
      break;
    case "container":
      // 배경이 있을 때만 의미 있음 (없으면 단순 레이아웃 래퍼)
      if (n.bg) push("background-color", n.bg, "color");
      push("padding-horizontal", pxValue(n.paddingH), "spacing");
      push("padding-vertical", pxValue(n.paddingV), "spacing");
      push("gap", pxValue(n.gap), "spacing");
      break;
    case "icon":
      push("color", n.bg || n.textColor || n.borderColor, "color");
      push("width", pxValue(n.width), "sizing");
      push("height", pxValue(n.height), "sizing");
      break;
    case "image":
      push("width", pxValue(n.width), "sizing");
      push("height", pxValue(n.height), "sizing");
      push("border-radius", pxValue(n.radius), "border");
      break;
    case "input":
      push("background-color", n.bg, "color");
      push("border-color", n.borderColor, "color");
      push("border-width", pxValue(n.borderWidth), "border");
      push("border-radius", pxValue(n.radius), "border");
      push("padding-horizontal", pxValue(n.paddingH), "spacing");
      push("font-size", pxValue(n.fontSize), "typography");
      push("height", pxValue(n.height), "sizing");
      break;
    case "tag":
      push("background-color", n.bg, "color");
      push("text-color", n.textColor, "color");
      push("font-size", pxValue(n.fontSize), "typography");
      push("padding-horizontal", pxValue(n.paddingH), "spacing");
      push("padding-vertical", pxValue(n.paddingV), "spacing");
      push("border-radius", pxValue(n.radius), "border");
      break;
    case "divider":
      push("background-color", n.bg, "color");
      push("height", pxValue(n.height), "sizing");
      break;
    default:
      break;
  }

  return tokens;
}

/**
 * 우선순위: 사용자에게 더 의미 있는 요소를 위로
 */
const TYPE_PRIORITY: Record<ElementType, number> = {
  button: 100,
  heading: 90,
  card: 80,
  input: 70,
  tag: 60,
  image: 50,
  icon: 40,
  text: 30,
  container: 20,
  divider: 10,
  unknown: 0,
};

function nodeArea(n: SimplifiedNode): number {
  return (n.width || 0) * (n.height || 0);
}

/**
 * 코드로 직접 디자인 토큰 추출 (AI 호출 없음)
 * - simplifyFigmaNode가 이미 색상/패딩/타이포를 정규화해놓은 결과를 사용
 * - classifyElement로 요소 타입 분류
 * - simplifiedToTokens로 타입별 속성 매핑
 * - 우선순위 정렬 + max 60개 제한
 */
export async function extractDesignTokens(
  figmaJson: object
): Promise<DesignToken[]> {
  // 사전 파싱: 모든 색상/크기 변환, 필수 필드만 추출
  const simplified = flattenSimplifiedNodes(figmaJson, 200);

  // bbox 매핑 (시각적 뷰용 좌표 보강)
  const nodes = collectNodes(figmaJson);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 분류 + 토큰 추출
  type Scored = { token: DesignToken; score: number };
  const scored: Scored[] = [];

  for (const n of simplified) {
    const et = classifyElement(n);
    if (et === "unknown") continue;
    // 의미 없는 노드 빠르게 컷 (속성이 너무 적은 컨테이너)
    if (
      et === "container" &&
      !n.bg &&
      n.paddingH === undefined &&
      n.paddingV === undefined &&
      n.gap === undefined
    ) {
      continue;
    }

    const tokens = simplifiedToTokens(n, et);
    if (tokens.length === 0) continue;

    const baseScore = TYPE_PRIORITY[et] * 1000 + Math.min(nodeArea(n), 999_000);
    for (const t of tokens) {
      scored.push({ token: t, score: baseScore });
    }
  }

  // 점수 내림차순 정렬
  scored.sort((a, b) => b.score - a.score);

  // 최대 60개 토큰까지 (그룹핑 UI라 요소 단위 묶이니 충분)
  const MAX_TOKENS = 60;
  const selected = scored.slice(0, MAX_TOKENS).map((s) => s.token);

  // bbox 보강
  return selected.map((t) => {
    const node = t.nodeId ? nodeMap.get(t.nodeId) : undefined;
    return { ...t, bbox: node?.bbox };
  });
}

/**
 * 프레임 정보 (이미지 + 좌표계 원점) 반환
 */
export async function getFrameInfo(
  fileKey: string,
  nodeId: string,
  figmaJson: object
): Promise<FigmaFrameInfo | null> {
  const imageUrl = await fetchFigmaImage(fileKey, nodeId);
  const frame = findFrame(figmaJson, nodeId);

  if (!imageUrl || !frame) return null;

  return {
    imageUrl,
    frameWidth: frame.bbox.width,
    frameHeight: frame.bbox.height,
    frameX: frame.bbox.x,
    frameY: frame.bbox.y,
  };
}

/**
 * 너비를 보고 viewport 분류
 * Small: 모바일, Medium: 태블릿, Large: 데스크톱, XLarge: 와이드
 */
export function classifyViewport(width: number): ViewportCategory {
  if (width <= 767) return "small";
  if (width <= 999) return "medium";
  if (width <= 1279) return "large";
  return "xlarge";
}

/**
 * 시안 이름에서 viewport 너비 범위 추출.
 * 디자이너가 적는 다양한 표기를 인식.
 *   "1280 미만"       → { min: 0, max: 1279 }
 *   "1280 이상"       → { min: 1280, max: 9999 }
 *   "(~767)"          → { min: 0, max: 767 }
 *   "Small (~767)"    → { min: 0, max: 767 }
 *   "768~999"         → { min: 768, max: 999 }
 *   "Large (1000-1135)" → { min: 1000, max: 1135 }
 *   "600 미만"        → { min: 0, max: 599 }
 *   "360~599"         → { min: 360, max: 599 }
 */
export function parseViewportRange(
  name: string
): { min: number; max: number } | null {
  if (!name) return null;
  const s = name.trim();

  // "X 미만"
  let m = s.match(/(\d+)\s*미만/);
  if (m) return { min: 0, max: Math.max(0, parseInt(m[1]) - 1) };

  // "X 이상"
  m = s.match(/(\d+)\s*이상/);
  if (m) return { min: parseInt(m[1]), max: 9999 };

  // "(~Y)" 또는 "~Y"
  m = s.match(/[(~]\s*~?\s*(\d+)\s*\)?/);
  if (m && /~/.test(s)) {
    // 단순 ~Y 패턴
    const onlyTilde = s.match(/^[^\d]*~\s*(\d+)/);
    if (onlyTilde) return { min: 0, max: parseInt(onlyTilde[1]) };
  }

  // "X-Y" 또는 "X~Y" (X와 Y 모두 숫자)
  m = s.match(/(\d+)\s*[-~]\s*(\d+)/);
  if (m) {
    const min = parseInt(m[1]);
    const max = parseInt(m[2]);
    if (max >= min) return { min, max };
  }

  return null;
}

/**
 * viewport 분류 — 시안 이름에 범위가 적혀있으면 그걸 우선, 아니면 시안 폭으로.
 * "1280 미만" 시안이라면 max 값(1279)으로 분류해서 large로 인식.
 */
export function classifyViewportSmart(
  name: string,
  fallbackWidth: number
): ViewportCategory {
  const range = parseViewportRange(name);
  if (range) {
    // 분류 기준: max 값 (어디까지 적용되는 디자인인지)
    const w = range.max >= 9999 ? Math.max(range.min, 1280) : range.max;
    return classifyViewport(w);
  }
  return classifyViewport(fallbackWidth);
}

/**
 * 받은 노드(보통 페이지/CANVAS 또는 단일 FRAME)에서 비교 대상이 되는 최상위 프레임들을 추출.
 * - CANVAS면 children 중 FRAME/COMPONENT/COMPONENT_SET/INSTANCE 만
 * - FRAME 이상이면 그 자체를 단일 프레임으로 처리 (호환)
 */
interface FrameRaw {
  id: string;
  name: string;
  type: string;
  bbox: BoundingBox;
  raw: Record<string, unknown>;
  sectionName: string | null;
}

// 시안으로 인정할 너비 범위 (모바일 280px ~ 와이드 데스크톱 2560px)
// 이보다 크면 wrapper로 취급해서 children을 더 들여다봄
const VIEWPORT_MIN_WIDTH = 280;
const VIEWPORT_MAX_WIDTH = 2560;
const VIEWPORT_MIN_HEIGHT = 200;

function isFrameLike(type: string): boolean {
  return (
    type === "FRAME" ||
    type === "COMPONENT" ||
    type === "COMPONENT_SET" ||
    type === "INSTANCE"
    // SECTION은 의도적으로 제외 — drillDown에서 별도로 처리해 sectionName 추적
  );
}

function isViewportSized(box: { width: number; height: number }): boolean {
  return (
    box.width >= VIEWPORT_MIN_WIDTH &&
    box.width <= VIEWPORT_MAX_WIDTH &&
    box.height >= VIEWPORT_MIN_HEIGHT
  );
}

function discoverFrames(figmaJson: unknown): FrameRaw[] {
  // Figma API 응답: data.nodes[id].document = 실제 노드
  const candidates: Record<string, unknown>[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.nodes && typeof obj.nodes === "object") {
      for (const v of Object.values(obj.nodes)) {
        if (v && typeof v === "object" && "document" in v) {
          visit((v as Record<string, unknown>).document);
        }
      }
      return;
    }
    if (obj.document) {
      visit(obj.document);
      return;
    }
    if (obj.id && obj.type) {
      candidates.push(obj);
    }
  };

  visit(figmaJson);
  if (candidates.length === 0) return [];

  // 첫 번째 후보가 사용자가 입력한 노드(루트)
  const root = candidates[0];

  // 시안 + 그 시안이 속한 SECTION 이름을 함께 수집
  type Found = {
    node: Record<string, unknown>;
    sectionName: string | null;
  };
  const collected: Found[] = [];

  // 디자이너가 SECTION으로 케이스를 묶는 패턴을 인식해서 sectionName을 추적
  const drillDown = (
    node: Record<string, unknown>,
    depth: number,
    currentSection: string | null
  ) => {
    if (depth > 6) return; // 무한 재귀 방지
    const type = (node.type as string) || "";
    const box = node.absoluteBoundingBox as
      | { x: number; y: number; width: number; height: number }
      | undefined;

    // CANVAS — 페이지 자체. 시안 아님. children 진입.
    if (type === "CANVAS") {
      const children =
        (node.children as Array<Record<string, unknown>>) || [];
      for (const c of children) drillDown(c, depth + 1, currentSection);
      return;
    }

    // SECTION — 케이스 그룹. sectionName 갱신하고 children 진입.
    // 중첩 SECTION이면 가장 깊은 SECTION 이름 사용 (디자이너가 더 구체적으로 분류했다고 가정).
    if (type === "SECTION") {
      const sectionName = (node.name as string) || currentSection;
      const children =
        (node.children as Array<Record<string, unknown>>) || [];
      for (const c of children) drillDown(c, depth + 1, sectionName);
      return;
    }

    // GROUP — 단순 묶음. sectionName 그대로 유지하고 children 진입.
    if (type === "GROUP") {
      const children =
        (node.children as Array<Record<string, unknown>>) || [];
      for (const c of children) drillDown(c, depth + 1, currentSection);
      return;
    }

    // FRAME/COMPONENT 류 + 적절한 viewport 사이즈 → 시안으로 채택
    if (isFrameLike(type) && box && isViewportSized(box)) {
      collected.push({ node, sectionName: currentSection });
      return;
    }

    // FRAME이지만 viewport 범위 벗어남 (wrapper) → children 더 들여다봄
    if (isFrameLike(type)) {
      const children =
        (node.children as Array<Record<string, unknown>>) || [];
      for (const c of children) drillDown(c, depth + 1, currentSection);
    }
    // 그 외 타입(TEXT, RECTANGLE, VECTOR 등)은 시안 후보 아님
  };

  drillDown(root, 0, null);

  // fallback: drill-down으로 찾지 못했을 때만 root 단일 시안 채택.
  // 단, 너무 큰 wrapper(>VIEWPORT_MAX)는 시안 아님 (잘못된 결과 방지)
  if (collected.length === 0) {
    const box = root.absoluteBoundingBox as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    if (
      isFrameLike((root.type as string) || "") &&
      box &&
      box.width >= VIEWPORT_MIN_WIDTH &&
      box.width <= VIEWPORT_MAX_WIDTH &&
      box.height >= VIEWPORT_MIN_HEIGHT
    ) {
      collected.push({ node: root, sectionName: null });
    }
  }

  // 디버그 로깅
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[figma] root=${root.type}/${(root.id as string) || "?"}`,
      `width=${
        (root.absoluteBoundingBox as { width?: number } | undefined)?.width ??
        "?"
      }`,
      `→ ${collected.length} frame(s) found:`,
      collected.map((f) => {
        const b = f.node.absoluteBoundingBox as
          | { width: number; height: number }
          | undefined;
        return `[${f.sectionName ?? "no section"}] ${f.node.name}(${f.node.type}) ${
          b ? `${Math.round(b.width)}×${Math.round(b.height)}` : "?"
        }`;
      })
    );
  }

  // dedupe (같은 ID 중복 방지)
  const seen = new Set<string>();
  const dedup = collected.filter((f) => {
    const id = f.node.id as string;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return dedup.map((f) => {
    const box = f.node.absoluteBoundingBox as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return {
      id: f.node.id as string,
      name: (f.node.name as string) || "Frame",
      type: f.node.type as string,
      bbox: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      raw: f.node,
      sectionName: f.sectionName,
    };
  });
}

/**
 * 단일 프레임의 raw 노드 → 그 안의 토큰 추출 (extractDesignTokens의 단일 프레임 버전)
 */
function extractTokensFromFrameNode(
  frameNode: Record<string, unknown>
): DesignToken[] {
  // simplifyFigmaNode + 자식 BFS는 이미 flattenSimplifiedNodes가 처리.
  // 하지만 그 함수는 최상위 응답 구조를 다루므로, 여기선 단일 노드부터 BFS.
  const simplified: SimplifiedNode[] = [];
  const queue: Array<{ node: Record<string, unknown>; depth: number }> = [
    { node: frameNode, depth: 0 },
  ];

  const MAX_NODES = 200;
  while (queue.length > 0 && simplified.length < MAX_NODES) {
    const { node, depth } = queue.shift()!;
    const s = simplifyFigmaNode(node, depth);
    if (s) simplified.push(s);
    const children = node.children as Array<Record<string, unknown>> | undefined;
    if (children && depth < 8) {
      for (const c of children) {
        queue.push({ node: c, depth: depth + 1 });
      }
    }
  }

  type Scored = { token: DesignToken; score: number };
  const scored: Scored[] = [];
  for (const n of simplified) {
    const et = classifyElement(n);
    if (et === "unknown") continue;
    if (
      et === "container" &&
      !n.bg &&
      n.paddingH === undefined &&
      n.paddingV === undefined &&
      n.gap === undefined
    ) {
      continue;
    }
    const tokens = simplifiedToTokens(n, et);
    if (tokens.length === 0) continue;
    const baseScore =
      TYPE_PRIORITY[et] * 1000 + Math.min(nodeArea(n), 999_000);
    for (const t of tokens) scored.push({ token: t, score: baseScore });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 60).map((s) => s.token);
}

/**
 * 페이지 또는 단일 프레임 URL → FrameSet 배열
 * - CANVAS면 그 안의 모든 최상위 프레임을 viewport별로 묶어 반환
 * - 단일 프레임이면 1개짜리 배열 반환 (하위 호환)
 */
export async function extractFramesFromPage(
  fileKey: string,
  figmaJson: object
): Promise<FrameSet[]> {
  const frames = discoverFrames(figmaJson);
  if (frames.length === 0) return [];

  // bbox 매핑 (시각적 뷰용 좌표 보강)
  const allNodes = collectNodes(figmaJson);
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  // 시안마다 이미지 URL을 병렬 요청 (각 호출 15초 타임아웃)
  const imageUrls = await Promise.all(
    frames.map((f) =>
      fetchImageWithFallback(fileKey, f.id, {
        width: f.bbox.width,
        height: f.bbox.height,
      })
    )
  );

  const sets: FrameSet[] = frames.map((f, idx) => {
    const tokensRaw = extractTokensFromFrameNode(f.raw);
    // bbox 보강
    const tokens = tokensRaw.map((t) => {
      const node = t.nodeId ? nodeMap.get(t.nodeId) : undefined;
      return { ...t, bbox: node?.bbox };
    });

    const imageUrl = imageUrls[idx];
    const frame: FigmaFrameInfo | null = imageUrl
      ? {
          imageUrl,
          frameWidth: f.bbox.width,
          frameHeight: f.bbox.height,
          frameX: f.bbox.x,
          frameY: f.bbox.y,
        }
      : null;

    const range = parseViewportRange(f.name);
    return {
      frameId: f.id,
      name: f.name,
      width: Math.round(f.bbox.width),
      height: Math.round(f.bbox.height),
      viewport: classifyViewportSmart(f.name, f.bbox.width),
      sectionName: f.sectionName,
      viewportRange: range,
      tokens,
      frame,
    };
  });

  // 정렬: 같은 SECTION 안에서 너비 오름차순. SECTION 간에는 첫 등장 순서 유지.
  const sectionOrder = new Map<string, number>();
  let order = 0;
  for (const f of frames) {
    const key = f.sectionName ?? "__no_section__";
    if (!sectionOrder.has(key)) sectionOrder.set(key, order++);
  }
  sets.sort((a, b) => {
    const ka = a.sectionName ?? "__no_section__";
    const kb = b.sectionName ?? "__no_section__";
    const oa = sectionOrder.get(ka) ?? 0;
    const ob = sectionOrder.get(kb) ?? 0;
    if (oa !== ob) return oa - ob;
    return a.width - b.width;
  });

  return sets;
}

/**
 * 단일 시안 이미지 URL을 가져옴 (타임아웃 + scale 동적 + 1회 폴백 재시도).
 * - 면적 큰 시안(>4.5M 픽셀)은 scale=1로 시작 (PNG 메모리 폭증 방지)
 * - 첫 시도 실패/타임아웃 시 scale=1로 한 번 더 재시도
 */
async function fetchImageWithFallback(
  fileKey: string,
  nodeId: string,
  size: { width: number; height: number },
  timeoutMs = 15000
): Promise<string | null> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) return null;

  const debug = process.env.NODE_ENV !== "production";

  // 면적 기반 scale 선택
  const area = size.width * size.height;
  const LARGE_AREA = 4_500_000; // 약 1500*3000
  let scale = area > LARGE_AREA ? 1 : 2;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const requestUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(
        nodeId
      )}&format=png&scale=${scale}`;
      const res = await fetch(requestUrl, {
        headers: { "X-Figma-Token": token },
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        if (debug) {
          const text = await res.text().catch(() => "");
          console.warn(
            `[figma:image] ${nodeId} HTTP ${res.status} scale=${scale}`,
            text.slice(0, 150)
          );
        }
        scale = 1;
        continue;
      }
      const data = await res.json();
      const url = (data.images || {})[nodeId] as string | null | undefined;
      if (url) {
        if (debug) {
          console.log(`[figma:image] OK ${nodeId} scale=${scale}`);
        }
        return url;
      }
      if (debug) {
        console.warn(
          `[figma:image] ${nodeId} url=null scale=${scale} err=${data.err || "?"}`
        );
      }
      scale = 1;
    } catch (e) {
      clearTimeout(timer);
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (debug) {
        console.warn(
          `[figma:image] ${nodeId} ${isAbort ? "TIMEOUT" : "ERROR"} scale=${scale}: ${
            e instanceof Error ? e.message : e
          }`
        );
      }
      scale = 1;
    }
  }
  return null;
}

/**
 * 피그마 파일의 로컬 Styles 메타데이터 조회
 * /v1/files/:fileKey/styles 는 스타일 리스트만 주고, 실제 값은 별도로 노드를 가져와야 함
 */
interface FigmaStyleMeta {
  node_id: string;
  style_type: "FILL" | "TEXT" | "EFFECT" | "GRID";
  name: string;
  description?: string;
}

async function fetchFigmaStyles(
  fileKey: string
): Promise<FigmaStyleMeta[]> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) return [];

  try {
    const res = await fetch(
      `https://api.figma.com/v1/files/${fileKey}/styles`,
      { headers: { "X-Figma-Token": token } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.meta?.styles || []) as FigmaStyleMeta[];
  } catch {
    return [];
  }
}

/**
 * 여러 노드를 한 번에 가져옴 (배치)
 */
async function fetchFigmaNodesByIds(
  fileKey: string,
  nodeIds: string[]
): Promise<Record<string, unknown>> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token || nodeIds.length === 0) return {};

  // URL 길이 제한 대비: 50개씩 배치
  const chunks: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += 50) {
    chunks.push(nodeIds.slice(i, i + 50));
  }

  const results: Record<string, unknown> = {};
  for (const chunk of chunks) {
    try {
      const res = await fetch(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${chunk
          .map(encodeURIComponent)
          .join(",")}`,
        { headers: { "X-Figma-Token": token } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.nodes) {
        Object.assign(results, data.nodes);
      }
    } catch {
      // 개별 배치 실패는 무시
    }
  }
  return results;
}

/**
 * Figma Styles → DesignSystemToken 변환 (규칙 기반)
 */
function stylesToCatalog(
  styles: FigmaStyleMeta[],
  nodes: Record<string, unknown>
): DesignSystemToken[] {
  const catalog: DesignSystemToken[] = [];

  for (const style of styles) {
    const nodeWrapper = nodes[style.node_id] as
      | { document?: Record<string, unknown> }
      | undefined;
    const doc = nodeWrapper?.document;
    if (!doc) continue;

    if (style.style_type === "FILL") {
      // fills 배열에서 첫 번째 solid color 추출
      const fills = (doc.fills as Array<Record<string, unknown>>) || [];
      const solidFill = fills.find((f) => f.type === "SOLID");
      if (solidFill) {
        const c = solidFill.color as { r: number; g: number; b: number };
        if (c) {
          const hex = rgbToHex(c.r, c.g, c.b);
          catalog.push({
            name: style.name,
            value: hex,
            type: "color",
            description: style.description,
          });
        }
      }
    } else if (style.style_type === "TEXT") {
      const s = doc.style as
        | {
            fontFamily?: string;
            fontSize?: number;
            fontWeight?: number;
            lineHeightPx?: number;
            letterSpacing?: number;
          }
        | undefined;
      if (s) {
        const parts: string[] = [];
        if (s.fontFamily) parts.push(s.fontFamily);
        if (s.fontWeight) parts.push(`${s.fontWeight}`);
        if (s.fontSize) parts.push(`${s.fontSize}px`);
        if (s.lineHeightPx) parts.push(`lh:${Math.round(s.lineHeightPx)}px`);
        catalog.push({
          name: style.name,
          value: parts.join(" "),
          type: "typography",
          description: style.description,
        });
      }
    }
    // EFFECT, GRID는 일단 스킵 (필요 시 추가)
  }

  return catalog;
}

function rgbToHex(r: number, g: number, b: number): string {
  const toByte = (v: number) => {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return n.toString(16).padStart(2, "0").toUpperCase();
  };
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

/**
 * 파일 전체의 디자인 시스템 카탈로그 구축
 * - Foundation 파일 URL을 주면 그 파일의 스타일을 추출
 */
export async function fetchDesignSystemCatalog(
  fileKey: string
): Promise<DesignSystemToken[]> {
  const styles = await fetchFigmaStyles(fileKey);
  if (styles.length === 0) return [];

  // 노드 값 조회
  const nodeIds = styles.map((s) => s.node_id);
  const nodes = await fetchFigmaNodesByIds(fileKey, nodeIds);

  return stylesToCatalog(styles, nodes);
}
