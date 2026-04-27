"use client";

import { useState } from "react";
import {
  DesignToken,
  FigmaFrameInfo,
  DesignSystemToken,
  FrameSet,
  ViewportCategory,
  VIEWPORT_LABELS,
} from "@/lib/types";
import { postJson } from "@/lib/fetcher";
import TokenPreview from "./TokenPreview";

interface ActiveFrameMeta {
  frameId: string;
  name: string;
  width: number;
  height: number;
  viewport: ViewportCategory;
  sectionName: string | null;
  viewportRange: { min: number; max: number } | null;
}

export default function FigmaInput({
  onTokensExtracted,
}: {
  onTokensExtracted: (
    tokens: DesignToken[],
    frame: FigmaFrameInfo | null,
    catalog: DesignSystemToken[],
    activeFrame: ActiveFrameMeta | null
  ) => void;
}) {
  const [url, setUrl] = useState("");
  const [foundationUrl, setFoundationUrl] = useState("");
  const [showFoundation, setShowFoundation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [cachedHit, setCachedHit] = useState(false);
  const [frames, setFrames] = useState<FrameSet[]>([]);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<DesignSystemToken[]>([]);
  const [error, setError] = useState("");

  const activeFrame = frames.find((f) => f.frameId === activeFrameId) || null;

  const setActive = (f: FrameSet) => {
    setActiveFrameId(f.frameId);
    onTokensExtracted(f.tokens, f.frame, catalog, {
      frameId: f.frameId,
      name: f.name,
      width: f.width,
      height: f.height,
      viewport: f.viewport,
      sectionName: f.sectionName,
      viewportRange: f.viewportRange,
    });
  };

  const handleLoad = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setElapsed(0);
    setCachedHit(false);
    setLoadingStep("피그마 API로 노드 구조를 가져오는 중...");

    const startTime = Date.now();
    const elapsedTimer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 500);
    const stepTimer = setTimeout(() => {
      setLoadingStep("프레임별 디자인 토큰 추출 중...");
    }, 1500);
    const stepTimer2 = setTimeout(() => {
      setLoadingStep("디자인 시스템 카탈로그 구축 중...");
    }, 5000);

    try {
      const data = await postJson<{
        frames: FrameSet[];
        catalog: DesignSystemToken[];
        cached?: boolean;
      }>("/api/figma", {
        figmaUrl: url,
        foundationUrl: foundationUrl.trim() || undefined,
      });

      const list = data.frames || [];
      setFrames(list);
      setCatalog(data.catalog || []);
      setCachedHit(data.cached || false);

      // 첫 프레임 자동 활성화
      if (list.length > 0) {
        const first = list[0];
        setActiveFrameId(first.frameId);
        onTokensExtracted(first.tokens, first.frame, data.catalog || [], {
          frameId: first.frameId,
          name: first.name,
          width: first.width,
          height: first.height,
          viewport: first.viewport,
          sectionName: first.sectionName,
          viewportRange: first.viewportRange,
        });
      } else {
        setActiveFrameId(null);
        onTokensExtracted([], null, data.catalog || [], null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "피그마를 불러오지 못했습니다");
    } finally {
      clearInterval(elapsedTimer);
      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);
      setLoading(false);
      setLoadingStep("");
    }
  };

  // SECTION별로 묶은 다음, 각 SECTION 안에서 viewport별로 정렬
  const viewportOrder: ViewportCategory[] = [
    "small",
    "medium",
    "large",
    "xlarge",
  ];

  interface SectionGroup {
    sectionName: string | null;
    items: FrameSet[];
  }
  const sectionGroups: SectionGroup[] = [];
  const sectionMap = new Map<string, SectionGroup>();
  for (const f of frames) {
    const key = f.sectionName ?? "__no_section__";
    let group = sectionMap.get(key);
    if (!group) {
      group = { sectionName: f.sectionName, items: [] };
      sectionMap.set(key, group);
      sectionGroups.push(group);
    }
    group.items.push(f);
  }
  // 각 그룹 안에서 viewport 순서대로 정렬
  for (const g of sectionGroups) {
    g.items.sort((a, b) => {
      const oa = viewportOrder.indexOf(a.viewport);
      const ob = viewportOrder.indexOf(b.viewport);
      if (oa !== ob) return oa - ob;
      return a.width - b.width;
    });
  }

  const totalFrames = frames.length;
  const isMulti = totalFrames > 1;
  const hasMultipleSections = sectionGroups.length > 1;

  return (
    <section className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/[0.06] h-full flex flex-col">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[#FF0558]/10 border border-[#FF0558]/20 flex items-center justify-center">
          <span className="text-[#FF0558] font-black text-sm">1</span>
        </div>
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">
            Figma 디자인
          </h3>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            프레임 URL은 단일 시안, 페이지 URL은 그 페이지의 모든 사이즈 시안을 한 번에 분석합니다
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8.5 0A4.5 4.5 0 004 4.5 4.5 4.5 0 008.5 9H12V0H8.5zm3.5 9h3.5a4.5 4.5 0 100-9H12v9zm0 0v6a4.5 4.5 0 104.5-4.5H12V9zm0 6A4.5 4.5 0 107.5 19.5 4.5 4.5 0 0012 15v-0zM8.5 9a4.5 4.5 0 100 9H12V9H8.5z" />
          </svg>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://figma.com/design/...?node-id=... (프레임 또는 페이지 URL)"
            className="w-full pl-11 pr-4 py-3.5 bg-[#1C1C1C] border border-white/[0.06] rounded-2xl text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FF0558]/50 focus:ring-2 focus:ring-[#FF0558]/10 transition-all"
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={loading || !url.trim()}
          className="px-6 py-3 bg-white text-black rounded-2xl text-[13px] font-bold hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              분석 중
            </>
          ) : (
            "불러오기"
          )}
        </button>
      </div>

      {/* Foundation URL 토글 */}
      <div className="mt-3">
        <button
          onClick={() => setShowFoundation(!showFoundation)}
          className="text-xs text-neutral-500 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <svg
            className={`w-3 h-3 transform transition-transform ${
              showFoundation ? "rotate-90" : ""
            }`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M6 4l8 6-8 6V4z" />
          </svg>
          디자인 시스템(Foundation) 파일 지정 (선택)
          {catalog.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[#FF0558]/15 text-[#FF0558] font-bold">
              {catalog.length}개 토큰
            </span>
          )}
        </button>

        {showFoundation && (
          <div className="mt-2">
            <input
              type="text"
              value={foundationUrl}
              onChange={(e) => setFoundationUrl(e.target.value)}
              placeholder="https://figma.com/design/... (Foundation 파일 URL — 비우면 현재 파일)"
              className="w-full px-4 py-2.5 bg-[#1C1C1C] border border-white/[0.06] rounded-xl text-xs text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FF0558]/50 focus:ring-2 focus:ring-[#FF0558]/10 transition-all"
            />
            <p className="mt-1.5 text-[11px] text-neutral-600">
              별도 Foundation 파일이 있다면 URL 입력. 해당 파일의 Styles(컬러, 타이포)를 카탈로그로 불러와 비교 시 사용합니다.
            </p>
          </div>
        )}
      </div>

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

      {totalFrames > 0 && (
        <>
          {/* 결과 요약 */}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
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
                {isMulti
                  ? `프레임 ${totalFrames}개 추출 완료`
                  : `디자인 토큰 ${activeFrame?.tokens.length || 0}개`}
              </span>
              {cachedHit && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[#22C55E]/15 text-[#22C55E] font-bold">
                  ⚡ 캐시
                </span>
              )}
            </div>
            {catalog.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-[#FF0558]/15 flex items-center justify-center">
                  <svg
                    className="w-3 h-3 text-[#FF0558]"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <span className="text-[#FF0558] font-bold">
                  DS 카탈로그 {catalog.length}개
                </span>
              </div>
            )}
          </div>

          {/* SECTION별 그룹화된 viewport 칩 (멀티 프레임일 때만) */}
          {isMulti && (
            <div className="mt-5 space-y-3">
              <div>
                <p className="text-[11px] text-neutral-500 uppercase tracking-wider font-bold">
                  비교할 케이스 / 사이즈 선택
                </p>
                <p className="text-[12px] text-neutral-400 mt-1.5 leading-relaxed">
                  {hasMultipleSections ? (
                    <>
                      <span className="text-white font-semibold">케이스</span>(예:
                      로그인/비로그인)와{" "}
                      <span className="text-white font-semibold">화면 크기 범위</span>를
                      고르세요. 선택한 시안은 스테이징의 같은 크기 범위 캡처와 1:1로
                      비교됩니다.
                    </>
                  ) : (
                    <>
                      검증할{" "}
                      <span className="text-white font-semibold">화면 크기 범위</span>를
                      고르세요. 선택한 시안은 스테이징의 같은 크기 범위 캡처와 1:1로
                      비교됩니다.
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-3">
                {sectionGroups.map((group, groupIdx) => (
                  <div
                    key={group.sectionName ?? `__no_section_${groupIdx}`}
                    className={`rounded-xl ${
                      hasMultipleSections
                        ? "bg-[#0A0A0A] border border-white/[0.06] p-3"
                        : ""
                    }`}
                  >
                    {/* SECTION 헤더 (여러 SECTION일 때만 표시) */}
                    {hasMultipleSections && (
                      <div className="flex items-center gap-2 mb-2.5">
                        <svg
                          className="w-3.5 h-3.5 text-[#FF0558]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M5 8h14M5 12h14M5 16h14"
                          />
                        </svg>
                        <span className="text-[12px] font-bold text-white">
                          {group.sectionName ?? "기타 시안"}
                        </span>
                        <span className="text-[10px] text-neutral-600">
                          {group.items.length}개
                        </span>
                      </div>
                    )}
                    {/* viewport 칩들 */}
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((f) => {
                        const isActive = f.frameId === activeFrameId;
                        return (
                          <button
                            key={f.frameId}
                            onClick={() => setActive(f)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-bold transition-all whitespace-nowrap ${
                              isActive
                                ? "bg-white text-black shadow-lg"
                                : "bg-[#1C1C1C] text-neutral-300 border border-white/[0.06] hover:border-white/20 hover:text-white"
                            }`}
                          >
                            <span
                              className={`text-[10px] uppercase tracking-wider font-bold ${
                                isActive ? "text-black/60" : "text-[#FF0558]"
                              }`}
                            >
                              {VIEWPORT_LABELS[f.viewport].split(" ")[0]}
                            </span>
                            <span className="font-mono opacity-70">
                              {f.width}px
                            </span>
                            <span className="truncate max-w-[160px]">
                              {f.name}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                isActive
                                  ? "bg-black/10 text-black/70"
                                  : "bg-white/[0.06] text-neutral-500"
                              }`}
                            >
                              {f.tokens.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeFrame && (
        <TokenPreview
          tokens={activeFrame.tokens}
          label={
            isMulti
              ? `${activeFrame.name} (${activeFrame.width}px) 토큰 보기`
              : "추출된 디자인 토큰 보기"
          }
        />
      )}

      {catalog.length > 0 && <CatalogPreview catalog={catalog} />}
    </section>
  );
}

function CatalogPreview({ catalog }: { catalog: DesignSystemToken[] }) {
  const [open, setOpen] = useState(false);
  const colors = catalog.filter((c) => c.type === "color");
  const typography = catalog.filter((c) => c.type === "typography");

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-neutral-400 hover:text-white flex items-center gap-2 transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 transform transition-transform ${
            open ? "rotate-90" : ""
          }`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M6 4l8 6-8 6V4z" />
        </svg>
        디자인 시스템 카탈로그 보기
      </button>
      {open && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-2xl bg-[#0A0A0A] border border-white/[0.06]">
          {colors.length > 0 && (
            <div>
              <div className="px-4 py-2.5 bg-[#141414] backdrop-blur sticky top-0 flex items-center gap-2 border-b border-white/[0.04]">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FF0558]/15 text-[#FF0558]">
                  컬러
                </span>
                <span className="text-neutral-600 text-xs">
                  {colors.length}개
                </span>
              </div>
              {colors.map((c, i) => (
                <div
                  key={i}
                  className="px-4 py-2.5 text-sm border-b border-white/[0.03] flex justify-between items-center gap-4 hover:bg-white/[0.02]"
                >
                  <span className="text-white/90 truncate flex-1">{c.name}</span>
                  <span className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-md border border-white/20"
                      style={{ background: c.value }}
                    />
                    <span className="font-mono text-white bg-white/5 px-2 py-0.5 rounded-md text-xs">
                      {c.value}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {typography.length > 0 && (
            <div>
              <div className="px-4 py-2.5 bg-[#141414] backdrop-blur sticky top-0 flex items-center gap-2 border-b border-white/[0.04]">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#818CF8]/15 text-[#818CF8]">
                  타이포
                </span>
                <span className="text-neutral-600 text-xs">
                  {typography.length}개
                </span>
              </div>
              {typography.map((t, i) => (
                <div
                  key={i}
                  className="px-4 py-2.5 text-sm border-b border-white/[0.03] flex justify-between gap-4 hover:bg-white/[0.02]"
                >
                  <span className="text-white/90 truncate flex-1">{t.name}</span>
                  <span className="font-mono text-white bg-white/5 px-2 py-0.5 rounded-md text-xs whitespace-nowrap">
                    {t.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
