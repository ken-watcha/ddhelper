/**
 * 클라이언트(브라우저) 측 — DDhelper Capture 확장과 통신.
 *
 * 동작:
 * - 확장의 content script가 페이지 로드 시 "__DDHELPER_EXT_READY__" 메시지를 postMessage로 보냄
 * - 페이지가 그 메시지를 받아 확장 ID를 보관
 * - 도구가 캡처가 필요할 때 chrome.runtime.sendMessage(extensionId, ...) 호출
 *
 * 확장이 설치돼 있지 않으면 throw — 호출자는 fallback(서버 헤드리스) 또는 안내 처리.
 */
import { useCallback, useEffect, useState } from "react";
import type { StagingCaptureItem } from "./types";

export interface ExtensionInfo {
  id: string;
  version: string;
}

interface ChromeRuntimeWindow {
  chrome?: {
    runtime?: {
      sendMessage: (
        extensionId: string,
        message: unknown,
        callback?: (response: unknown) => void
      ) => void;
      lastError?: { message?: string };
    };
  };
}

/**
 * React hook — 확장 설치 여부 + ID 감지.
 * content script가 announce하는 메시지를 받아 state 갱신.
 *
 * - 미연결 상태일 때는 3초마다 자동 ping → 사용자가 확장 새로고침하면 즉시 감지
 * - retry()를 호출하면 즉시 재시도 가능
 */
export function useExtensionInfo(): {
  info: ExtensionInfo | null;
  retry: () => void;
} {
  const [info, setInfo] = useState<ExtensionInfo | null>(null);

  const retry = useCallback(() => {
    if (typeof window === "undefined") return;
    window.postMessage({ type: "__DDHELPER_EXT_PING__" }, "*");
  }, []);

  // 메시지 리스너
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handler = (e: MessageEvent) => {
      if (e.source !== window) return;
      const data = e.data as
        | { type?: string; extensionId?: string; version?: string }
        | undefined;
      if (data?.type === "__DDHELPER_EXT_READY__" && data.extensionId) {
        setInfo({
          id: data.extensionId,
          version: data.version || "?",
        });
      }
    };
    window.addEventListener("message", handler);
    // 페이지 진입 시 즉시 ping
    retry();

    return () => window.removeEventListener("message", handler);
  }, [retry]);

  // 미연결 상태에서 자동 polling (3초 간격)
  useEffect(() => {
    if (info) return; // 연결됐으면 polling 중지
    if (typeof window === "undefined") return;
    const id = setInterval(retry, 3000);
    return () => clearInterval(id);
  }, [info, retry]);

  return { info, retry };
}

/**
 * 확장에 캡처 요청. 확장이 없거나 통신 실패 시 throw.
 */
export async function captureViaExtension(
  extensionId: string,
  url: string,
  viewports: { width: number; height: number }[]
): Promise<StagingCaptureItem[]> {
  if (typeof window === "undefined") {
    throw new Error("브라우저 환경이 아닙니다");
  }
  const w = window as unknown as ChromeRuntimeWindow;
  const sendMessage = w.chrome?.runtime?.sendMessage;
  if (!sendMessage) {
    throw new Error(
      "크롬 환경이 아니거나 확장 API에 접근할 수 없습니다 (Chrome 브라우저로 접속해주세요)"
    );
  }

  return new Promise((resolve, reject) => {
    sendMessage(
      extensionId,
      { action: "captureStaging", url, viewports },
      (response: unknown) => {
        const lastError = w.chrome?.runtime?.lastError;
        if (lastError) {
          reject(new Error(lastError.message || "확장 통신 실패"));
          return;
        }
        const r = response as
          | {
              ok: boolean;
              results?: StagingCaptureItem[];
              error?: string;
            }
          | undefined;
        if (!r || !r.ok) {
          reject(new Error(r?.error || "캡처 실패"));
          return;
        }
        resolve(r.results || []);
      }
    );
  });
}
