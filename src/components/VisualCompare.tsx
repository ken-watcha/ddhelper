"use client";

import { useState, useRef, useEffect } from "react";
import { ComparisonResult, FigmaFrameInfo } from "@/lib/types";

export default function VisualCompare({
  results,
  frame,
}: {
  results: ComparisonResult[];
  frame: FigmaFrameInfo;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // 이슈가 있는 결과만 (match 제외)
  const issues = results.filter(
    (r) => r.status !== "match" && r.bbox
  );

  // 컨테이너 크기에 맞춰 이미지 스케일 계산
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const s = containerWidth / frame.frameWidth;
      setScale(Math.min(s, 1));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [frame.frameWidth]);

  if (issues.length === 0) {
    return (
      <div className="rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/30 p-8 text-center">
        <div className="text-[#22C55E] text-3xl mb-2">✨</div>
        <p className="text-[#22C55E] font-bold">디자인이 완벽히 일치합니다!</p>
      </div>
    );
  }

  const getMarkerColor = (result: ComparisonResult) => {
    if (result.severity === "critical") return "#EF4444";
    if (result.severity === "warning") return "#FFB800";
    if (result.status === "missing_in_impl") return "#999999";
    return "#FF0558";
  };

  return (
    <div className="space-y-4">
      {/* 이미지 + 마커 오버레이 */}
      <div
        ref={containerRef}
        className="relative mx-auto overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0A]"
        style={{
          width: "100%",
          maxWidth: frame.frameWidth,
        }}
      >
        <div
          className="relative"
          style={{
            width: frame.frameWidth * scale,
            height: frame.frameHeight * scale,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={frame.imageUrl}
            alt="Figma design"
            className="absolute inset-0 w-full h-full object-contain"
          />

          {/* 마커 오버레이 */}
          {issues.map((result, idx) => {
            if (!result.bbox) return null;

            // 프레임 원점 기준 상대 좌표 계산 (Figma는 absolute 좌표)
            const relX = result.bbox.x - frame.frameX;
            const relY = result.bbox.y - frame.frameY;

            const left = relX * scale;
            const top = relY * scale;
            const width = result.bbox.width * scale;
            const height = result.bbox.height * scale;

            const color = getMarkerColor(result);
            const isSelected = selected === idx;
            const isHovered = hoveredIdx === idx;

            return (
              <div
                key={idx}
                className="absolute cursor-pointer group"
                style={{
                  left,
                  top,
                  width: Math.max(width, 20),
                  height: Math.max(height, 20),
                }}
                onClick={() => setSelected(selected === idx ? null : idx)}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* 박스 하이라이트 */}
                <div
                  className="absolute inset-0 border-2 rounded transition-all"
                  style={{
                    borderColor: color,
                    backgroundColor: isHovered || isSelected ? `${color}20` : "transparent",
                    boxShadow: isSelected ? `0 0 0 4px ${color}40` : "none",
                  }}
                />
                {/* 번호 배지 */}
                <div
                  className="absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg"
                  style={{ backgroundColor: color }}
                >
                  {idx + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 이슈 리스트 (클릭 시 해당 마커로 이동) */}
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-[#999999] mb-3">
          발견된 이슈 ({issues.length}건)
        </h4>
        {issues.map((result, idx) => {
          const color = getMarkerColor(result);
          const isSelected = selected === idx;

          return (
            <button
              key={idx}
              onClick={() => setSelected(selected === idx ? null : idx)}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`w-full text-left p-4 rounded-xl border transition-all ${
                isSelected
                  ? "bg-[#2A2A2A] border-white/20"
                  : "bg-[#1C1C1C] border-white/5 hover:bg-[#2A2A2A]/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5"
                  style={{ backgroundColor: color }}
                >
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-bold text-white">
                      {result.element}
                    </span>
                    <span className="text-xs text-[#666666]">
                      {result.property}
                    </span>
                    <SeverityBadge result={result} />
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-sm flex-wrap">
                    <ValuePill label="Figma" value={result.designValue} color="#FF0558" />
                    <svg className="w-4 h-4 text-[#666666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <ValuePill label="구현" value={result.implValue} color="#FFFFFF" />
                  </div>
                  {result.notes && (
                    <p className="mt-2 text-xs text-[#999999]">
                      {result.notes}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SeverityBadge({ result }: { result: ComparisonResult }) {
  const base = "inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full";
  if (result.severity === "critical")
    return <span className={`${base} bg-[#EF4444]/15 text-[#EF4444]`}>심각</span>;
  if (result.severity === "warning")
    return <span className={`${base} bg-[#FFB800]/15 text-[#FFB800]`}>주의</span>;
  if (result.status === "missing_in_impl")
    return <span className={`${base} bg-[#666666]/20 text-[#999999]`}>누락</span>;
  return <span className={`${base} bg-[#9B59F6]/15 text-[#9B59F6]`}>참고</span>;
}

function ValuePill({ label, value, color }: { label: string; value: string; color: string }) {
  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color }}>
        {label}
      </span>
      {isHex && (
        <span
          className="w-3 h-3 rounded-full border border-white/20"
          style={{ background: value }}
        />
      )}
      <span className="font-mono text-xs bg-white/5 px-2 py-0.5 rounded-md text-white">
        {value}
      </span>
    </span>
  );
}
