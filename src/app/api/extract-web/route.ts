import { NextRequest, NextResponse } from "next/server";
import { fetchPageHtml, extractWebTokens } from "@/lib/web-extractor";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { url, htmlContent } = await request.json();

    let html: string;
    if (htmlContent) {
      html = htmlContent;
    } else if (url) {
      html = await fetchPageHtml(url);
    } else {
      return NextResponse.json(
        { error: "url or htmlContent is required" },
        { status: 400 }
      );
    }

    const tokens = await extractWebTokens(html);
    return NextResponse.json({ tokens, tokenCount: tokens.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
