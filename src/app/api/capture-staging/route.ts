import { NextRequest, NextResponse } from "next/server";
import {
  captureStagingMultiViewport,
  type CaptureViewport,
} from "@/lib/staging-capture";
import { hashString, withCache } from "@/lib/cache";

export const maxDuration = 300;
// 헤드리스 크롬을 띄우려면 Node.js 런타임 필수 (Edge 런타임 X)
export const runtime = "nodejs";

interface CapturePayload {
  url: string;
  viewports?: CaptureViewport[];
}

/**
 * 기본 viewport 세트 — 디자이너가 흔히 쓰는 4단계.
 * height는 첫 페이지 폴드 정도. fullPage 캡처라 실제로는 스크롤 다 잡음.
 */
const DEFAULT_VIEWPORTS: CaptureViewport[] = [
  { width: 375, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
];

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CapturePayload;
    const { url } = body;
    const viewports = body.viewports?.length ? body.viewports : DEFAULT_VIEWPORTS;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "url is required" },
        { status: 400 }
      );
    }

    // 캐시 키: URL + viewport 조합
    const cacheKey = `staging-capture:${hashString(
      url + "|" + JSON.stringify(viewports)
    )}`;

    const { value, cached } = await withCache(cacheKey, async () => {
      const results = await captureStagingMultiViewport(url, viewports);
      // viewport와 결과를 함께 묶음
      return viewports.map((vp, i) => ({
        viewport: vp,
        capture: results[i],
      }));
    });

    return NextResponse.json({
      url,
      results: value,
      cached,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
