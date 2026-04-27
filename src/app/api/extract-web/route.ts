import { NextRequest, NextResponse } from "next/server";
import { fetchPageHtml, extractWebTokens } from "@/lib/web-extractor";
import { hashString, withCache } from "@/lib/cache";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { url, htmlContent } = await request.json();

    if (!url && !htmlContent) {
      return NextResponse.json(
        { error: "url or htmlContent is required" },
        { status: 400 }
      );
    }

    const cacheKey = `web:${hashString(url || htmlContent)}`;

    const { value, cached } = await withCache(cacheKey, async () => {
      let html: string;
      if (htmlContent) {
        html = htmlContent;
      } else {
        html = await fetchPageHtml(url);
      }
      const tokens = await extractWebTokens(html);
      return { tokens };
    });

    return NextResponse.json({
      ...value,
      tokenCount: value.tokens.length,
      cached,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
