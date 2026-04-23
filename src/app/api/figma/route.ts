import { NextRequest, NextResponse } from "next/server";
import {
  parseFigmaUrl,
  fetchFigmaNode,
  extractDesignTokens,
  getFrameInfo,
} from "@/lib/figma";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { figmaUrl } = await request.json();

    if (!figmaUrl) {
      return NextResponse.json(
        { error: "figmaUrl is required" },
        { status: 400 }
      );
    }

    const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
    const figmaData = await fetchFigmaNode(fileKey, nodeId);

    // 토큰과 프레임 정보 병렬 추출
    const [tokens, frame] = await Promise.all([
      extractDesignTokens(figmaData),
      getFrameInfo(fileKey, nodeId, figmaData),
    ]);

    return NextResponse.json({
      tokens,
      frame,
      nodeCount: tokens.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
