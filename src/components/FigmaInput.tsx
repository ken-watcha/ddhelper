"use client";

import { useState } from "react";
import { DesignToken, FigmaFrameInfo } from "@/lib/types";
import { postJson } from "@/lib/fetcher";
import TokenPreview from "./TokenPreview";

export default function FigmaInput({
  onTokensExtracted,
}: {
  onTokensExtracted: (tokens: DesignToken[], frame: FigmaFrameInfo | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState<DesignToken[]>([]);
  const [error, setError] = useState("");

  const handleLoad = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await postJson<{
        tokens: DesignToken[];
        frame: FigmaFrameInfo | null;
      }>("/api/figma", { figmaUrl: url });
      setTokens(data.tokens);
      onTokensExtracted(data.tokens, data.frame || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "피그마를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-[#141414] rounded-2xl p-6 md:p-8 border border-white/[0.06]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-[#FF0558]/10 border border-[#FF0558]/20 flex items-center justify-center">
          <span className="text-[#FF0558] font-black text-sm">1</span>
        </div>
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">
            Figma 디자인
          </h3>
          <p className="text-[13px] text-neutral-500 mt-0.5">
            피그마 프레임 URL을 붙여넣으면 디자인 토큰을 자동으로 추출합니다
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
            placeholder="https://figma.com/design/...?node-id=..."
            className="w-full pl-11 pr-4 py-3.5 bg-[#1C1C1C] border border-white/[0.06] rounded-2xl text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#FF0558]/50 focus:ring-2 focus:ring-[#FF0558]/10 transition-all"
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={loading || !url.trim()}
          className="px-6 py-3.5 bg-white text-black rounded-2xl text-sm font-bold hover:bg-neutral-100 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors flex items-center justify-center gap-2"
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
            디자인 토큰 {tokens.length}개 추출 완료
          </span>
        </div>
      )}

      <TokenPreview tokens={tokens} label="추출된 디자인 토큰 보기" />
    </section>
  );
}
