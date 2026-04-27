import {
  DesignToken,
  ComparisonResult,
  DesignSystemToken,
  ElementType,
} from "./types";

/**
 * 색상 문자열을 정규형(소문자 hex)으로 변환.
 * 같은 색이 hex/rgb/rgba 형식만 다른 경우의 가짜 양성을 잡기 위함.
 */
function normalizeColor(value: string): string | null {
  if (!value) return null;
  const v = value.trim();

  // #RGB / #RRGGBB / #RRGGBBAA
  const hexMatch = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hexMatch) {
    let hex = hexMatch[1].toLowerCase();
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    if (hex.length === 8 && hex.slice(6) === "ff") {
      hex = hex.slice(0, 6);
    }
    return "#" + hex;
  }

  // rgb / rgba
  const rgbMatch = v.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i
  );
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, parseInt(n))).toString(16).padStart(2, "0");
    let hex = "#" + toHex(r) + toHex(g) + toHex(b);
    if (a !== undefined && parseFloat(a) < 1) {
      const alphaByte = Math.round(parseFloat(a) * 255)
        .toString(16)
        .padStart(2, "0");
      hex += alphaByte;
    }
    return hex.toLowerCase();
  }

  return null;
}

/**
 * 숫자(px, rem, % 등) 단위 정규화.
 */
function normalizeNumeric(value: string): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const m = v.match(/^(-?\d+(?:\.\d+)?)\s*(px|rem|em|%|pt|dp|sp)?$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2] || "px";
  if (num === 0) return "0";
  return `${num}${unit}`;
}

/**
 * 두 값이 의미적으로 같은지 (형식 차이만 있는지)
 */
function valuesEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = normalizeColor(a);
  const cb = normalizeColor(b);
  if (ca && cb && ca === cb) return true;
  const na = normalizeNumeric(a);
  const nb = normalizeNumeric(b);
  if (na && nb && na === nb) return true;
  return false;
}

/**
 * 숫자 값에서 px 단위의 차이를 측정 (severity 판정용).
 * 색상이거나 px 변환 불가하면 null.
 */
function pxDiff(a: string, b: string): number | null {
  const na = normalizeNumeric(a);
  const nb = normalizeNumeric(b);
  if (!na || !nb) return null;
  const ma = na.match(/^(-?\d+(?:\.\d+)?)/);
  const mb = nb.match(/^(-?\d+(?:\.\d+)?)/);
  if (!ma || !mb) return null;
  return Math.abs(parseFloat(ma[1]) - parseFloat(mb[1]));
}

/**
 * 두 element 이름의 유사도 (0~1).
 * - 정규화: 소문자 + 의미 없는 단어 제거
 * - 토큰 단위 Jaccard 유사도
 */
function nameSimilarity(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    const cleaned = s
      .toLowerCase()
      .replace(/[_\-/.,()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = cleaned.split(" ").filter((t) => t.length > 0);
    // 의미 없는 단어 제거
    const STOP = new Set([
      "frame", "group", "rectangle", "instance", "component",
      "the", "a", "an", "of", "and",
      "버튼", "텍스트", "박스",
    ]);
    return new Set(tokens.filter((t) => !STOP.has(t)));
  };

  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersect = 0;
  for (const t of sa) if (sb.has(t)) intersect++;
  const union = sa.size + sb.size - intersect;
  return intersect / union;
}

/**
 * Severity 판정 (디자인 vs 구현 값 비교).
 */
function judgeSeverity(
  property: string,
  designValue: string,
  implValue: string
): "critical" | "warning" | "info" {
  const p = property.toLowerCase();

  // 1. 형식만 다른 경우 → info
  if (valuesEquivalent(designValue, implValue)) return "info";

  // 2. 색상은 다르면 무조건 critical
  if (p.includes("color") || normalizeColor(designValue) !== null) {
    return "critical";
  }

  // 3. 숫자 차이로 판정
  const diff = pxDiff(designValue, implValue);
  if (diff !== null) {
    if (p.includes("font-size") || p === "font-size") {
      if (diff > 2) return "critical";
      if (diff >= 1) return "warning";
      return "info";
    }
    if (p.includes("padding") || p.includes("gap") || p.includes("spacing")) {
      if (diff > 4) return "critical";
      if (diff >= 1) return "warning";
      return "info";
    }
    if (p.includes("radius")) {
      if (diff > 2) return "critical";
      if (diff >= 1) return "warning";
      return "info";
    }
    if (p === "width" || p === "height") {
      if (diff > 8) return "critical";
      if (diff > 2) return "warning";
      return "info";
    }
    if (p.includes("border-width")) {
      if (diff >= 1) return "warning";
      return "info";
    }
    if (p.includes("line-height")) {
      if (diff > 4) return "warning";
      return "info";
    }
  }

  // 4. 그 외 (font-weight, font-family 등) → mismatch면 warning
  return "warning";
}

/**
 * notes 한국어 자동 생성
 */
function noteFor(r: ComparisonResult): string {
  if (r.status === "missing_in_impl") return "구현에 해당 속성이 없음";
  if (r.status === "extra_in_impl") return "디자인에는 없는 속성";
  if (r.status === "match") return "일치";
  if (r.severity === "info") {
    return `값은 같지만 표기 형식만 다름 (${r.designValue} ≡ ${r.implValue})`;
  }
  const p = (r.property || "").toLowerCase();
  if (p.includes("color")) return "색상이 다름";
  if (p.includes("font-size")) return "폰트 크기가 다름";
  if (p.includes("font-weight")) return "폰트 굵기가 다름";
  if (p.includes("font-family")) return "폰트 종류가 다름";
  if (p.includes("padding")) return "패딩이 다름";
  if (p.includes("gap")) return "간격이 다름";
  if (p.includes("radius")) return "보더 라운딩이 다름";
  if (p.includes("border-width")) return "보더 두께가 다름";
  if (p.includes("border")) return "보더가 다름";
  if (p === "width" || p === "height") return "사이즈가 다름";
  if (p.includes("line-height")) return "행간이 다름";
  return "값이 다름";
}

/**
 * 카탈로그 매칭 노트 추가 (있을 때만)
 */
function catalogNoteFor(
  value: string,
  catalog: DesignSystemToken[]
): string | null {
  const norm = normalizeColor(value);
  for (const t of catalog) {
    if (t.type !== "color") continue;
    const cn = normalizeColor(t.value);
    if (cn && norm && cn === norm) {
      return `카탈로그 토큰 "${t.name}" 사용`;
    }
  }
  return null;
}

/**
 * 토큰을 (elementType, property)로 그룹핑
 */
function groupByTypeProperty(
  tokens: DesignToken[]
): Map<string, DesignToken[]> {
  const map = new Map<string, DesignToken[]>();
  for (const t of tokens) {
    const key = `${t.elementType}:${t.property}`;
    const arr = map.get(key) || [];
    arr.push(t);
    map.set(key, arr);
  }
  return map;
}

/**
 * Greedy 매칭 — 같은 (elementType, property) 안에서
 * design 토큰 각각에 가장 비슷한 impl 토큰을 1개씩 짝지음.
 *
 * 매칭 점수:
 *  1. 값이 완전 같으면 +100
 *  2. 값이 의미적으로 같으면 +90 (info 후보)
 *  3. 이름 유사도 (0~50)
 *
 * 점수가 낮으면 (< 임계값) 매칭 안 함 → missing/extra 처리.
 */
interface MatchPair {
  design: DesignToken;
  impl: DesignToken | null;
  score: number;
}

const MIN_MATCH_SCORE = 15; // 이름 유사도 최소 30% (점수 15) 이상이면 매칭 후보

function matchWithinGroup(
  designs: DesignToken[],
  impls: DesignToken[]
): { pairs: MatchPair[]; unmatchedImpls: DesignToken[] } {
  const usedImpl = new Set<number>();
  const pairs: MatchPair[] = [];

  // 모든 design에 대해 가장 좋은 impl 찾기
  const candidates: Array<{
    designIdx: number;
    implIdx: number;
    score: number;
  }> = [];
  for (let di = 0; di < designs.length; di++) {
    const d = designs[di];
    for (let ii = 0; ii < impls.length; ii++) {
      const i = impls[ii];
      let score = 0;
      if (d.value === i.value) score += 100;
      else if (valuesEquivalent(d.value, i.value)) score += 90;
      score += nameSimilarity(d.element, i.element) * 50;
      candidates.push({ designIdx: di, implIdx: ii, score });
    }
  }

  // 점수 높은 순으로 그리디 매칭 (한 design - 한 impl 쌍씩)
  candidates.sort((a, b) => b.score - a.score);
  const usedDesign = new Set<number>();
  for (const c of candidates) {
    if (usedDesign.has(c.designIdx)) continue;
    if (usedImpl.has(c.implIdx)) continue;
    if (c.score < MIN_MATCH_SCORE) continue;
    pairs.push({
      design: designs[c.designIdx],
      impl: impls[c.implIdx],
      score: c.score,
    });
    usedDesign.add(c.designIdx);
    usedImpl.add(c.implIdx);
  }
  // 매칭 안 된 design들
  for (let di = 0; di < designs.length; di++) {
    if (!usedDesign.has(di)) {
      pairs.push({ design: designs[di], impl: null, score: 0 });
    }
  }
  // 매칭 안 된 impl들
  const unmatchedImpls: DesignToken[] = [];
  for (let ii = 0; ii < impls.length; ii++) {
    if (!usedImpl.has(ii)) unmatchedImpls.push(impls[ii]);
  }
  return { pairs, unmatchedImpls };
}

/**
 * 비교 결과 정렬 우선순위
 */
function sortResults(results: ComparisonResult[]): ComparisonResult[] {
  const statusOrder: Record<ComparisonResult["status"], number> = {
    mismatch: 0,
    missing_in_impl: 1,
    extra_in_impl: 2,
    match: 3,
  };
  const severityOrder: Record<ComparisonResult["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  const typeOrder: Record<ElementType, number> = {
    button: 0,
    heading: 1,
    card: 2,
    input: 3,
    tag: 4,
    image: 5,
    icon: 6,
    text: 7,
    container: 8,
    divider: 9,
    unknown: 10,
  };
  return [...results].sort((a, b) => {
    const sa = statusOrder[a.status];
    const sb = statusOrder[b.status];
    if (sa !== sb) return sa - sb;
    const va = severityOrder[a.severity];
    const vb = severityOrder[b.severity];
    if (va !== vb) return va - vb;
    const ta = a.elementType ? typeOrder[a.elementType] : 10;
    const tb = b.elementType ? typeOrder[b.elementType] : 10;
    return ta - tb;
  });
}

/**
 * 메인 비교 함수 — AI 호출 없음. 코드로 결정적 매칭.
 */
export async function compareTokens(
  designTokens: DesignToken[],
  implTokens: DesignToken[],
  catalog?: DesignSystemToken[]
): Promise<ComparisonResult[]> {
  const hasCatalog = !!(catalog && catalog.length > 0);
  const cat = catalog || [];

  // (elementType, property)별로 그룹핑
  const designGroups = groupByTypeProperty(designTokens);
  const implGroups = groupByTypeProperty(implTokens);

  const allKeys = new Set<string>([
    ...designGroups.keys(),
    ...implGroups.keys(),
  ]);

  const results: ComparisonResult[] = [];

  for (const key of allKeys) {
    const designs = designGroups.get(key) || [];
    const impls = implGroups.get(key) || [];

    if (designs.length > 0 && impls.length === 0) {
      // 모두 missing
      for (const d of designs) {
        results.push(makeMissing(d));
      }
      continue;
    }
    if (designs.length === 0 && impls.length > 0) {
      // 모두 extra
      for (const i of impls) {
        results.push(makeExtra(i));
      }
      continue;
    }

    const { pairs, unmatchedImpls } = matchWithinGroup(designs, impls);
    for (const p of pairs) {
      if (p.impl === null) {
        results.push(makeMissing(p.design));
      } else {
        results.push(makePair(p.design, p.impl, hasCatalog ? cat : []));
      }
    }
    for (const i of unmatchedImpls) {
      results.push(makeExtra(i));
    }
  }

  return sortResults(results);
}

function makeMissing(d: DesignToken): ComparisonResult {
  const r: ComparisonResult = {
    element: d.element,
    elementType: d.elementType,
    property: d.property,
    designValue: d.value,
    implValue: "",
    status: "missing_in_impl",
    severity: "critical",
    notes: "",
    nodeId: d.nodeId,
    bbox: d.bbox,
  };
  r.notes = noteFor(r);
  return r;
}

function makeExtra(i: DesignToken): ComparisonResult {
  const r: ComparisonResult = {
    element: i.element,
    elementType: i.elementType,
    property: i.property,
    designValue: "",
    implValue: i.value,
    status: "extra_in_impl",
    severity: "info",
    notes: "",
    nodeId: i.nodeId,
    bbox: i.bbox,
  };
  r.notes = noteFor(r);
  return r;
}

function makePair(
  d: DesignToken,
  i: DesignToken,
  catalog: DesignSystemToken[]
): ComparisonResult {
  const equivalent = valuesEquivalent(d.value, i.value);
  const exact = d.value === i.value;

  let status: ComparisonResult["status"];
  let severity: ComparisonResult["severity"];
  if (exact) {
    status = "match";
    severity = "info";
  } else if (equivalent) {
    status = "match";
    severity = "info";
  } else {
    status = "mismatch";
    severity = judgeSeverity(d.property, d.value, i.value);
  }

  const r: ComparisonResult = {
    element: d.element,
    elementType: d.elementType,
    property: d.property,
    designValue: d.value,
    implValue: i.value,
    status,
    severity,
    notes: "",
    nodeId: d.nodeId,
    bbox: d.bbox,
  };

  // 노트 생성
  let note = noteFor(r);
  if (catalog.length > 0 && status === "mismatch") {
    const designCatalog = catalogNoteFor(d.value, catalog);
    const implCatalog = catalogNoteFor(i.value, catalog);
    if (designCatalog && !implCatalog) {
      note = `${note} · 디자인은 ${designCatalog}, 구현은 카탈로그 미준수`;
      severity = "critical";
      r.severity = severity;
    } else if (designCatalog && implCatalog) {
      note = `${note} · 디자인 ${designCatalog} vs 구현 ${implCatalog}`;
    }
  }
  r.notes = note;
  return r;
}
