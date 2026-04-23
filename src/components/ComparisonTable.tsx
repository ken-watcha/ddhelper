"use client";

import { ComparisonResult } from "@/lib/types";

export default function ComparisonTable({
  results,
  summary,
  hideSummary = false,
}: {
  results: ComparisonResult[];
  summary: {
    critical: number;
    warning: number;
    info: number;
    match: number;
    missing: number;
    total: number;
  };
  hideSummary?: boolean;
}) {
  const rowStyle = (result: ComparisonResult) => {
    if (result.status === "match") return "";
    if (result.severity === "critical") return "bg-[#EF4444]/[0.06]";
    if (result.severity === "warning") return "bg-[#FFB800]/[0.06]";
    if (result.status === "missing_in_impl") return "bg-white/[0.02]";
    return "";
  };

  const statusBadge = (result: ComparisonResult) => {
    const base = "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full whitespace-nowrap";
    if (result.status === "match")
      return (
        <span className={`${base} bg-[#22C55E]/15 text-[#22C55E]`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
          일치
        </span>
      );
    if (result.severity === "critical")
      return (
        <span className={`${base} bg-[#EF4444]/15 text-[#EF4444]`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
          심각
        </span>
      );
    if (result.severity === "warning")
      return (
        <span className={`${base} bg-[#FFB800]/15 text-[#FFB800]`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#FFB800]" />
          주의
        </span>
      );
    if (result.status === "missing_in_impl")
      return (
        <span className={`${base} bg-white/10 text-neutral-400`}>
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
          누락
        </span>
      );
    return (
      <span className={`${base} bg-[#FF0558]/15 text-[#FF0558]`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#FF0558]" />
        참고
      </span>
    );
  };

  return (
    <div>
      {!hideSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryCard label="심각" count={summary.critical} color="#EF4444" />
          <SummaryCard label="주의" count={summary.warning} color="#FFB800" />
          <SummaryCard label="누락" count={summary.missing} color="#A3A3A3" />
          <SummaryCard label="일치" count={summary.match} color="#22C55E" />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-white/[0.06] bg-[#0A0A0A]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#141414] text-left border-b border-white/[0.06]">
              <th className="px-4 py-3 font-bold text-neutral-500 text-xs uppercase tracking-wider">
                상태
              </th>
              <th className="px-4 py-3 font-bold text-neutral-500 text-xs uppercase tracking-wider">
                요소
              </th>
              <th className="px-4 py-3 font-bold text-neutral-500 text-xs uppercase tracking-wider">
                속성
              </th>
              <th className="px-4 py-3 font-bold text-neutral-500 text-xs uppercase tracking-wider">
                Figma
              </th>
              <th className="px-4 py-3 font-bold text-neutral-500 text-xs uppercase tracking-wider">
                구현
              </th>
              <th className="px-4 py-3 font-bold text-neutral-500 text-xs uppercase tracking-wider">
                메모
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, i) => (
              <tr
                key={i}
                className={`${rowStyle(result)} border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors`}
              >
                <td className="px-4 py-3.5">{statusBadge(result)}</td>
                <td className="px-4 py-3.5 font-medium text-white">
                  {result.element}
                </td>
                <td className="px-4 py-3.5 text-neutral-400 text-xs">
                  {result.property}
                </td>
                <td className="px-4 py-3.5">
                  <ValueBadge value={result.designValue} />
                </td>
                <td className="px-4 py-3.5">
                  <ValueBadge value={result.implValue} />
                </td>
                <td className="px-4 py-3.5 text-neutral-500 text-xs max-w-xs">
                  {result.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function ValueBadge({ value }: { value: string }) {
  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      {isHex && (
        <span
          className="w-3 h-3 rounded-sm border border-white/20"
          style={{ background: value }}
        />
      )}
      <span className="bg-white/5 px-2 py-1 rounded-md text-white whitespace-nowrap">
        {value}
      </span>
    </span>
  );
}
