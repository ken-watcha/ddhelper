"use client";

import { useState } from "react";
import { DesignToken } from "@/lib/types";

export default function TokenPreview({
  tokens,
  label,
}: {
  tokens: DesignToken[];
  label: string;
}) {
  const [open, setOpen] = useState(false);

  if (tokens.length === 0) return null;

  const grouped = tokens.reduce(
    (acc, token) => {
      if (!acc[token.category]) acc[token.category] = [];
      acc[token.category].push(token);
      return acc;
    },
    {} as Record<string, DesignToken[]>
  );

  const categoryLabels: Record<string, string> = {
    color: "컬러",
    typography: "타이포",
    spacing: "간격",
    sizing: "크기",
    border: "보더",
  };

  const categoryColors: Record<string, string> = {
    color: "bg-[#FF0558]/15 text-[#FF0558]",
    typography: "bg-[#6366F1]/15 text-[#818CF8]",
    spacing: "bg-[#22C55E]/15 text-[#22C55E]",
    sizing: "bg-[#FFB800]/15 text-[#FFB800]",
    border: "bg-white/10 text-neutral-400",
  };

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-sm text-neutral-400 hover:text-white flex items-center gap-2 transition-colors"
      >
        <svg
          className={`w-3.5 h-3.5 transform transition-transform ${open ? "rotate-90" : ""}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M6 4l8 6-8 6V4z" />
        </svg>
        {label}
      </button>
      {open && (
        <div className="mt-3 max-h-96 overflow-y-auto rounded-2xl bg-[#0A0A0A] border border-white/[0.06]">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-4 py-2.5 bg-[#141414] backdrop-blur sticky top-0 flex items-center gap-2 border-b border-white/[0.04]">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${categoryColors[category] || "bg-white/10 text-white"}`}
                >
                  {categoryLabels[category] || category}
                </span>
                <span className="text-neutral-600 text-xs">
                  {items.length}개
                </span>
              </div>
              {items.map((token, i) => (
                <div
                  key={i}
                  className="px-4 py-2.5 text-sm border-b border-white/[0.03] flex justify-between gap-4 hover:bg-white/[0.02]"
                >
                  <span className="text-white/90 truncate flex-1">
                    {token.element}
                  </span>
                  <span className="text-neutral-400 flex items-center gap-2 whitespace-nowrap">
                    <span className="text-neutral-600 text-xs">
                      {token.property}
                    </span>
                    <span className="font-mono text-white bg-white/5 px-2 py-0.5 rounded-md text-xs">
                      {token.value}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
