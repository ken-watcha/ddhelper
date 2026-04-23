import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

/**
 * Groq 모델 체인 (주 모델 실패 시 순차적 폴백)
 * - llama-3.3-70b: 품질 최상, 복잡한 JSON 추출에 강함
 * - llama-3.1-8b: 매우 빠름, 백업용
 * - gemma2-9b: 추가 백업
 */
const MODEL_CHAIN = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tryModel(
  modelName: string,
  systemPrompt: string,
  userContent: string,
  timeoutMs: number = 25000
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(new Error(`Model ${modelName} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  );

  const completion = await Promise.race([
    groq.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 8192,
    }),
    timeoutPromise,
  ]);

  return completion.choices[0]?.message?.content || "";
}

/**
 * 영문 에러 메시지를 사용자 친화적 한국어로 변환
 */
function toKoreanError(msg: string): string {
  // 할당량/레이트 리밋
  if (
    msg.includes("429") ||
    msg.includes("rate_limit") ||
    msg.includes("quota") ||
    msg.includes("Too Many Requests")
  ) {
    return "AI API 일일 할당량을 모두 사용했습니다. 내일 다시 시도하거나 API 키를 교체해주세요.";
  }

  // 인증 실패
  if (
    msg.includes("401") ||
    msg.includes("Unauthorized") ||
    msg.includes("Invalid API Key") ||
    msg.includes("invalid_api_key")
  ) {
    return "AI API 키 인증에 실패했습니다. 키가 올바른지 확인해주세요.";
  }

  // 권한 없음
  if (msg.includes("403") || msg.includes("Forbidden")) {
    return "AI API 접근 권한이 없습니다. 키의 권한 설정을 확인해주세요.";
  }

  // 서버 과부하
  if (
    msg.includes("503") ||
    msg.includes("Service Unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("UNAVAILABLE")
  ) {
    return "AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.";
  }

  // 타임아웃
  if (msg.includes("timed out") || msg.includes("timeout")) {
    return "AI 응답이 너무 오래 걸려 중단됐습니다. 입력이 복잡하거나 서버 부하가 높은 상황입니다. 다시 시도해주세요.";
  }

  // 네트워크 오류
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return "AI 서버 연결에 실패했습니다. 네트워크를 확인해주세요.";
  }

  // 요청 형식 오류
  if (msg.includes("400") || msg.includes("Bad Request")) {
    return "AI에 보낸 요청 형식이 올바르지 않습니다. 입력을 확인해주세요.";
  }

  // 서버 오류
  if (msg.includes("500") || msg.includes("502") || msg.includes("504")) {
    return "AI 서버에 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }

  // 모델 없음
  if (msg.includes("404") || msg.includes("not found") || msg.includes("model")) {
    return "AI 모델을 찾을 수 없습니다. 잠시 후 다시 시도해주세요.";
  }

  // 컨텐츠 안전 필터
  if (msg.includes("safety") || msg.includes("blocked")) {
    return "AI가 이 입력을 처리할 수 없다고 판단했습니다. 다른 내용으로 시도해주세요.";
  }

  // 위 카테고리에 없으면 원본 첫 줄만 반환
  return msg.split("\n")[0] || "알 수 없는 오류";
}

export async function analyzeWithAI(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  let lastError: Error | null = null;

  for (const modelName of MODEL_CHAIN) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await tryModel(modelName, systemPrompt, userContent);
      } catch (err) {
        lastError = err as Error;
        const msg = lastError.message || "";

        // 모델 없음/할당량 초과: 즉시 다음 모델
        if (
          msg.includes("404") ||
          msg.includes("not found") ||
          msg.includes("429") ||
          msg.includes("rate_limit") ||
          msg.includes("quota")
        ) {
          break;
        }

        // 서버 과부하(503): 짧게 대기 후 재시도
        if (
          msg.includes("503") ||
          msg.includes("Service Unavailable") ||
          msg.includes("overloaded")
        ) {
          if (attempt < 2) {
            await sleep(500);
            continue;
          }
          break;
        }

        // 타임아웃: 다음 모델로
        if (msg.includes("timed out")) {
          break;
        }

        break;
      }
    }
  }

  // 모든 모델이 실패했을 때: 마지막 에러를 한국어로 변환
  const koreanMsg = lastError
    ? toKoreanError(lastError.message)
    : "알 수 없는 오류";
  throw new Error(koreanMsg);
}

/**
 * 관대한 JSON 파서: 잘리거나 마크다운에 감싸진 응답도 복구
 */
export function parseJsonFromResponse<T>(text: string): T {
  const trimmed = text.trim();

  // 1. 직접 파싱
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. 마크다운 코드 블록 제거
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // 3. 배열 시작(`[`) 찾아서 복구 시도
  const arrayStart = trimmed.indexOf("[");
  if (arrayStart !== -1) {
    const arrayText = trimmed.slice(arrayStart);
    const repaired = repairTruncatedArray(arrayText);
    if (repaired) {
      try {
        return JSON.parse(repaired) as T;
      } catch {}
    }
  }

  // 4. 객체 시작 찾아서 복구
  const objectStart = trimmed.indexOf("{");
  if (objectStart !== -1) {
    const objText = trimmed.slice(objectStart);
    try {
      const obj = JSON.parse(objText) as Record<string, unknown>;
      // Groq가 객체로 감싼 경우 (예: {"tokens": [...]})
      if (obj && typeof obj === "object") {
        for (const val of Object.values(obj)) {
          if (Array.isArray(val)) return val as T;
        }
        return obj as T;
      }
    } catch {}
  }

  const preview = trimmed.slice(0, 200);
  throw new Error(`JSON 파싱 실패. 응답 미리보기: ${preview}...`);
}

/**
 * 잘린 JSON 배열을 수리: 마지막 완전한 객체까지만 남기고 닫기
 */
function repairTruncatedArray(text: string): string | null {
  if (!text.startsWith("[")) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteObjectEnd = -1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 1 && c === "}") {
        lastCompleteObjectEnd = i;
      }
      if (depth === 0 && c === "]") {
        return text.slice(0, i + 1);
      }
    }
  }

  if (lastCompleteObjectEnd !== -1) {
    return text.slice(0, lastCompleteObjectEnd + 1) + "]";
  }

  return "[]";
}
