import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

/**
 * Groq 모델 체인
 * - 70B가 품질 최상 (의미 기반 매칭에 중요) → 주 모델
 * - 8B는 TPM 초과 시 폴백
 */
const MODEL_CHAIN = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 에러 메시지에서 "try again in Xs" 패턴의 대기 시간 추출
 */
function extractRetryAfter(msg: string): number | null {
  const match = msg.match(/try again in (\d+\.?\d*)\s*s/i);
  if (match) return parseFloat(match[1]);
  return null;
}

async function tryModel(
  modelName: string,
  systemPrompt: string,
  userContent: string,
  timeoutMs: number = 20000
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
      temperature: 0.1,
      max_tokens: 1024,
    }),
    timeoutPromise,
  ]);

  return completion.choices[0]?.message?.content || "";
}

export async function analyzeWithAI(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  let lastError: Error | null = null;

  for (let modelIdx = 0; modelIdx < MODEL_CHAIN.length; modelIdx++) {
    const modelName = MODEL_CHAIN[modelIdx];

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await tryModel(modelName, systemPrompt, userContent);
      } catch (err) {
        lastError = err as Error;
        const msg = lastError.message || "";

        // 모델 없음: 다음 모델
        if (msg.includes("404") || msg.includes("not found") || msg.includes("model_decommissioned")) {
          break;
        }

        // 일일 할당량 초과: 다음 모델 (별도 버킷)
        if (
          msg.includes("tokens per day") ||
          msg.includes("requests per day") ||
          msg.includes("TPD") ||
          msg.includes("RPD") ||
          msg.includes("daily")
        ) {
          break;
        }

        // 분당 한도: retry-after가 짧으면 기다렸다 재시도
        if (
          msg.includes("429") ||
          msg.includes("rate_limit") ||
          msg.includes("Too Many Requests")
        ) {
          const waitSec = extractRetryAfter(msg);
          // 60초 이하면 기다렸다 같은 모델 재시도 (Vercel maxDuration 300초 안에서 안전)
          if (waitSec !== null && waitSec <= 60 && attempt === 1) {
            await sleep(Math.min(waitSec * 1000 + 500, 65000));
            continue;
          }
          // retry-after 정보 없거나 너무 길면 다음 모델 (별도 버킷이라 즉시 가능할 수 있음)
          break;
        }

        // 서버 과부하: 짧게 대기
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

        // 타임아웃: 다음 모델
        if (msg.includes("timed out")) {
          break;
        }

        break;
      }
    }
  }

  const koreanMsg = lastError
    ? toKoreanError(lastError.message)
    : "알 수 없는 오류";
  throw new Error(koreanMsg);
}

/**
 * 영문 에러 메시지를 사용자 친화적 한국어로 변환
 */
function toKoreanError(msg: string): string {
  // 분당 토큰/요청 한도
  if (
    msg.includes("tokens per minute") ||
    msg.includes("requests per minute") ||
    msg.includes("TPM") ||
    msg.includes("RPM") ||
    /rate_limit.*minute/i.test(msg)
  ) {
    const waitSec = extractRetryAfter(msg);
    const wait = waitSec
      ? ` 약 ${Math.ceil(waitSec)}초 후 다시 시도해주세요.`
      : " 잠시 후 다시 시도해주세요.";
    return `AI 분당 사용량을 초과했습니다.${wait}`;
  }

  // 일일 한도
  if (
    msg.includes("tokens per day") ||
    msg.includes("requests per day") ||
    msg.includes("TPD") ||
    msg.includes("RPD") ||
    msg.includes("daily") ||
    msg.includes("quota")
  ) {
    return "AI 일일 할당량을 모두 사용했습니다. 내일 다시 시도하거나 API 키를 교체해주세요.";
  }

  // 일반 429
  if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("Too Many Requests")) {
    const waitSec = extractRetryAfter(msg);
    const wait = waitSec ? ` 약 ${Math.ceil(waitSec)}초 후` : " 1-2분 후";
    return `AI 사용량이 잠시 초과됐어요.${wait} 다시 시도해주세요.`;
  }

  // 인증
  if (
    msg.includes("401") ||
    msg.includes("Unauthorized") ||
    msg.includes("Invalid API Key") ||
    msg.includes("invalid_api_key")
  ) {
    return "AI API 키 인증에 실패했습니다.";
  }

  if (msg.includes("403") || msg.includes("Forbidden")) {
    return "AI API 접근 권한이 없습니다.";
  }

  // 서버 과부하
  if (
    msg.includes("503") ||
    msg.includes("Service Unavailable") ||
    msg.includes("overloaded")
  ) {
    return "AI 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.";
  }

  if (msg.includes("timed out") || msg.includes("timeout")) {
    return "AI 응답이 너무 오래 걸려 중단됐습니다. 다시 시도해주세요.";
  }

  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return "AI 서버 연결에 실패했습니다. 네트워크를 확인해주세요.";
  }

  // 컨텍스트 초과
  if (
    msg.includes("context_length_exceeded") ||
    msg.includes("maximum context") ||
    msg.includes("too long")
  ) {
    return "입력이 너무 깁니다. 더 작은 피그마 프레임이나 단일 화면 URL로 시도해주세요.";
  }

  if (msg.includes("400") || msg.includes("Bad Request")) {
    return "AI가 입력을 처리하지 못했습니다. 피그마 프레임이 너무 복잡하거나 웹 페이지가 크면 발생할 수 있어요. 더 작은 범위로 시도해주세요.";
  }

  if (msg.includes("500") || msg.includes("502") || msg.includes("504")) {
    return "AI 서버에 일시적 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }

  if (msg.includes("404") || msg.includes("not found") || msg.includes("model")) {
    return "AI 모델을 찾을 수 없습니다. 잠시 후 다시 시도해주세요.";
  }

  if (msg.includes("safety") || msg.includes("blocked")) {
    return "AI가 이 입력을 처리할 수 없다고 판단했습니다.";
  }

  return msg.split("\n")[0] || "알 수 없는 오류";
}

/**
 * 관대한 JSON 파서
 */
export function parseJsonFromResponse<T>(text: string): T {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

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

  const objectStart = trimmed.indexOf("{");
  if (objectStart !== -1) {
    const objText = trimmed.slice(objectStart);
    try {
      const obj = JSON.parse(objText) as Record<string, unknown>;
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
