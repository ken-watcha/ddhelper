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

const VERSION = "0.1.0";

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
            { width: 768, height: 1024 },
            { width: 1024, height: 900 },
            { width: 1440, height: 900 },
          ];
    const results = await captureMultiple(message.url, viewports);
    return { ok: true, results };
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
 * 병렬은 메모리/창 충돌 가능성이 있어 안정성 우선 순차.
 */
async function captureMultiple(url, viewports) {
  const results = [];
  for (const vp of viewports) {
    try {
      const capture = await captureSingle(url, vp);
      results.push({ viewport: vp, capture });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.warn(`[capture] ${vp.width}px failed:`, error);
      results.push({ viewport: vp, capture: null, error });
    }
  }
  return results;
}

/**
 * 단일 viewport 캡처:
 * 1. 새 popup 창을 viewport 크기로 띄움 (focused: false)
 * 2. 페이지 로드 완료 대기
 * 3. captureVisibleTab으로 PNG 받기
 * 4. 페이지 사이즈 측정
 * 5. 창 닫기
 */
async function captureSingle(url, viewport) {
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
    // 페이지 로드 대기 (최대 25초)
    await waitForTabComplete(tab.id, 25000);
    // 초기 정착 대기
    await sleep(2000);

    // 1) lazy-load 트리거: 페이지 끝까지 스크롤하면서 콘텐츠 로딩 유도 → 맨 위로
    await triggerLazyLoad(tab.id);
    await sleep(1500);

    // 2) 실제 콘텐츠(이미지)가 충분히 로드될 때까지 polling (최대 20초)
    //    React SPA 같은 경우 API 응답 도착 후에야 영화 카드가 그려짐
    await waitForContent(tab.id, 20000);

    // 3) 마지막 안정화 대기 (애니메이션/페이드인 마무리)
    await sleep(1200);

    // 보이는 영역 캡처 (PNG data URL)
    const imageDataUrl = await chrome.tabs.captureVisibleTab(win.id, {
      format: "png",
    });

    // 페이지 실제 사이즈 측정 (스크롤 포함)
    let dimensions = { width: viewport.width, height: viewport.height };
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          width: document.documentElement.clientWidth,
          height: Math.max(
            document.body?.scrollHeight ?? 0,
            document.documentElement.scrollHeight,
            document.documentElement.clientHeight
          ),
        }),
      });
      if (injectionResults && injectionResults[0]?.result) {
        dimensions = injectionResults[0].result;
      }
    } catch {
      // dimension 측정 실패해도 캡처는 그대로 반환
    }

    return {
      imageDataUrl,
      pageWidth: dimensions.width,
      pageHeight: dimensions.height,
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
