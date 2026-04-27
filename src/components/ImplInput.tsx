"use client";

import { useState } from "react";
import { DesignToken, StagingCaptureItem } from "@/lib/types";
import { postJson } from "@/lib/fetcher";
import {
  useExtensionInfo,
  captureViaExtension,
} from "@/lib/staging-client";
import TokenPreview from "./TokenPreview";

const DEFAULT_VIEWPORTS = [
  { width: 375, height: 800 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
];

export default function ImplInput({
  onTokensExtracted,
  onCapturesReady,
}: {
  onTokensExtracted: (tokens: DesignToken[]) => void;
  onCapturesReady?: (captures: StagingCaptureItem[]) => void;
}) {
  const { info: extensionInfo, retry: retryExtension } = useExtensionInfo();
  const [webUrl, setWebUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [cachedHit, setCachedHit] = useState(false);
  const [tokens, setTokens] = useState<DesignToken[]>([]);
  const [capturesCount, setCapturesCount] = useState(0);
  const [capturesLoading, setCapturesLoading] = useState(false);
  const [captureSource, setCaptureSource] = useState<
    "extension" | "server" | null
  >(null);
  const [error, setError] = useState("");

  const handleAnalyze = async () => {
    if (!webUrl.trim()) return;

    setLoading(true);
    setCapturesLoading(true);
    setError("");
    setElapsed(0);
    setCachedHit(false);
    setCapturesCount(0);

    const startTime = Date.now();
    const elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 500);

    setLoadingStep("웹 페이지 HTML을 가져오는 중...");
    setTimeout(() => setLoadingStep("AI가 CSS 속성을 분석 중..."), 1500);

    // 토큰 추출과 viewport별 스크린샷 캡처를 병렬 실행
    const tokenPromise = postJson<{
      tokens: DesignToken[];
      cached?: boolean;
    }>("/api/extract-web", { url: webUrl });

    // 캡처: 확장이 설치돼 있으면 확장 사용 (본인 세션) → 안 되면 서버 헤드리스 fallback
    const capturePromise: Promise<{
      results: StagingCaptureItem[];
      source: "extension" | "server";
    }> = (async () => {
      if (extensionInfo) {
        try {
          const results = await captureViaExtension(
            extensionInfo.id,
            webUrl,
            DEFAULT_VIEWPORTS
          );
          return { results, source: "extension" as const };
        } catch (e) {
          console.warn(
            "확장 캡처 실패, 서버 fallback 시도:",
            e instanceof Error ? e.message : e
          );
        }
      }
      // 폴백: 서버 헤드리스 크롬
      try {
        const data = await postJson<{
          results: StagingCaptureItem[];
          cached?: boolean;
        }>("/api/capture-staging", { url: webUrl });
        return { results: data.results, source: "server" as const };
      } catch (e) {
        console.warn(
          "서버 캡처도 실패:",
          e instanceof Error ? e.message : e
        );
        return { results: [], source: "server" as const };
      }
    })();

    try {
      const data = await tokenPromise;
      setTokens(data.tokens);
      setCachedHit(data.cached || false);
      onTokensExtracted(data.tokens);

      // 토큰 끝나면 분석 완료 표시. 캡처는 백그라운드에서 계속.
      setLoading(false);
      clearInterval(elapsedTimer);
      setLoadingStep("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석에 실패했습니다");
      setLoading(false);
      clearInterval(elapsedTimer);
      setLoadingStep("");
    }

    // 캡처는 별도로 처리 (시간 더 걸릴 수 있음)
    try {
      const captureData = await capturePromise;
      const valid = captureData.results.filter((r) => r.capture !== null);
      setCapturesCount(valid.length);
      setCaptureSource(captureData.source);
      if (onCapturesReady) onCapturesReady(captureData.results);
    } catch {
      // ignore
    } finally {
      setCapturesLoading(false);
    }
  };

  const isDisabled = loading || !webUrl.trim();

  return (
    <section className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/[0.06] h-full flex flex-col">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[#FF0558]/10 border border-[#FF0558]/20 flex items-center justify-center">
          <span className="text-[#FF0558] font-black text-sm">2</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-white tracking-tight">
              구현물
            </h3>
            {extensionInfo ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[#22C55E]/15 text-[#22C55E]"
                title={`DDhelper Capture v${extensionInfo.version} 연결됨`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                확장 연결됨
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/[0.06] text-neutral-500"
                title="DDhelper Capture 확장이 설치되어 있지 않음. 서버 캡처로 fallback (로그인 필요한 페이지는 못 잡음)"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
                확장 미설치
              </span>
            )}
          </div>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            스테이징에 배포된 웹 페이지 URL을 입력해주세요.
          </p>
        </div>
      </div>

      {/* 확장 연결 상태 안내 박스 */}
      {extensionInfo ? (
        <div className="mb-3 rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/30 px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#22C55E]/20 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#22C55E]">
              DDhelper Capture 확장 연결됨 (v{extensionInfo.version})
            </p>
            <p className="text-[12px] text-neutral-400 mt-0.5">
              본인 크롬 세션으로 캡처합니다. 로그인이 필요한 페이지도 정상 캡처됩니다.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/30 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-[#FFB800]/20 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 text-[#FFB800]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#FFB800]">
                DDhelper Capture 확장이 연결되지 않았습니다
              </p>
              <p className="text-[12px] text-neutral-400 mt-1 leading-relaxed">
                지금 그대로 분석하면 서버 헤드리스 크롬으로 캡처되며, <span className="text-[#FFB800] font-bold">로그인이 필요한 페이지는 잡히지 않습니다</span>.
                본인 세션으로 캡처하려면 확장을 연결해주세요.
              </p>
              <ol className="mt-2 space-y-1 text-[12px] text-neutral-300">
                <li><span className="font-mono text-white bg-white/10 px-1.5 py-0.5 rounded text-[11px]">chrome://extensions</span> 주소창에 입력</li>
                <li><span className="text-white font-bold">DDhelper Capture</span> 카드의 새로고침(↻) 버튼 클릭</li>
                <li>자동으로 감지됩니다 (이 페이지 새로고침 안 해도 됨)</li>
              </ol>
              <button
                type="button"
                onClick={retryExtension}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-[#FFB800] hover:text-white transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                지금 다시 확인
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        <input
          type="text"
          value={webUrl}
          onChange={(e) => setWebUrl(e.target.value)}
          placeholder="https://staging.watcha.com/..."
          className="w-full pl-11 pr-4 py-3.5 bg-[#1C1C1C] border border-white/[0.06] rounded-2xl text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FF0558]/50 focus:ring-2 focus:ring-[#FF0558]/10 transition-all"
          onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
        />
      </div>

      <button
        onClick={handleAnalyze}
        disabled={isDisabled}
        className="mt-4 px-6 py-3 bg-white text-black rounded text-[13px] font-bold hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        {loading ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            분석 중
          </>
        ) : (
          "분석하기"
        )}
      </button>

      {loading && loadingStep && (
        <div className="mt-4 rounded-2xl bg-[#FF0558]/5 border border-[#FF0558]/20 px-4 py-3 flex items-center gap-3">
          <span className="inline-block w-4 h-4 border-2 border-[#FF0558]/30 border-t-[#FF0558] rounded-full animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white">{loadingStep}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{elapsed}초 경과</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 px-4 py-3">
          <p className="text-sm text-[#EF4444]">{error}</p>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="mt-4 flex items-center gap-3 text-sm flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-[#22C55E]/15 flex items-center justify-center">
              <svg
                className="w-3 h-3 text-[#22C55E]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <span className="text-[#22C55E] font-bold">
              구현 토큰 {tokens.length}개
            </span>
            {cachedHit && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#22C55E]/15 text-[#22C55E] font-bold">
                ⚡ 캐시
              </span>
            )}
          </div>

          {/* 캡처 상태 */}
          {capturesLoading ? (
            <div className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-[#FF0558]/30 border-t-[#FF0558] rounded-full animate-spin" />
              <span className="text-[12px] text-neutral-400">
                viewport별 스크린샷 캡처 중...
              </span>
            </div>
          ) : capturesCount > 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-[#FF0558]/15 flex items-center justify-center">
                <svg
                  className="w-3 h-3 text-[#FF0558]"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <span className="text-[#FF0558] font-bold">
                viewport 캡처 {capturesCount}개
              </span>
              {captureSource && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                    captureSource === "extension"
                      ? "bg-[#22C55E]/15 text-[#22C55E]"
                      : "bg-white/[0.06] text-neutral-400"
                  }`}
                  title={
                    captureSource === "extension"
                      ? "본인 브라우저 세션으로 캡처 (로그인 상태 유지됨)"
                      : "서버 헤드리스 크롬으로 캡처 (로그인 안 됨)"
                  }
                >
                  {captureSource === "extension" ? "확장" : "서버"}
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      <TokenPreview tokens={tokens} label="추출된 구현 토큰 보기" />
    </section>
  );
}
