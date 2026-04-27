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
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sd="[^"]{200,}"/g, ' d="..."')
    .replace(/\s+/g, " ")
    .trim();
}

const WEB_SYSTEM_PROMPT = `Extract design tokens from web HTML/CSS. Output ONLY a JSON array. Same schema as Figma extraction.

Token format: {"element":"...","elementType":"...","property":"...","value":"...","category":"..."}

elementType: button, heading, text, card, container, icon, image, input, tag, divider

Per elementType, extract these properties:
- button: background-color, text-color, font-size, font-weight, padding-horizontal, padding-vertical, border-radius, height
- heading: color, font-size, font-weight, line-height
- text: color, font-size, font-weight
- card: background-color, border-radius, padding, gap
- container: background-color, padding, gap
- icon: color, width, height
- image: width, height, border-radius
- input: background-color, text-color, border-color, border-radius, padding-horizontal, font-size
- tag: background-color, text-color, font-size, padding-horizontal, border-radius
- divider: background-color, height

category: color | typography | spacing | sizing | border

Rules:
- Convert all colors to HEX (rgb/rgba/hsl/named → #RRGGBB)
- All measurements in px (rem → ×16)
- Prefer semantic tags (<header>, <button>, <h1>) over generic div
- DEDUPLICATE: same values across elements → include once
- Descriptive names: "Primary CTA", "Movie Card" — not raw class names
- Skip if value can't be determined from HTML/<style>
- Max 40 tokens total`;

export async function extractWebTokens(
  htmlContent: string
): Promise<DesignToken[]> {
  const compact = compactHtml(htmlContent);
  // Groq Free Tier TPM 대비 12K자 (≈3K 토큰)
  const truncated = compact.length > 12000 ? compact.slice(0, 12000) : compact;
  const response = await analyzeWithAI(WEB_SYSTEM_PROMPT, truncated);
  return parseJsonFromResponse<DesignToken[]>(response);
}
