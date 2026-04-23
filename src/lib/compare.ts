import { analyzeWithAI, parseJsonFromResponse } from "./claude";
import { DesignToken, ComparisonResult } from "./types";

const COMPARE_SYSTEM_PROMPT = `You are a design QA engine. Compare Figma design tokens against implementation tokens.

Rules:
- Match by semantic meaning, not exact string (e.g., "Primary Button bg" ↔ "Button background-color")
- Account for format: #FF0000 = rgb(255,0,0) = Color.red
- Severity:
  * colors differ → "critical"
  * font size diff > 2px → "critical", 1-2px → "warning"
  * spacing diff > 4px → "critical", 1-4px → "warning"
  * border radius diff > 2px → "critical", 1-2px → "warning"
- Status: "match" | "mismatch" | "missing_in_impl" | "extra_in_impl"
- IMPORTANT: preserve the Figma token's "nodeId" in each result (copy it from the design token)

Return ONLY a valid JSON array (no markdown):
[{"element":"...","property":"...","designValue":"...","implValue":"...","status":"...","severity":"critical|warning|info","notes":"...","nodeId":"1:2"}]

Sort: critical first, then warning, then missing, then match.`;

export async function compareTokens(
  designTokens: DesignToken[],
  implTokens: DesignToken[]
): Promise<ComparisonResult[]> {
  const userContent = `## Design Tokens (Figma)
${JSON.stringify(designTokens, null, 2)}

## Implementation Tokens
${JSON.stringify(implTokens, null, 2)}`;

  const response = await analyzeWithAI(COMPARE_SYSTEM_PROMPT, userContent);
  const rawResults = parseJsonFromResponse<ComparisonResult[]>(response);

  // bbox 복원: AI 응답에 nodeId만 있으면 디자인 토큰에서 bbox를 찾아 붙임
  const nodeMap = new Map<string, { bbox?: DesignToken["bbox"] }>();
  for (const t of designTokens) {
    if (t.nodeId && t.bbox) {
      nodeMap.set(t.nodeId, { bbox: t.bbox });
    }
  }

  return rawResults.map((r) => {
    if (r.nodeId && !r.bbox) {
      const meta = nodeMap.get(r.nodeId);
      if (meta?.bbox) return { ...r, bbox: meta.bbox };
    }
    return r;
  });
}
