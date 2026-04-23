import { analyzeWithAI, parseJsonFromResponse } from "./claude";
import { DesignToken } from "./types";

export async function fetchPageHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
  }

  return res.text();
}

/**
 * HTML 크기를 줄이기 위해 스크립트/주석 제거하고 핵심만 추출
 */
function compactHtml(html: string): string {
  return html
    // <script> 전체 제거
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // <!-- 주석 --> 제거
    .replace(/<!--[\s\S]*?-->/g, "")
    // SVG 내부의 path 데이터 축약
    .replace(/\sd="[^"]{200,}"/g, ' d="..."')
    // 연속된 공백 축소
    .replace(/\s+/g, " ")
    .trim();
}

const WEB_SYSTEM_PROMPT = `You are a design token extractor for web pages. Given HTML/CSS, extract ONLY the most important UNIQUE design properties.

Rules:
- Extract at most 40 tokens total (focus on the most visible, meaningful elements)
- Look at inline styles, <style> blocks, class-based styles
- Extract: colors (background, text, border), font sizes, font weights, padding, margin, border radius
- Convert all colors to hex format (e.g., rgb(255,0,0) → #FF0000)
- Deduplicate: if many elements share the same color/size, include it only once with a general element name
- Prefer semantic elements (header, nav, main, button, card) over generic divs
- Skip: pure layout values, debug styles, print styles

Return ONLY a valid JSON array (no markdown, no prose):
[{"element":"...","property":"...","value":"...","category":"color|typography|spacing|sizing|border"}]

BE CONCISE. Quality over quantity.`;

export async function extractWebTokens(
  htmlContent: string
): Promise<DesignToken[]> {
  const compact = compactHtml(htmlContent);
  const truncated = compact.length > 30000 ? compact.slice(0, 30000) : compact;
  const response = await analyzeWithAI(WEB_SYSTEM_PROMPT, truncated);
  return parseJsonFromResponse<DesignToken[]>(response);
}
