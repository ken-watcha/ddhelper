/**
 * DDhelper Capture — background service worker
 *
 * 도구(localhost:3000 / ddhelper-two.vercel.app)로부터 외부 메시지를 받아
 * viewport별 캡처를 수행하고 결과를 돌려줌.
 *
 * 메시지 프로토콜:
 *  - { action: "ping" }
 *      → { ok: true, version: "0.1.0" }
 *
 *  - { action: "captureStaging", url: string, viewports: { width, height }[] }
 *      → { ok: true, results: [{ viewport, capture: { imageDataUrl, pageWidth, pageHeight } | null, error?: string }] }
 */

const VERSION = "0.4.0";

console.log("[DDhelper Capture] background service worker loaded");

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err) => {
        console.error("[DDhelper Capture] error", err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true; // 비동기 응답
  }
);

// ---------------------------------------------------------------------------
// 포트 기반 채널 — 캡처처럼 30초+ 걸리는 작업에 사용.
// chrome.runtime.connect로 만든 Port는 살아있는 동안 service worker가
// 종료되지 않게 유지해 줌. one-shot sendMessage는 SW가 idle 판정으로 죽으면
// "message channel closed" 에러가 나기 때문에 긴 작업은 반드시 Port로.
// ---------------------------------------------------------------------------
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== "ddhelper-capture") return;
  console.log("[DDhelper Capture] port opened from", port.sender?.url);

  port.onMessage.addListener(async (message) => {
    try {
      const response = await handleMessage(message, port.sender ?? {});
      try {
        port.postMessage(response);
      } catch {
        // 호출 측이 먼저 disconnect 했을 수 있음
      }
    } catch (err) {
      console.error("[DDhelper Capture] port error", err);
      try {
        port.postMessage({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {}
    } finally {
      try {
        port.disconnect();
      } catch {}
    }
  });

  port.onDisconnect.addListener(() => {
    console.log("[DDhelper Capture] port disconnected");
  });
});

async function handleMessage(message, sender) {
  if (!message || typeof message !== "object") {
    return { ok: false, error: "invalid message" };
  }

  console.log(
    `[DDhelper Capture] action=${message.action} from`,
    sender.url
  );

  if (message.action === "ping") {
    return { ok: true, version: VERSION };
  }

  if (message.action === "captureStaging") {
    if (!message.url || typeof message.url !== "string") {
      return { ok: false, error: "url is required" };
    }
    const viewports =
      Array.isArray(message.viewports) && message.viewports.length > 0
        ? message.viewports
        : [
            { width: 375, height: 800 },
            { width: 1024, height: 900 },
          ];
    const { results, tokens } = await captureMultiple(
      message.url,
      viewports,
      message.extractTokens !== false
    );
    return { ok: true, results, tokens };
  }

  return { ok: false, error: `unknown action: ${message.action}` };
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[DDhelper Capture] installed/updated:`, details.reason);
});

// ===========================================================================
// 캡처 로직
// ===========================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 여러 viewport에 대해 순차 캡처.
 * 첫 viewport에서 토큰까지 함께 추출 (DOM 구조는 viewport마다 거의 동일하므로 1회면 충분).
 */
async function captureMultiple(url, viewports, doExtractTokens) {
  const results = [];
  let tokens = [];

  for (let i = 0; i < viewports.length; i++) {
    const vp = viewports[i];
    try {
      const { capture, tokens: extractedTokens } = await captureSingle(
        url,
        vp,
        // 첫 viewport(보통 데스크톱급 1024)에서만 토큰 추출
        doExtractTokens && i === 0
      );
      results.push({ viewport: vp, capture });
      if (extractedTokens && extractedTokens.length > 0) {
        tokens = extractedTokens;
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.warn(`[capture] ${vp.width}px failed:`, error);
      results.push({ viewport: vp, capture: null, error });
    }
  }
  return { results, tokens };
}

/**
 * 단일 viewport 캡처:
 * 1. 새 popup 창을 viewport 크기로 띄움 (focused: false)
 * 2. 페이지 로드 완료 대기
 * 3. captureVisibleTab으로 PNG 받기
 * 4. 페이지 사이즈 측정
 * 5. 창 닫기
 */
async function captureSingle(url, viewport, doExtractTokens) {
  // chrome.windows.create는 chrome UI(타이틀바, 주소창 일부)를 포함한 사이즈 기준이라
  // 실제 viewport보다 약간 큰 창을 만들어야 함. type:"popup"이면 chrome UI가 거의 없어서
  // viewport와 거의 일치.
  //
  // focused:true 가 핵심 — Chrome은 백그라운드 탭의 네트워크/타이머/JS를 throttling
  // 하기 때문에 focused:false면 watcha 같은 SPA가 API 응답을 제대로 못 받아 placeholder만
  // 잡힘. 캡처 동안 잠깐 창이 떴다가 자동 닫힘.
  const win = await chrome.windows.create({
    url,
    type: "popup",
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    focused: true,
    state: "normal",
  });

  if (!win || !win.tabs || win.tabs.length === 0) {
    throw new Error("창을 만들지 못했습니다");
  }
  const tab = win.tabs[0];
  if (!tab.id) throw new Error("탭 ID가 없습니다");

  try {
    // 페이지 로드 대기 (최대 20초)
    await waitForTabComplete(tab.id, 20000);
    // 초기 정착 대기 — Hero 영역 첫 페인트 시간
    await sleep(1000);

    // 1) 첫 화면(Hero) 콘텐츠가 충분히 로드될 때까지 polling (최대 8초)
    //    스크롤이 시작되는 시점에 위쪽이 비면 첫 슬라이스가 skeleton으로 잡힘.
    //    아래쪽 lazy-load는 이후 스티칭 스크롤이 자연스럽게 트리거하므로
    //    별도의 사전 lazy-trigger 호출은 생략 (속도 개선).
    await waitForContent(tab.id, 8000);

    // 2) 안정화 짧게
    await sleep(400);

    // 3) sticky/fixed 헤더·푸터 숨김 — 슬라이스마다 헤더 중복 찍히는 문제 방지
    await hideOverlayElements(tab.id);
    await sleep(200);

    // 5) 페이지 사이즈 측정 (오버레이 숨긴 후 최종 레이아웃 기준)
    const m = await measurePage(tab.id, viewport);

    // 6) 토큰 추출 (요청한 경우만) — 캡처 전에 실행해야 오버레이는 visibility:hidden이지만
    //    DOM 구조는 그대로라 정상 동작
    let tokens = [];
    if (doExtractTokens) {
      try {
        tokens = await extractTokensFromTab(tab.id);
        console.log(`[extract] ${tokens.length} tokens`);
      } catch (e) {
        console.warn("[extract] failed:", e);
      }
    }

    // 7) 페이지가 한 화면에 다 들어가면 단일 캡처, 아니면 스크롤·스티칭
    const needsStitch = m.scrollHeight > m.clientHeight + 30;

    let imageDataUrl;
    if (!needsStitch) {
      console.log(`[capture ${viewport.width}px] single shot ${m.clientWidth}x${m.scrollHeight}`);
      imageDataUrl = await chrome.tabs.captureVisibleTab(win.id, {
        format: "png",
      });
    } else {
      console.log(`[capture ${viewport.width}px] stitching ${m.clientWidth}x${m.scrollHeight} (viewport ${m.clientHeight})`);
      imageDataUrl = await captureFullPageStitched(tab.id, win.id, m);
    }

    return {
      capture: {
        imageDataUrl,
        pageWidth: m.clientWidth,
        pageHeight: m.scrollHeight,
      },
      tokens,
    };
  } finally {
    // 창 닫기
    if (win.id !== undefined) {
      await chrome.windows.remove(win.id).catch(() => {});
    }
  }
}

/**
 * 실제 콘텐츠(이미지/콘텐츠 카드)가 그려질 때까지 polling.
 * React SPA 등에서 페이지 첫 로드는 끝났지만 API 응답 후에야 콘텐츠가 채워지는 경우 대응.
 *
 * 판정 기준 (둘 중 하나):
 *  - "콘텐츠 풍부": 진짜 이미지(<img> + CSS background-image) 합계가 8개 이상
 *  - "DOM 안정화": 콘텐츠 카운트가 3회 연속 동일 (= 더 이상 늘어나지 않음, 약 1.8초)
 *
 * 왓챠처럼 background-image로 포스터를 그리는 SPA도 잡기 위해 CSS 배경 이미지까지 카운트.
 */
async function waitForContent(tabId, timeoutMs) {
  const startedAt = Date.now();
  const POLL_INTERVAL = 600;

  let lastSignature = "";
  let stableCount = 0;
  let lastStats = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // 1) <img> — 실제 src가 있고 자연 사이즈가 의미 있는 이미지
          const imgs = Array.from(document.querySelectorAll("img"));
          const realImgs = imgs.filter((img) => {
            const src = img.currentSrc || img.src || "";
            if (!src) return false;
            if (src.startsWith("data:")) return false;
            return img.naturalWidth > 16;
          });

          // 2) CSS background-image — 왓챠 같은 사이트는 포스터를 div의 배경으로 그림
          //    너무 많은 노드를 검사하면 무거워서 일단 후보 클래스/태그로 줄임
          const candidates = document.querySelectorAll(
            "div,a,article,li,section,figure,picture"
          );
          let bgImageCount = 0;
          // 너무 큰 페이지는 앞 1500개만
          const limit = Math.min(candidates.length, 1500);
          for (let i = 0; i < limit; i++) {
            const el = candidates[i];
            const bg = window.getComputedStyle(el).backgroundImage;
            if (
              bg &&
              bg !== "none" &&
              bg.includes("url(") &&
              !bg.includes("data:")
            ) {
              const rect = el.getBoundingClientRect();
              // 너무 작은 아이콘/장식은 제외
              if (rect.width >= 40 && rect.height >= 40) {
                bgImageCount++;
              }
            }
          }

          // 3) skeleton/placeholder 상태
          const placeholders = document.querySelectorAll(
            '[class*="skeleton"],[class*="Skeleton"],[class*="placeholder"],[class*="Placeholder"],[aria-busy="true"]'
          );

          return {
            realImageCount: realImgs.length,
            bgImageCount,
            contentCount: realImgs.length + bgImageCount,
            placeholderCount: placeholders.length,
            scrollHeight: document.documentElement.scrollHeight,
          };
        },
      });
      const r = results?.[0]?.result;
      if (r) {
        lastStats = r;
        // 콘텐츠 풍부 판정 (img+bg 합계 기준)
        if (r.contentCount >= 8) {
          console.log("[capture] content rich:", r);
          return;
        }
        // DOM 안정화 판정 (3회 연속 동일한 시그니처면 더 안 변하는 상태)
        const signature = `${r.contentCount}|${r.placeholderCount}|${r.scrollHeight}`;
        if (signature === lastSignature && r.contentCount >= 3) {
          stableCount++;
          if (stableCount >= 3) {
            console.log("[capture] content stable:", r);
            return;
          }
        } else {
          stableCount = 0;
          lastSignature = signature;
        }
      }
    } catch {
      // executeScript 실패는 무시하고 polling 계속
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  // timeout이어도 그냥 진행 — 마지막 상태는 콘솔에 남겨서 디버깅
  console.log("[capture] timeout — last stats:", lastStats);
}

/**
 * lazy-load 콘텐츠를 트리거하기 위해 페이지를 끝까지 스크롤한 뒤 맨 위로 복귀.
 * IntersectionObserver 기반의 lazy 이미지/콘텐츠가 모두 로드되도록 유도.
 */
async function triggerLazyLoad(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return new Promise((resolve) => {
          const STEP = 400;
          const STEP_DELAY = 200;
          const MAX_TIME = 6000; // 안전 상한
          const startedAt = Date.now();

          const scrollNext = () => {
            const before = window.scrollY;
            window.scrollBy(0, STEP);
            const after = window.scrollY;
            const reachedEnd =
              before === after ||
              window.scrollY + window.innerHeight >=
                document.documentElement.scrollHeight - 10;

            if (reachedEnd || Date.now() - startedAt > MAX_TIME) {
              // 끝까지 스크롤. 충분히 대기해서 lazy 콘텐츠 마지막 배치 로드 → 맨 위로.
              setTimeout(() => {
                window.scrollTo(0, 0);
                resolve(undefined);
              }, 1500);
              return;
            }
            setTimeout(scrollNext, STEP_DELAY);
          };
          scrollNext();
        });
      },
    });
  } catch {
    // 스크롤 실패해도 캡처는 그대로 진행
  }
}

/**
 * 탭이 'complete' 상태가 될 때까지 대기.
 */
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const finish = (fn) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error("page load timeout"))),
      timeoutMs
    );

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        finish(() => resolve());
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // 이미 complete 상태인지 즉시 체크
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish(() => resolve());
    }).catch(() => {});
  });
}

// ===========================================================================
// 풀 페이지 캡처 (스크롤 + 스티칭)
// ===========================================================================

/**
 * 페이지의 실제 width / scrollHeight / clientHeight 측정.
 */
async function measurePage(tabId, fallbackViewport) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement.scrollHeight,
          document.documentElement.clientHeight
        ),
      }),
    });
    if (r && r[0]?.result) return r[0].result;
  } catch {
    // ignore
  }
  return {
    clientWidth: fallbackViewport.width,
    clientHeight: fallbackViewport.height,
    scrollHeight: fallbackViewport.height,
  };
}

/**
 * sticky / fixed 요소 숨김 — 스크롤 캡처 시 매 슬라이스에 헤더가 중복으로
 * 찍히는 문제를 막기 위함. visibility:hidden을 쓰면 레이아웃은 유지되고
 * 자리만 비어서 스크롤 위치가 어긋나지 않음.
 */
async function hideOverlayElements(tabId) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        let count = 0;
        const all = document.querySelectorAll("*");
        for (const el of all) {
          const cs = window.getComputedStyle(el);
          if (cs.position === "fixed" || cs.position === "sticky") {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            el.style.setProperty("visibility", "hidden", "important");
            count++;
          }
        }
        return count;
      },
    });
    console.log(`[capture] hidden ${r?.[0]?.result ?? 0} sticky/fixed elements`);
  } catch {
    // ignore — 숨김 실패해도 캡처는 진행
  }
}

/**
 * 페이지를 viewport 높이만큼 단계적으로 스크롤하면서 한 장씩 captureVisibleTab,
 * OffscreenCanvas로 이어붙여 한 장의 PNG로 반환.
 *
 * Chrome captureVisibleTab은 초당 ~2회 제한이 있어 슬라이스마다 550ms 대기.
 */
async function captureFullPageStitched(tabId, windowId, m) {
  const slices = [];
  const VIEWPORT_OVERLAP = 0;
  const SCROLL_SETTLE_MS = 400;
  const RATE_LIMIT_MS = 520;

  // 안전 상한 — 디자인 QA 목적이라 페이지 전부 안 잡혀도 OK.
  // 무한 스크롤 페이지에서도 일정 시간 안에 끝남.
  const MAX_PAGE_HEIGHT = 12000;
  const MAX_TIME_MS = 30000; // viewport당 30초 하드 캡
  const startedAt = Date.now();

  // 동적 페이지 높이 — 스크롤하면서 lazy 콘텐츠로 자라면 재측정해 늘림
  let pageHeight = Math.min(m.scrollHeight, MAX_PAGE_HEIGHT);

  let y = 0;
  let safety = 0;
  while (
    y < pageHeight &&
    safety < 80 &&
    Date.now() - startedAt < MAX_TIME_MS
  ) {
    safety++;
    const maxScrollY = Math.max(0, pageHeight - m.clientHeight);
    const scrollY = Math.min(y, maxScrollY);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (sy) => window.scrollTo(0, sy),
      args: [scrollY],
    });
    await sleep(SCROLL_SETTLE_MS);

    let dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: "png",
      });
    } catch (e) {
      console.warn("[capture] captureVisibleTab failed, retrying:", e);
      await sleep(800);
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: "png",
      });
    }
    slices.push({ dataUrl, scrollY });

    // 다음 위치 계산
    const nextY = scrollY + m.clientHeight - VIEWPORT_OVERLAP;

    // 페이지 끝 근처에 가까우면 한번 더 측정 — lazy 콘텐츠가 추가됐을 수 있음
    if (scrollY + m.clientHeight + 200 >= pageHeight) {
      const remeasured = await measurePage(tabId, {
        width: m.clientWidth,
        height: m.clientHeight,
      });
      const newHeight = Math.min(remeasured.scrollHeight, MAX_PAGE_HEIGHT);
      if (newHeight > pageHeight + 50) {
        console.log(
          `[capture] page grew during scroll: ${pageHeight} → ${newHeight}`
        );
        pageHeight = newHeight;
        // 자랐으니 계속 진행
        y = nextY;
        await sleep(RATE_LIMIT_MS);
        continue;
      }
      // 안 자랐으면 종료
      break;
    }

    y = nextY;
    await sleep(RATE_LIMIT_MS);
  }

  const elapsed = Math.round((Date.now() - startedAt) / 100) / 10;
  console.log(
    `[capture] captured ${slices.length} slices in ${elapsed}s, page=${pageHeight}, stitching...`
  );
  return await stitchSlices(slices, m, pageHeight);
}

/**
 * 슬라이스 PNG 데이터 URL들을 OffscreenCanvas에 그려 한 장으로 합침.
 * captureVisibleTab은 device pixel ratio가 적용된 이미지를 반환하므로
 * 첫 비트맵의 width / clientWidth로 scale을 계산해 캔버스 크기를 맞춘다.
 */
async function stitchSlices(slices, m, pageHeight) {
  if (slices.length === 0) throw new Error("스티칭할 슬라이스 없음");

  const bitmaps = [];
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const blob = await (await fetch(s.dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    bitmaps.push({ bitmap, scrollY: s.scrollY });
    // 무거운 디코딩 중간에 chrome API 호출 — service worker keepalive
    if (i % 4 === 3) {
      try {
        await chrome.runtime.getPlatformInfo();
      } catch {}
    }
  }

  const first = bitmaps[0].bitmap;
  const scale = first.width / m.clientWidth; // 보통 1 또는 DPR (2)

  const canvasWidth = first.width;
  const canvasHeight = Math.round(pageHeight * scale);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  for (const { bitmap, scrollY } of bitmaps) {
    ctx.drawImage(bitmap, 0, Math.round(scrollY * scale));
    bitmap.close();
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return await blobToDataUrl(blob);
}

// ===========================================================================
// 디자인 토큰 추출 (DOM 직접 — AI 호출 없음)
// ===========================================================================

/**
 * 페이지 안의 주요 요소들의 computed style을 직접 읽어 디자인 토큰으로 변환.
 * AI 사용 시 분당 한도(rate limit) 문제로 막히기 때문에 결정적(deterministic) 추출 사용.
 */
async function extractTokensFromTab(tabId) {
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const tokens = [];
      const seen = new Set();

      // rgb/rgba → #RRGGBB 정규화
      const normColor = (v) => {
        if (!v) return v;
        const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) {
          return (
            "#" +
            m
              .slice(1, 4)
              .map((n) => Number(n).toString(16).padStart(2, "0"))
              .join("")
              .toUpperCase()
          );
        }
        return v.trim();
      };

      const norm = (prop, v) => {
        if (!v) return v;
        if (prop.includes("color")) return normColor(v);
        // px 그대로
        return v.trim();
      };

      const cat = (p) => {
        if (p.includes("color")) return "color";
        if (
          p.includes("font") ||
          p.includes("line-height") ||
          p.includes("letter-spacing")
        )
          return "typography";
        if (p.includes("padding") || p.includes("margin") || p === "gap")
          return "spacing";
        if (p === "width" || p === "height") return "sizing";
        if (p.includes("border")) return "border";
        return "spacing";
      };

      const elementName = (el) => {
        // 의미 있는 이름: 첫 클래스 (너무 길면 짤라서) 또는 태그명
        if (typeof el.className === "string" && el.className.trim()) {
          const first = el.className.trim().split(/\s+/)[0];
          if (first && first.length <= 40) return "." + first;
        }
        const role = el.getAttribute("role");
        if (role) return `${el.tagName.toLowerCase()}[role=${role}]`;
        return el.tagName.toLowerCase();
      };

      const isTransparent = (v) =>
        !v ||
        v === "rgba(0, 0, 0, 0)" ||
        v === "transparent" ||
        v === "none" ||
        v === "auto" ||
        v === "normal";

      const collect = (el, type, props) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return; // 거의 안 보이는 거 제외
        const cs = window.getComputedStyle(el);
        const name = elementName(el);

        for (const p of props) {
          let v = cs.getPropertyValue(p);
          if (!v) continue;
          v = v.trim();
          if (isTransparent(v)) continue;
          if (p.includes("color") && (v === "currentcolor" || v === "inherit"))
            continue;

          const normalized = norm(p, v);
          const key = `${type}|${p}|${normalized}`;
          if (seen.has(key)) continue;
          seen.add(key);

          tokens.push({
            element: name,
            elementType: type,
            property: p,
            value: normalized,
            category: cat(p),
          });
        }
      };

      // 각 elementType마다 최대 N개 후보만 (대형 페이지에서도 토큰 수 제어)
      const MAX_PER_TYPE = 8;

      const TARGETS = [
        {
          type: "button",
          selector: 'button, [role="button"], a[class*="btn"], a[class*="Button"]',
          props: [
            "background-color",
            "color",
            "font-size",
            "font-weight",
            "padding-top",
            "padding-bottom",
            "padding-left",
            "padding-right",
            "border-radius",
            "border-color",
            "border-width",
            "height",
          ],
        },
        {
          type: "heading",
          selector: "h1, h2, h3, h4",
          props: [
            "color",
            "font-size",
            "font-weight",
            "line-height",
            "letter-spacing",
          ],
        },
        {
          type: "text",
          selector: "p",
          props: ["color", "font-size", "font-weight", "line-height"],
        },
        {
          type: "input",
          selector:
            'input[type="text"], input[type="search"], input[type="email"], input[type="password"], textarea',
          props: [
            "background-color",
            "color",
            "border-color",
            "border-width",
            "border-radius",
            "padding-left",
            "padding-right",
            "padding-top",
            "padding-bottom",
            "font-size",
          ],
        },
        {
          type: "tag",
          selector:
            '[class*="badge"], [class*="Badge"], [class*="tag"], [class*="Tag"], [class*="chip"], [class*="Chip"]',
          props: [
            "background-color",
            "color",
            "font-size",
            "border-radius",
            "padding-left",
            "padding-right",
          ],
        },
        {
          type: "card",
          selector:
            'article, [class*="card"], [class*="Card"], [class*="item"], [class*="Item"]',
          props: [
            "background-color",
            "border-radius",
            "border-color",
            "border-width",
            "padding-top",
            "padding-bottom",
          ],
        },
      ];

      for (const t of TARGETS) {
        let candidates;
        try {
          candidates = document.querySelectorAll(t.selector);
        } catch {
          continue;
        }
        const sample = Array.from(candidates).slice(0, MAX_PER_TYPE);
        for (const el of sample) {
          collect(el, t.type, t.props);
        }
      }

      return tokens;
    },
  });
  return r?.[0]?.result ?? [];
}

// ===========================================================================
// 유틸
// ===========================================================================

/**
 * Service Worker에서 Blob을 data URL로 변환.
 * FileReader는 SW에서 호환 이슈가 있을 수 있어 ArrayBuffer + btoa 직접 사용.
 */
async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  let chunkCount = 0;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK)
    );
    chunkCount++;
    // 큰 PNG (수 MB)면 String 처리에 시간이 걸려 SW 죽을 수 있음 — 주기적 keepalive
    if (chunkCount % 32 === 0) {
      try {
        await chrome.runtime.getPlatformInfo();
      } catch {}
    }
  }
  const base64 = btoa(binary);
  return `data:${blob.type || "image/png"};base64,${base64}`;
}
