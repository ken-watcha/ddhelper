"use client";

import { useState } from "react";
import Image from "next/image";
import { DesignToken, ComparisonResult, FigmaFrameInfo } from "@/lib/types";
import { postJson } from "@/lib/fetcher";
import FigmaInput from "@/components/FigmaInput";
import ImplInput from "@/components/ImplInput";
import ComparisonTable from "@/components/ComparisonTable";
import VisualCompare from "@/components/VisualCompare";

type ViewMode = "visual" | "table";

export default function Home() {
  const [designTokens, setDesignTokens] = useState<DesignToken[]>([]);
  const [implTokens, setImplTokens] = useState<DesignToken[]>([]);
  const [frame, setFrame] = useState<FigmaFrameInfo | null>(null);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [summary, setSummary] = useState<{
    critical: number;
    warning: number;
    info: number;
    match: number;
    missing: number;
    total: number;
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");

  const handleCompare = async () => {
    if (designTokens.length === 0 || implTokens.length === 0) return;
    setComparing(true);
    setError("");
    try {
      const data = await postJson<{
        results: ComparisonResult[];
        summary: typeof summary;
      }>("/api/compare", { designTokens, implTokens });
      setResults(data.results);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "비교 중 오류가 발생했습니다");
    } finally {
      setComparing(false);
    }
  };

  const canCompare = designTokens.length > 0 && implTokens.length > 0;

  return (
    <div className="min-h-screen bg-black">
      {/* Header - Watcha 스타일: 블랙 + 깔끔한 네비 */}
      <header className="sticky top-0 z-20 bg-black/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/watcha-logo.svg"
              alt="Watcha"
              width={32}
              height={32}
              className="rounded-md"
            />
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                DDhelper
              </h1>
              <p className="text-[11px] text-neutral-500 leading-none mt-0.5">
                Design Discrepancy Helper
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex text-xs font-medium px-3 py-1.5 rounded-full bg-white/[0.06] text-neutral-400">
              Watcha Design Team
            </span>
          </div>
        </div>
      </header>

      {/* Hero Section - 왓챠의 시네마틱한 느낌 */}
      <section className="relative max-w-6xl mx-auto px-6 pt-16 pb-10 overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FF0558]/10 border border-[#FF0558]/20 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF0558] watcha-pulse" />
            <span className="text-xs font-bold text-[#FF0558] tracking-wide">
              AI DESIGN QA
            </span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-[1.1]">
            디자인 QA를<br />
            <span className="text-[#FF0558]">자동으로 검증</span>
            <span className="text-white">하세요</span>
          </h2>
          <p className="mt-5 text-base text-neutral-400 leading-relaxed max-w-xl">
            피그마 시안과 스테이징에 배포된 웹/앱의 디자인 불일치를 AI가 찾아줍니다. 아이콘 크기,
            컬러, 간격까지 하나씩 수동으로 확인할 필요 없어요.
          </p>
        </div>
        {/* 배경 그라디언트 */}
        <div className="absolute right-0 top-0 w-[500px] h-[500px] bg-[#FF0558]/10 rounded-full blur-[120px] -z-0 pointer-events-none" />
      </section>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 pb-20 space-y-4">
        <FigmaInput
          onTokensExtracted={(tokens, f) => {
            setDesignTokens(tokens);
            setFrame(f);
          }}
        />

        <ImplInput onTokensExtracted={setImplTokens} />

        {/* Step 3: Compare */}
        <section className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/[0.06]">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <StepBadge number={3} />
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  비교 결과
                </h3>
                <p className="text-[13px] text-neutral-500 mt-0.5">
                  Figma 시안과 구현물의 불일치를 분석해드려요
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {summary && (
                <div className="flex gap-0.5 p-1 bg-[#1C1C1C] border border-white/[0.06] rounded-full">
                  <button
                    onClick={() => setViewMode("visual")}
                    className={`px-4 py-2 rounded-full text-[13px] font-bold transition-all flex items-center gap-1.5 ${
                      viewMode === "visual"
                        ? "bg-white text-black"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" />
                    </svg>
                    화면
                  </button>
                  <button
                    onClick={() => setViewMode("table")}
                    className={`px-4 py-2 rounded-full text-[13px] font-bold transition-all flex items-center gap-1.5 ${
                      viewMode === "table"
                        ? "bg-white text-black"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                    표
                  </button>
                </div>
              )}
              <WatchaButton
                onClick={handleCompare}
                disabled={!canCompare || comparing}
                loading={comparing}
              >
                {comparing ? "비교 중..." : "비교하기"}
              </WatchaButton>
            </div>
          </div>

          {!canCompare && !summary && (
            <EmptyState
              icon={
                <svg className="w-10 h-10 text-neutral-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              }
              title="Figma 디자인과 구현물을 먼저 로드해주세요"
              description="두 소스가 준비되면 비교가 가능합니다"
            />
          )}

          {error && (
            <div className="rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 px-4 py-3">
              <p className="text-sm text-[#EF4444]">{error}</p>
            </div>
          )}

          {summary && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <SummaryCard label="심각" count={summary.critical} color="#EF4444" />
                <SummaryCard label="주의" count={summary.warning} color="#FFB800" />
                <SummaryCard label="누락" count={summary.missing} color="#A3A3A3" />
                <SummaryCard label="일치" count={summary.match} color="#22C55E" />
              </div>

              {viewMode === "visual" && frame ? (
                <VisualCompare results={results} frame={frame} />
              ) : viewMode === "visual" && !frame ? (
                <div className="space-y-4">
                  <div className="rounded-2xl bg-[#FFB800]/10 border border-[#FFB800]/30 p-5 text-sm text-[#FFB800]">
                    피그마 이미지를 불러올 수 없어 표 뷰로 자동 전환됩니다.
                  </div>
                  <ComparisonTable results={results} summary={summary} hideSummary />
                </div>
              ) : (
                <ComparisonTable results={results} summary={summary} hideSummary />
              )}
            </>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/watcha-logo.svg"
              alt="Watcha"
              width={24}
              height={24}
              className="rounded opacity-60"
            />
            <p className="text-xs text-neutral-500">
              Built by Watcha Product Design Team
            </p>
          </div>
          <p className="text-xs text-neutral-600">Powered by Gemini · Figma API</p>
        </div>
      </footer>
    </div>
  );
}

function StepBadge({ number }: { number: number }) {
  return (
    <div className="w-10 h-10 rounded-xl bg-[#FF0558]/10 border border-[#FF0558]/20 flex items-center justify-center">
      <span className="text-[#FF0558] font-black text-sm">{number}</span>
    </div>
  );
}

function WatchaButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2.5 bg-[#FF0558] text-white rounded-full text-[13px] font-bold hover:bg-[#E6044F] active:bg-[#CC0446] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-[#FF0558]/20"
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
        </svg>
      )}
      {children}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-[#0A0A0A] border border-white/[0.04] px-5 py-10 text-center">
      <div className="flex justify-center mb-4">{icon}</div>
      <p className="text-sm text-neutral-300 font-medium">{title}</p>
      <p className="text-xs text-neutral-500 mt-1">{description}</p>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl p-4 border border-white/[0.06] bg-[#0A0A0A]">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          {label}
        </span>
      </div>
      <div className="text-3xl font-black tracking-tight" style={{ color }}>
        {count}
      </div>
    </div>
  );
}
