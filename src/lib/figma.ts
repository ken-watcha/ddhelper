import { analyzeWithAI, parseJsonFromResponse } from "./claude";
import { DesignToken, BoundingBox, FigmaFrameInfo } from "./types";

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

export async function fetchFigmaNode(
  fileKey: string,
  nodeId: string
): Promise<object> {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) throw new Error("FIGMA_ACCESS_TOKEN is not set");

  const res = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
    { headers: { "X-Figma-Token": token } }
  );

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

function trimFigmaJson(data: unknown): unknown {
  const EXCLUDE_KEYS = new Set([
    "fillGeometry",
    "strokeGeometry",
    "vectorPaths",
    "vectorNetwork",
    "prototypeStartNodeID",
    "exportSettings",
    "constraints",
    "transitionNodeID",
    "interactions",
    "reactions",
    "componentPropertyDefinitions",
    "styleOverrideTable",
    "componentSetId",
    "arcData",
    "flowStartingPoints",
    "relativeTransform",
    "size",
    "characterStyleOverrides",
    "effects",
    "blendMode",
    "scrollBehavior",
    "strokeAlign",
    "strokeCap",
    "strokeJoin",
    "strokeMiterLimit",
  ]);

  if (Array.isArray(data)) {
    return data.map(trimFigmaJson);
  }
  if (data && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (EXCLUDE_KEYS.has(key)) continue;
      result[key] = trimFigmaJson(value);
    }
    return result;
  }
  return data;
}

const FIGMA_SYSTEM_PROMPT = `You extract design tokens from Figma JSON. Each meaningful node in the JSON has an "id" field (like "2805:16031") and properties.

Rules:
- Return at most 40 tokens. Focus on visible, meaningful elements: buttons, text, icons, cards, headers.
- For each extracted token, INCLUDE the Figma node "id" so we can locate it on screen.
- Convert RGBA floats (0-1) to hex colors (e.g., {r:1,g:0,b:0,a:1} → #FF0000)
- Convert measurements to px
- Deduplicate: same color on many nodes → include once referencing one representative nodeId
- Extract: colors (fill/stroke/text), fontSize, fontWeight, padding, gap, width, height, cornerRadius

Return ONLY a valid JSON array (no markdown):
[{"element":"...","property":"...","value":"...","category":"color|typography|spacing|sizing|border","nodeId":"1:2"}]

BE CONCISE. Quality over quantity.`;

export async function extractDesignTokens(
  figmaJson: object
): Promise<DesignToken[]> {
  const trimmed = trimFigmaJson(figmaJson);
  const jsonStr = JSON.stringify(trimmed);
  const truncated = jsonStr.length > 40000 ? jsonStr.slice(0, 40000) : jsonStr;

  const response = await analyzeWithAI(FIGMA_SYSTEM_PROMPT, truncated);
  const rawTokens = parseJsonFromResponse<DesignToken[]>(response);

  // 노드 메타 정보로 bbox 보강
  const nodes = collectNodes(figmaJson);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return rawTokens.map((t) => {
    const node = t.nodeId ? nodeMap.get(t.nodeId) : undefined;
    return {
      ...t,
      bbox: node?.bbox,
    };
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
