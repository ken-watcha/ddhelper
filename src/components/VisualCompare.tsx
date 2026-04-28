"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  ComparisonResult,
  FigmaFrameInfo,
  BoundingBox,
  StagingCaptureItem,
} from "@/lib/types";

/**
 * property 문자열 → 짧은 한글 라벨 + 카테고리 ID
 * 카테고리 ID는 같은 종류 칩을 한 번만 표시할 때 dedupe 키로 사용.
 */
function propertyLabel(prop: string): { icon: string; label: string; cat: string } {
  const p = (prop || "").toLowerCase();
  if (p.includes("background-color") || p === "bg" || p.endsWith("-bg"))
    return { icon: "🎨", label: "배경색", cat: "color-bg" };
  if (p.includes("text-color") || (p === "color" && !p.includes("border")))
    return { icon: "🎨", label: "글자색", cat: "color-text" };
  if (p.includes("border-color"))
    return { icon: "🎨", label: "보더색", cat: "color-border" };
  if (p.includes("color")) return { icon: "🎨", label: "컬러", cat: "color" };
  if (p.includes("font-size")) return { icon: "📏", label: "폰트크기", cat: "font-size" };
  if (p.includes("font-weight")) return { icon: "B", label: "굵기", cat: "font-weight" };
  if (p.includes("font-family")) return { icon: "Aa", label: "폰트", cat: "font-family" };
  if (p.includes("line-height")) return { icon: "↕", label: "행간", cat: "line-height" };
  if (p.includes("letter-spacing")) return { icon: "A→A", label: "자간", cat: "letter-spacing" };
  if (p.includes("padding")) return { icon: "▭", label: "패딩", cat: "padding" };
  if (p.includes("gap") || p === "spacing") return { icon: "↔", label: "간격", cat: "gap" };
  if (p.includes("radius")) return { icon: "◜", label: "라운딩", cat: "radius" };
  if (p.includes("border-width")) return { icon: "▭", label: "보더두께", cat: "border-width" };
  if (p.includes("border")) return { icon: "▭", label: "보더", cat: "border" };
  if (p === "width") return { icon: "↔", label: "너비", cat: "width" };
  if (p === "height") return { icon: "↕", label: "높이", cat: "height" };
  if (p.includes("opacity")) return { icon: "◐", label: "투명도", cat: "opacity" };
  return { icon: "•", label: prop, cat: prop };
}

function severityRank(r: ComparisonResult): number {
  if (r.severity === "critical") return 3;
  if (r.severity === "warning") return 2;
  if (r.status === "missing_in_impl") return 1;
  return 0;
}

interface IssueGroup {
  key: string; // dedupe key
  element: string;
  bbox: BoundingBox;
  items: ComparisonResult[];
  repr: ComparisonResult; // 가장 심각한 항목 (마커 색상 결정용)
  globalNumber: number; // 전체 그룹 중 번호 (1부터)
}

export default function VisualCompare({
  results,
  frame,
  stagingCapture,
  sectionName,
  frameName,
}: {
  results: ComparisonResult[];
  frame: FigmaFrameInfo;
  stagingCapture?: StagingCaptureItem | null;
  sectionName?: string | null;
  frameName?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const hasStaging = !!stagingCapture?.capture;

  // 이슈만 (match 제외)
  const issues = useMemo(
    () => results.filter((r) => r.status !== "match" && r.bbox),
    [results]
  );

  // 같은 nodeId(없으면 element)끼리 그룹핑
  const groups = useMemo<IssueGroup[]>(() => {
    const map = new Map<string, ComparisonResult[]>();
    for (const r of issues) {
      const key = r.nodeId || r.element || "unknown";
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    const list: IssueGroup[] = [];
    let n = 1;
    for (const [key, items] of map.entries()) {
      const repr = items.slice().sort((a, b) => severityRank(b) - severityRank(a))[0];
      if (!repr.bbox) continue;
      list.push({
        key,
        element: repr.element,
        bbox: repr.bbox,
        items,
        repr,
        globalNumber: n++,
      });
    }
    // 심각도 높은 그룹 → 위쪽 좌표 순
    list.sort((a, b) => {
      const sa = severityRank(a.repr);
      const sb = severityRank(b.repr);
      if (sa !== sb) return sb - sa;
      return a.bbox.y - b.bbox.y;
    });
    // 정렬 후 번호 재부여
    list.forEach((g, i) => (g.globalNumber = i + 1));
    return list;
  }, [issues]);

  // 컨테이너 크기에 맞춰 이미지 스케일 계산.
  // 좌우 동일 너비 비교를 위해 cap 제거 — 좁은 시안도 컬럼 폭으로 확대.
  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      setScale(containerWidth / frame.frameWidth);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [frame.frameWidth]);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/30 p-8 text-center">
        <div className="text-[#22C55E] text-3xl mb-2">✨</div>
        <p className="text-[#22C55E] font-bold">디자인이 완벽히 일치합니다!</p>
      </div>
    );
  }

  const getMarkerColor = (g: IssueGroup) => {
    if (g.repr.severity === "critical") return "#EF4444";
    if (g.repr.severity === "warning") return "#FFB800";
    if (g.repr.status === "missing_in_impl") return "#999999";
    return "#FF0558";
  };

  // 그룹의 카테고리 칩 (중복 제거)
  const groupChips = (g: IssueGroup) => {
    const seen = new Set<string>();
    const chips: { icon: string; label: string }[] = [];
    for (const it of g.items) {
      const { icon, label, cat } = propertyLabel(it.property);
      if (seen.has(cat)) continue;
      seen.add(cat);
      chips.push({ icon, label });
      if (chips.length >= 3) break;
    }
    return chips;
  };

  return (
    <div className="space-y-4">
      {/* 안내: staging 유무에 따라 다른 메시지 */}
      {!hasStaging && (
        <div className="rounded-xl bg-[#FF0558]/5 border border-[#FF0558]/20 px-4 py-2.5 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#FF0558] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-[12px] text-neutral-300 leading-relaxed">
            아래는 <span className="font-bold text-[#FF0558]">Figma 시안</span>입니다. 스테이징 캡처가 끝나면 오른쪽에 자동으로 표시됩니다.
          </p>
        </div>
      )}

      {/* 좌우 분할 컨테이너 */}
      <div
        className={`grid gap-4 ${
          hasStaging ? "lg:grid-cols-2" : "grid-cols-1"
        }`}
      >
      {/* 좌: Figma 시안 + 마커 오버레이 */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0A] w-full"
      >
        {/* 라벨 헤더 띠 — 이미지 위에 항상 표시 */}
        <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 flex items-center justify-start gap-1.5 flex-wrap bg-gradient-to-b from-black/85 via-black/50 to-transparent pointer-events-none">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FF0558] text-white text-[11px] font-bold shadow-lg">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8.5 0A4.5 4.5 0 004 4.5 4.5 4.5 0 008.5 9H12V0H8.5zm3.5 9h3.5a4.5 4.5 0 100-9H12v9zm0 0v6a4.5 4.5 0 104.5-4.5H12V9zm0 6A4.5 4.5 0 107.5 19.5 4.5 4.5 0 0012 15v-0zM8.5 9a4.5 4.5 0 100 9H12V9H8.5z" />
            </svg>
            Figma 디자인
          </span>
          {sectionName && (
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] font-bold shadow-lg max-w-[60%] truncate">
              {sectionName}
            </span>
          )}
          {frameName && (
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-white/10 backdrop-blur-sm text-white/90 text-[10px] font-medium shadow-lg max-w-[40%] truncate">
              {frameName}
            </span>
          )}
        </div>
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

          {groups.map((g) => {
            const relX = g.bbox.x - frame.frameX;
            const relY = g.bbox.y - frame.frameY;
            const left = relX * scale;
            const top = relY * scale;
            const width = Math.max(g.bbox.width * scale, 24);
            const height = Math.max(g.bbox.height * scale, 24);

            const color = getMarkerColor(g);
            const isSelected = selected === g.key;
            const isHovered = hovered === g.key;
            const active = isSelected || isHovered;

            const chips = groupChips(g);
            const hasMore = g.items.length > chips.length;
            // 박스가 화면 위쪽이면 라벨을 박스 안 상단, 아니면 위에 띄움
            const labelAbove = top > 32;

            return (
              <div
                key={g.key}
                className="absolute cursor-pointer"
                style={{ left, top, width, height }}
                onClick={() => setSelected(isSelected ? null : g.key)}
                onMouseEnter={() => setHovered(g.key)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* 박스 하이라이트 */}
                <div
                  className="absolute inset-0 border-2 rounded transition-all"
                  style={{
                    borderColor: color,
                    backgroundColor: active ? `${color}22` : "transparent",
                    boxShadow: isSelected ? `0 0 0 4px ${color}40` : "none",
                  }}
                />
                {/* 라벨 (속성 칩 + 번호) */}
                <div
                  className="absolute flex items-center gap-1 whitespace-nowrap pointer-events-none"
                  style={{
                    left: 0,
                    top: labelAbove ? -28 : 4,
                    transform: labelAbove ? "translateY(0)" : "none",
                    zIndex: active ? 10 : 1,
                  }}
                >
                  {/* 번호 배지 */}
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[11px] font-bold shadow-md shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {g.globalNumber}
                  </span>
                  {/* 카테고리 칩들 */}
                  {chips.map((c, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white shadow-md"
                      style={{ backgroundColor: color }}
                    >
                      <span className="opacity-90">{c.icon}</span>
                      <span>{c.label}</span>
                    </span>
                  ))}
                  {hasMore && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white shadow-md"
                      style={{ backgroundColor: color }}
                    >
                      +{g.items.length - chips.length}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 우: 스테이징 캡처 */}
      {hasStaging && stagingCapture?.capture && (
        <div
          className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0A0A0A] w-full"
        >
          {/* 라벨 헤더 띠 */}
          <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/50 to-transparent pointer-events-none">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#22C55E] text-white text-[11px] font-bold shadow-lg">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              스테이징 ({stagingCapture.viewport.width}px)
            </span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={stagingCapture.capture.imageDataUrl}
            alt="Staging capture"
            className="block w-full h-auto"
          />
        </div>
      )}

      </div>
      {/* /좌우 분할 컨테이너 */}

      {/* 이슈 리스트 (그룹별) */}
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-[#999999] mb-3">
          발견된 이슈 ({groups.length}개 요소 / {issues.length}건)
        </h4>
        {groups.map((g) => {
          const color = getMarkerColor(g);
          const isSelected = selected === g.key;
          const isExpanded = expanded.has(g.key);
          const showAll = isExpanded || g.items.length <= 3;
          const visibleItems = showAll ? g.items : g.items.slice(0, 3);

          return (
            <div
              key={g.key}
              className={`rounded-xl border transition-all ${
                isSelected
                  ? "bg-[#2A2A2A] border-white/20"
                  : "bg-[#1C1C1C] border-white/5 hover:bg-[#2A2A2A]/50"
              }`}
              onMouseEnter={() => setHovered(g.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <button
                onClick={() => setSelected(isSelected ? null : g.key)}
                className="w-full text-left p-4 flex items-start gap-3"
              >
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5"
                  style={{ backgroundColor: color }}
                >
                  {g.globalNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white">{g.element}</span>
                    <SeverityBadge result={g.repr} />
                    <span className="text-xs text-[#666666]">
                      {g.items.length}개 차이
                    </span>
                  </div>
                </div>
              </button>

              <div className="px-4 pb-4 pl-14 space-y-2">
                {visibleItems.map((item, idx) => {
                  const { icon, label } = propertyLabel(item.property);
                  return (
                    <div
                      key={idx}
                      className="rounded-lg bg-black/30 border border-white/[0.04] p-3"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-white/[0.08] text-white">
                          <span>{icon}</span>
                          <span>{label}</span>
                        </span>
                        <span className="text-[10px] text-[#666666] font-mono">
                          {item.property}
                        </span>
                        {item.severity && (
                          <SeverityBadge result={item} small />
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <ValuePill label="Figma" value={item.designValue} color="#FF0558" />
                        <svg
                          className="w-4 h-4 text-[#666666]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M17 8l4 4m0 0l-4 4m4-4H3"
                          />
                        </svg>
                        <ValuePill label="구현" value={item.implValue} color="#FFFFFF" />
                      </div>
                      {item.notes && (
                        <p className="mt-2 text-xs text-[#999999]">{item.notes}</p>
                      )}
                    </div>
                  );
                })}
                {!showAll && (
                  <button
                    onClick={() => {
                      const next = new Set(expanded);
                      next.add(g.key);
                      setExpanded(next);
                    }}
                    className="text-xs text-[#FF0558] font-bold hover:underline"
                  >
                    + {g.items.length - 3}개 더 보기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeverityBadge({ result, small = false }: { result: ComparisonResult; small?: boolean }) {
  const base = `inline-flex items-center gap-1 px-2 py-0.5 font-bold rounded-full ${
    small ? "text-[9px]" : "text-[10px]"
  }`;
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
  const isRgb = /^rgba?\(/i.test(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="text-[10px] uppercase tracking-wider font-bold"
        style={{ color }}
      >
        {label}
      </span>
      {(isHex || isRgb) && (
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
