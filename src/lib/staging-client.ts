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
import type { StagingCaptureItem, DesignToken } from "./types";
import { stitchClientSide } from "./client-stitch";

interface RawCaptureFromExt {
  slices: { dataUrl: string; scrollY: number }[];
  pageWidth: number;
  pageHeight: number;
  clientHeight: number;
}

interface RawCaptureItem {
  viewport: { width: number; height: number };
  capture: RawCaptureFromExt | null;
  error?: string;
}

export interface ExtensionInfo {
  id: string;
  version: string;
}

interface ChromeRuntimePort {
  postMessage: (msg: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (cb: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
}

interface ChromeRuntimeWindow {
  chrome?: {
    runtime?: {
      sendMessage: (
        extensionId: string,
        message: unknown,
        callback?: (response: unknown) => void
      ) => void;
      connect: (
        extensionId: string,
        connectInfo?: { name?: string }
      ) => ChromeRuntimePort;
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

export interface ExtensionCaptureResult {
  results: StagingCaptureItem[];
  tokens: DesignToken[];
}

/**
 * 확장에 캡처 + 토큰 추출 요청. 확장이 없거나 통신 실패 시 throw.
 *
 * 토큰 추출은 첫 viewport에서 1회만 실행 (DOM 구조는 viewport마다 거의 같음).
 * AI 호출 없이 DOM의 computed style을 직접 읽어 토큰화 → rate limit 부담 0.
 */
/**
 * 버전 문자열 비교 — "0.4.0" >= "0.3.5" 같은 비교
 */
function versionGte(a: string, b: string): boolean {
  const ap = a.split(".").map((n) => parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] || 0;
    const bv = bp[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

const REQUIRED_EXT_VERSION = "0.4.0";

/**
 * 확장에 ping 한 번 던져 service worker 응답 여부 확인.
 * 캡처 시작 전에 호출해서 SW가 살아있는지 빠르게 검증.
 */
/**
 * Port 기반 ping — 캡처와 동일한 통신 채널 사용. 캡처 disconnect 에러가
 * sendMessage(ping)는 통과하는데 connect+port는 막히는 이슈인지 진단.
 */
export async function pingExtensionViaPort(
  extensionId: string
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (typeof window === "undefined") {
    return { ok: false, error: "브라우저 환경 아님" };
  }
  const w = window as unknown as ChromeRuntimeWindow;
  const connect = w.chrome?.runtime?.connect;
  if (!connect) {
    return { ok: false, error: "Chrome 확장 API 접근 불가" };
  }

  return new Promise((resolve) => {
    let port: ChromeRuntimePort;
    try {
      port = connect(extensionId, { name: "ddhelper-capture" });
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : "connect 실패",
      });
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {}
      resolve({ ok: false, error: "Port 응답 없음 (5초 timeout)" });
    }, 5000);

    port.onMessage.addListener((response: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        port.disconnect();
      } catch {}
      const r = response as
        | { ok: boolean; version?: string; error?: string }
        | undefined;
      if (!r || !r.ok) {
        resolve({ ok: false, error: r?.error || "ping 실패" });
        return;
      }
      resolve({ ok: true, version: r.version });
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const lastError = w.chrome?.runtime?.lastError;
      resolve({
        ok: false,
        error: lastError?.message || "Port 연결이 응답 전에 끊김",
      });
    });

    port.postMessage({ action: "ping" });
  });
}

export async function pingExtension(
  extensionId: string
): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (typeof window === "undefined") {
    return { ok: false, error: "브라우저 환경 아님" };
  }
  const w = window as unknown as ChromeRuntimeWindow;
  const sendMessage = w.chrome?.runtime?.sendMessage;
  if (!sendMessage) {
    return { ok: false, error: "Chrome 확장 API 접근 불가" };
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "확장 응답 없음 (5초 timeout)" });
    }, 5000);

    sendMessage(extensionId, { action: "ping" }, (response: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const lastError = w.chrome?.runtime?.lastError;
      if (lastError) {
        resolve({ ok: false, error: lastError.message || "통신 실패" });
        return;
      }
      const r = response as
        | { ok: boolean; version?: string; error?: string }
        | undefined;
      if (!r || !r.ok) {
        resolve({ ok: false, error: r?.error || "ping 실패" });
        return;
      }
      resolve({ ok: true, version: r.version });
    });
  });
}

export async function captureViaExtension(
  extensionId: string,
  url: string,
  viewports: { width: number; height: number }[],
  extensionVersion?: string
): Promise<ExtensionCaptureResult> {
  if (typeof window === "undefined") {
    throw new Error("브라우저 환경이 아닙니다");
  }
  const w = window as unknown as ChromeRuntimeWindow;
  const connect = w.chrome?.runtime?.connect;
  if (!connect) {
    throw new Error(
      "크롬 환경이 아니거나 확장 API에 접근할 수 없습니다 (Chrome 브라우저로 접속해주세요)"
    );
  }

  // 확장 버전 검사 — 새 포트 프로토콜은 v0.4.0+ 만 지원
  if (extensionVersion && !versionGte(extensionVersion, REQUIRED_EXT_VERSION)) {
    throw new Error(
      `DDhelper Capture 확장이 옛날 버전(v${extensionVersion})이라 동작하지 않아요. ` +
        `[chrome://extensions]에서 새로고침(↻)하면 v${REQUIRED_EXT_VERSION} 이상으로 갱신됩니다. ` +
        `이미 새로고침했다면 이 페이지를 Cmd+Shift+R로 강제 새로고침해주세요.`
    );
  }

  // Port 기반 통신: chrome.runtime.connect로 만든 Port가 살아있는 동안
  // service worker가 idle 종료되지 않음. 30초+ 걸리는 캡처에 필수.
  return new Promise((resolve, reject) => {
    let port: ChromeRuntimePort;
    try {
      port = connect(extensionId, { name: "ddhelper-capture" });
    } catch (e) {
      reject(
        new Error(
          e instanceof Error ? e.message : "확장 연결 실패 (확장이 설치되어 있는지 확인)"
        )
      );
      return;
    }

    let settled = false;
    let lastHeartbeat: { at?: string; elapsed?: number; n?: number } | null =
      null;

    port.onMessage.addListener(async (response: unknown) => {
      const r = response as
        | {
            ok?: boolean;
            type?: string;
            at?: string;
            elapsed?: number;
            n?: number;
            results?: RawCaptureItem[];
            tokens?: DesignToken[];
            error?: string;
          }
        | undefined;

      // 하트비트는 disconnect 진단용으로만 기록하고 무시
      if (r?.type === "heartbeat") {
        lastHeartbeat = { at: r.at, elapsed: r.elapsed, n: r.n };
        console.log(`[ddhelper] heartbeat ${r.n} @${r.elapsed}s stage=${r.at}`);
        return;
      }

      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {}
      if (!r || !r.ok) {
        reject(new Error(r?.error || "캡처 실패"));
        return;
      }

      // 클라이언트 측에서 슬라이스 합치기 (SW 부담 0)
      const rawResults = r.results || [];
      const stitched: StagingCaptureItem[] = await Promise.all(
        rawResults.map(async (item) => {
          if (!item.capture) {
            return {
              viewport: item.viewport,
              capture: null,
            };
          }
          try {
            const imageDataUrl = await stitchClientSide(item.capture);
            return {
              viewport: item.viewport,
              capture: {
                imageDataUrl,
                pageWidth: item.capture.pageWidth,
                pageHeight: item.capture.pageHeight,
              },
            };
          } catch (e) {
            console.error(
              `[stitch] viewport ${item.viewport.width}px 합성 실패:`,
              e
            );
            return {
              viewport: item.viewport,
              capture: null,
            };
          }
        })
      );

      resolve({
        results: stitched,
        tokens: r.tokens || [],
      });
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      const lastError = w.chrome?.runtime?.lastError;
      const hb = lastHeartbeat
        ? ` 마지막 진행: ${lastHeartbeat.elapsed}초 / 단계=${lastHeartbeat.at} / 하트비트 ${lastHeartbeat.n}회 받음.`
        : " 하트비트가 한 번도 안 옴 → 캡처 시작 자체가 실패.";
      reject(
        new Error(
          (lastError?.message ||
            "확장 통신이 응답 전에 끊어졌습니다. service worker가 종료된 것으로 보입니다.") +
            hb
        )
      );
    });

    port.postMessage({
      action: "captureStaging",
      url,
      viewports,
      extractTokens: true,
    });
  });
}
