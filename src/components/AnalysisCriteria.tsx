"use client";

import { useState } from "react";

export default function AnalysisCriteria({
  hasCatalog,
}: {
  hasCatalog: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#0A0A0A] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#FF0558]/10 border border-[#FF0558]/20 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-[#FF0558]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="text-left">
            <h4 className="text-sm font-bold text-white">
              AI가 어떤 기준으로 분석했나요?
            </h4>
            <p className="text-[12px] text-neutral-500 mt-0.5">
              매칭 규칙, 심각도 기준을 투명하게 공개합니다
            </p>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-neutral-400 transform transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-5 py-5 space-y-6">
          {/* 1. 매칭 규칙 */}
          <Section title="1. 매칭 규칙" icon="🎯">
            <p className="text-[13px] text-neutral-400 leading-relaxed mb-3">
              Figma 토큰과 구현 토큰을 아래 순서로 짝지어 비교합니다.
            </p>
            <ol className="space-y-2 text-[13px]">
              <RuleItem
                num="1"
                title="같은 요소 타입끼리만 비교"
                detail="버튼↔버튼, 카드↔카드, 헤딩↔헤딩. 절대 버튼↔텍스트 같은 교차 매칭 없음."
              />
              <RuleItem
                num="2"
                title="같은 속성끼리만 비교"
                detail="background-color ↔ background-color, font-size ↔ font-size"
              />
              <RuleItem
                num="3"
                title="요소 이름은 의미 기반 퍼지 매칭"
                detail='"Primary CTA Button" ↔ "Play Button" 처럼 의미가 같으면 매칭. hero/cta/primary/main 같은 키워드가 연결됨.'
              />
              <RuleItem
                num="4"
                title="값 형식 차이는 동등하게 처리"
                detail="#FF0558 = rgb(255,5,88) = rgba(255,5,88,1) — 같은 색상으로 인식"
              />
            </ol>
          </Section>

          {/* 2. 요소 타입 분류 */}
          <Section title="2. 요소 타입 분류 기준" icon="🏷️">
            <p className="text-[13px] text-neutral-400 leading-relaxed mb-3">
              AI는 각 요소를 10가지 중 하나로 분류하고, 타입별 정해진 속성만
              추출합니다.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <TypeItem
                type="button"
                label="버튼"
                detail="bg + text, 높이<60px, 이름에 Button/CTA 포함"
              />
              <TypeItem
                type="heading"
                label="헤딩"
                detail="TEXT 타입, fontSize ≥ 20px"
              />
              <TypeItem
                type="text"
                label="본문"
                detail="TEXT 타입, 작은 fontSize"
              />
              <TypeItem
                type="card"
                label="카드"
                detail="bg + radius + padding, 자식 노드 있음"
              />
              <TypeItem
                type="container"
                label="컨테이너"
                detail="bg 없는 레이아웃 래퍼"
              />
              <TypeItem
                type="icon"
                label="아이콘"
                detail="≤32px 작은 그래픽"
              />
              <TypeItem
                type="image"
                label="이미지"
                detail="이미지 fill 있는 사각형"
              />
              <TypeItem
                type="input"
                label="입력 필드"
                detail="텍스트 필드 스타일"
              />
              <TypeItem
                type="tag"
                label="태그"
                detail="작은 pill 모양 (radius + small)"
              />
              <TypeItem
                type="divider"
                label="구분선"
                detail="얇은 사각형 (높이 < 4px)"
              />
            </div>
          </Section>

          {/* 3. 심각도 기준 */}
          <Section title="3. 심각도 판정 기준" icon="⚠️">
            <div className="overflow-hidden rounded-xl border border-white/[0.06]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-[#141414] text-left">
                    <th className="px-4 py-2.5 font-bold text-neutral-500 text-[11px] uppercase tracking-wider">
                      심각도
                    </th>
                    <th className="px-4 py-2.5 font-bold text-neutral-500 text-[11px] uppercase tracking-wider">
                      조건
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-white/[0.04]">
                    <td className="px-4 py-3">
                      <SeverityTag severity="critical" label="심각" />
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      컬러 불일치 · 폰트 크기 <span className="text-white font-mono">&gt;2px</span>{" "}
                      · 간격 <span className="text-white font-mono">&gt;4px</span> · 보더 라운딩{" "}
                      <span className="text-white font-mono">&gt;2px</span>
                    </td>
                  </tr>
                  <tr className="border-t border-white/[0.04]">
                    <td className="px-4 py-3">
                      <SeverityTag severity="warning" label="주의" />
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      폰트 <span className="text-white font-mono">1-2px</span> · 간격{" "}
                      <span className="text-white font-mono">1-4px</span> · 라운딩{" "}
                      <span className="text-white font-mono">1-2px</span>
                    </td>
                  </tr>
                  <tr className="border-t border-white/[0.04]">
                    <td className="px-4 py-3">
                      <SeverityTag severity="info" label="참고" />
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      값은 같은데 형식만 다름 (예:{" "}
                      <span className="font-mono text-white">#FF0558</span> vs{" "}
                      <span className="font-mono text-white">rgb(255,5,88)</span>)
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          {/* 4. 상태 분류 */}
          <Section title="4. 상태 분류" icon="📊">
            <div className="space-y-2 text-[13px]">
              <StatusItem
                color="#22C55E"
                label="일치 (match)"
                detail="디자인과 구현의 값이 같음"
              />
              <StatusItem
                color="#EF4444"
                label="불일치 (mismatch) — 가장 중요"
                detail="같은 요소+속성인데 값이 다름"
              />
              <StatusItem
                color="#A3A3A3"
                label="누락 (missing_in_impl)"
                detail="디자인에 있는데 구현에는 없음"
              />
              <StatusItem
                color="#A3A3A3"
                label="추가 (extra_in_impl)"
                detail="구현에 있는데 디자인에는 없음 (대체로 OK)"
              />
            </div>
          </Section>

          {/* 5. 디자인 시스템 카탈로그 (있을 때만) */}
          {hasCatalog && (
            <Section title="5. 디자인 시스템 카탈로그 활용" icon="📚">
              <p className="text-[13px] text-neutral-400 leading-relaxed mb-3">
                이 비교에는 피그마의 공식 디자인 시스템 토큰이 포함되어 있어요. AI가 추가로:
              </p>
              <ul className="space-y-2 text-[13px] text-neutral-300">
                <li className="flex gap-2">
                  <span className="text-[#FF0558] font-bold shrink-0">•</span>
                  <span>디자인이 카탈로그 토큰(예: <span className="text-[#FF0558] font-mono">Brand/Pink</span>)을 사용하면 이름을 노트에 표시</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#FF0558] font-bold shrink-0">•</span>
                  <span>디자인은 카탈로그 토큰을 썼는데 구현은 raw 값을 썼을 경우 → <span className="text-[#EF4444] font-bold">critical</span>로 표시 (&quot;디자인 시스템 토큰 미준수&quot;)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#FF0558] font-bold shrink-0">•</span>
                  <span>구현 값이 카탈로그의 다른 토큰과 일치한다면 그 토큰 이름도 알려줌</span>
                </li>
              </ul>
            </Section>
          )}

          {/* 6. 한계 */}
          <Section title={hasCatalog ? "6. 현재 한계" : "5. 현재 한계"} icon="⚡">
            <ul className="space-y-2 text-[13px] text-neutral-400">
              <li className="flex gap-2">
                <span className="text-neutral-600 shrink-0">·</span>
                <span>AI가 요소 타입을 잘못 분류할 수 있음 (예: 작은 버튼을 tag로 판정)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neutral-600 shrink-0">·</span>
                <span>이름 매칭이 AI의 주관적 판단에 의존</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neutral-600 shrink-0">·</span>
                <span>웹은 초기 HTML에 포함된 스타일만 분석 (외부 CSS/JS 렌더링 미지원)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-neutral-600 shrink-0">·</span>
                <span>hover/focus/다크모드 같은 상태별 스타일은 비교 대상 아님</span>
              </li>
            </ul>
          </Section>

          {/* 모델 정보 */}
          <div className="pt-3 border-t border-white/[0.04]">
            <p className="text-[11px] text-neutral-600">
              분석 모델: Llama 3.3 70B (Groq) · 온도 0.1 (결정적 응답)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h5 className="text-[13px] font-bold text-white mb-3 flex items-center gap-2">
        <span>{icon}</span>
        {title}
      </h5>
      {children}
    </div>
  );
}

function RuleItem({
  num,
  title,
  detail,
}: {
  num: string;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="w-5 h-5 rounded-full bg-[#FF0558]/15 text-[#FF0558] font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
        {num}
      </span>
      <div>
        <span className="text-white font-medium">{title}</span>
        <p className="text-neutral-500 text-[12px] mt-0.5">{detail}</p>
      </div>
    </li>
  );
}

function TypeItem({
  type,
  label,
  detail,
}: {
  type: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="bg-[#141414] border border-white/[0.04] rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[11px] text-[#FF0558] bg-[#FF0558]/10 px-1.5 py-0.5 rounded">
          {type}
        </span>
        <span className="text-white font-medium text-[13px]">{label}</span>
      </div>
      <p className="text-neutral-500 text-[11px]">{detail}</p>
    </div>
  );
}

function SeverityTag({
  severity,
  label,
}: {
  severity: "critical" | "warning" | "info";
  label: string;
}) {
  const base = "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-bold rounded-full whitespace-nowrap";
  if (severity === "critical")
    return (
      <span className={`${base} bg-[#EF4444]/15 text-[#EF4444]`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" />
        {label}
      </span>
    );
  if (severity === "warning")
    return (
      <span className={`${base} bg-[#FFB800]/15 text-[#FFB800]`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#FFB800]" />
        {label}
      </span>
    );
  return (
    <span className={`${base} bg-[#FF0558]/15 text-[#FF0558]`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#FF0558]" />
      {label}
    </span>
  );
}

function StatusItem({
  color,
  label,
  detail,
}: {
  color: string;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3">
      <span
        className="w-2 h-2 rounded-full shrink-0 mt-1.5"
        style={{ background: color }}
      />
      <div>
        <span className="text-white font-medium">{label}</span>
        <p className="text-neutral-500 text-[12px] mt-0.5">{detail}</p>
      </div>
    </div>
  );
}
