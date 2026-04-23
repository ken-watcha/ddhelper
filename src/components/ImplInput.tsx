"use client";

import { useState } from "react";
import { DesignToken } from "@/lib/types";
import { postJson } from "@/lib/fetcher";
import TokenPreview from "./TokenPreview";

type Tab = "web" | "ios" | "android";

export default function ImplInput({
  onTokensExtracted,
}: {
  onTokensExtracted: (tokens: DesignToken[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("web");
  const [webUrl, setWebUrl] = useState("");
  const [iosCode, setIosCode] = useState("");
  const [androidCode, setAndroidCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<DesignToken[]>([]);
  const [error, setError] = useState("");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: "web",
      label: "Web",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: "ios",
      label: "iOS",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
      ),
    },
    {
      id: "android",
      label: "Android",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.43 11.43 0 00-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
        </svg>
      ),
    },
  ];

  const handleAnalyze = async () => {
    setLoading(true);
    setError("");
    try {
      let data: { tokens: DesignToken[] };

      if (activeTab === "web") {
        if (!webUrl.trim()) return;
        data = await postJson("/api/extract-web", { url: webUrl });
      } else {
        const code = activeTab === "ios" ? iosCode : androidCode;
        if (!code.trim()) return;
        data = await postJson("/api/extract-code", {
          code,
          platform: activeTab,
        });
      }

      setTokens(data.tokens);
      onTokensExtracted(data.tokens);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  const isDisabled =
    loading ||
    (activeTab === "web" && !webUrl.trim()) ||
    (activeTab === "ios" && !iosCode.trim()) ||
    (activeTab === "android" && !androidCode.trim());

  return (
    <section className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/[0.06]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[#FF0558]/10 border border-[#FF0558]/20 flex items-center justify-center">
          <span className="text-[#FF0558] font-black text-sm">2</span>
        </div>
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">
            구현물
          </h3>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            스테이징에 배포된 웹 URL 또는 앱 소스 코드를 입력해주세요
          </p>
        </div>
      </div>

      {/* Tabs - Watcha chip style (pill, 흰 배경 when active) */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setError("");
            }}
            className={`flex items-center gap-2 py-2.5 px-5 rounded-full text-[13px] font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-white text-black"
                : "bg-transparent text-neutral-400 border border-white/15 hover:border-white/30 hover:text-white"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "web" && (
        <div className="relative">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
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
      )}

      {activeTab === "ios" && (
        <textarea
          value={iosCode}
          onChange={(e) => setIosCode(e.target.value)}
          placeholder="SwiftUI 코드를 붙여넣으세요..."
          rows={10}
          className="w-full px-4 py-3.5 bg-[#1C1C1C] border border-white/[0.06] rounded-2xl text-sm text-white placeholder:text-neutral-600 font-mono focus:outline-none focus:border-[#FF0558]/50 focus:ring-2 focus:ring-[#FF0558]/10 transition-all resize-y"
        />
      )}

      {activeTab === "android" && (
        <textarea
          value={androidCode}
          onChange={(e) => setAndroidCode(e.target.value)}
          placeholder="Jetpack Compose 코드를 붙여넣으세요..."
          rows={10}
          className="w-full px-4 py-3.5 bg-[#1C1C1C] border border-white/[0.06] rounded-2xl text-sm text-white placeholder:text-neutral-600 font-mono focus:outline-none focus:border-[#FF0558]/50 focus:ring-2 focus:ring-[#FF0558]/10 transition-all resize-y"
        />
      )}

      <button
        onClick={handleAnalyze}
        disabled={isDisabled}
        className="mt-4 px-6 py-3 bg-white text-black rounded-full text-[13px] font-bold hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
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

      {error && (
        <div className="mt-4 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/30 px-4 py-3">
          <p className="text-sm text-[#EF4444]">{error}</p>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <div className="w-5 h-5 rounded-full bg-[#22C55E]/15 flex items-center justify-center">
            <svg className="w-3 h-3 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-[#22C55E] font-bold">
            구현 토큰 {tokens.length}개 추출 완료
          </span>
        </div>
      )}

      <TokenPreview tokens={tokens} label="추출된 구현 토큰 보기" />
    </section>
  );
}
