import { NextRequest, NextResponse } from "next/server";
import {
  parseFigmaUrl,
  fetchFigmaNode,
  extractFramesFromPage,
  fetchDesignSystemCatalog,
} from "@/lib/figma";
import { DesignSystemToken } from "@/lib/types";
import { hashString, withCache } from "@/lib/cache";

type DesignSystemTokenLike = DesignSystemToken;

// Vercel 2026 기본 허용치. 큰 페이지(시안 N개)도 여유 있게 처리.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { figmaUrl, foundationUrl } = await request.json();

    if (!figmaUrl) {
      return NextResponse.json(
        { error: "figmaUrl is required" },
        { status: 400 }
      );
    }

    const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

    // 캐시 키: 피그마 URL + Foundation URL 조합
    const cacheKey = `figma:${hashString(
      figmaUrl + "|" + (foundationUrl || "")
    )}`;

    const { value, cached } = await withCache(cacheKey, async () => {
      const figmaData = await fetchFigmaNode(fileKey, nodeId);

      // 카탈로그는 명시적으로 foundationUrl 입력 시에만 fetch.
      // 큰 파일에서 모든 styles를 자동으로 가져오면 timeout 폭증.
      let catalogPromise: Promise<DesignSystemTokenLike[]> = Promise.resolve(
        []
      );
      if (foundationUrl) {
        try {
          const parsed = parseFigmaUrl(foundationUrl);
          catalogPromise = fetchDesignSystemCatalog(parsed.fileKey);
        } catch {
          // foundationUrl 파싱 실패 시 카탈로그 없이 진행
        }
      }

      const [frames, catalog] = await Promise.all([
        extractFramesFromPage(fileKey, figmaData),
        catalogPromise,
      ]);

      return { frames, catalog };
    });

    if (!value.frames || value.frames.length === 0) {
      return NextResponse.json(
        {
          error:
            "프레임을 찾지 못했습니다. 페이지 또는 프레임이 선택된 URL인지 확인해주세요.",
        },
        { status: 400 }
      );
    }

    // 하위 호환: 기존 클라이언트가 tokens/frame 으로 단일 프레임을 기대하던 것을
    // 첫 프레임으로 채워서 호환 유지
    const first = value.frames[0];

    return NextResponse.json({
      frames: value.frames,
      catalog: value.catalog,
      // 하위 호환
      tokens: first.tokens,
      frame: first.frame,
      nodeCount: first.tokens.length,
      catalogCount: value.catalog.length,
      cached,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
