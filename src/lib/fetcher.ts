/**
 * 안전한 JSON POST 래퍼:
 * - Vercel 타임아웃/크래시 시 HTML/텍스트 에러도 깔끔하게 처리
 * - 항상 의미 있는 한국어 에러 메시지를 던짐
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(
      `네트워크 연결 실패: ${
        networkErr instanceof Error ? networkErr.message : "알 수 없는 오류"
      }`
    );
  }

  const contentType = res.headers.get("content-type") || "";
  const text = await res.text();

  // JSON이 아닌 응답 (HTML 에러 페이지, 플레인 텍스트 등)
  if (!contentType.includes("application/json")) {
    // 서버리스 함수 타임아웃 (Vercel이 504/HTML 에러 페이지 반환)
    if (res.status === 504 || text.includes("FUNCTION_INVOCATION_TIMEOUT")) {
      // 어떤 API인지에 따라 안내 다름
      if (url.includes("/api/figma")) {
        throw new Error(
          "분석 시간이 초과됐습니다. 페이지 안에 시안이 너무 많거나 Figma 응답이 큰 경우입니다. 특정 프레임 URL로 다시 시도해보거나, 시안 수가 적은 페이지로 시도해주세요."
        );
      }
      if (url.includes("/api/extract-web")) {
        throw new Error(
          "웹 페이지 분석 시간이 초과됐습니다. URL 응답이 너무 크거나 서버가 느릴 수 있어요. 잠시 후 다시 시도해주세요."
        );
      }
      if (url.includes("/api/compare")) {
        throw new Error(
          "비교 분석 시간이 초과됐습니다. 토큰 수가 너무 많거나 AI 서버 부하가 높을 수 있어요. 잠시 후 다시 시도해주세요."
        );
      }
      throw new Error(
        "요청 시간이 초과됐습니다. 잠시 후 다시 시도해주세요."
      );
    }
    if (res.status >= 500) {
      throw new Error(
        `서버 오류 (${res.status}): 잠시 후 다시 시도해주세요.`
      );
    }
    // 에러 텍스트 앞부분만 뽑기
    const preview = text.replace(/<[^>]*>/g, "").trim().slice(0, 150);
    throw new Error(`요청 실패 (${res.status}): ${preview || "응답이 비었습니다"}`);
  }

  // JSON 응답 파싱
  let data: { error?: string } & T;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `서버 응답을 해석할 수 없습니다. (status ${res.status})`
    );
  }

  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }

  return data;
}
