import { NextRequest, NextResponse } from "next/server";
import { extractCodeTokens } from "@/lib/code-extractor";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { code, platform } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: "code is required" },
        { status: 400 }
      );
    }

    if (!platform || !["ios", "android"].includes(platform)) {
      return NextResponse.json(
        { error: 'platform must be "ios" or "android"' },
        { status: 400 }
      );
    }

    const tokens = await extractCodeTokens(code, platform);
    return NextResponse.json({ tokens, tokenCount: tokens.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
