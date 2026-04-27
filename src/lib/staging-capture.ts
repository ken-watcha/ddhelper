/**
 * 스테이징 웹 페이지를 헤드리스 크롬으로 띄워서 viewport별로 스크린샷 + computed style 추출.
 *
 * 환경 분기:
 * - dev (macOS/Windows): playwright-core + 시스템에 설치된 Chrome 사용
 * - prod (Vercel Linux): playwright-core + @sparticuz/chromium
 *
 * @sparticuz/chromium binary는 Linux 전용이므로 macOS dev에서는 동작 안 함.
 */
import type { Browser, BrowserContext } from "playwright-core";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * macOS의 Playwright 캐시(`~/Library/Caches/ms-playwright`)에서 chromium 실행 파일을 찾음.
 * `npx playwright install chromium`으로 받은 전용 chromium을 우선 사용 — 시스템 Chrome과
 * 분리되어 macOS '앱 관리' 보안 차단을 회피.
 */
function findPlaywrightChromiumOnMac(): string | null {
  try {
    const cacheDir = path.join(
      os.homedir(),
      "Library/Caches/ms-playwright"
    );
    if (!fs.existsSync(cacheDir)) return null;

    const versionDirs = fs
      .readdirSync(cacheDir)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse(); // 최신 버전 우선

    for (const dir of versionDirs) {
      const candidates = [
        // arm64 (Apple Silicon)
        path.join(
          cacheDir,
          dir,
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
        ),
        path.join(
          cacheDir,
          dir,
          "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"
        ),
        // x64 (Intel)
        path.join(
          cacheDir,
          dir,
          "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
        ),
        path.join(
          cacheDir,
          dir,
          "chrome-mac/Chromium.app/Contents/MacOS/Chromium"
        ),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * dev 환경에서 사용할 chromium 경로.
 * 우선순위:
 * 1. CHROMIUM_EXECUTABLE_PATH 환경변수 (사용자 명시)
 * 2. Playwright 전용 chromium (macOS: 캐시 자동 탐지) ← 권장
 * 3. 시스템 Chrome (fallback, 보안 알림 가능성 있음)
 */
function getDevChromePath(): string {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  const platform = process.platform;
  if (platform === "darwin") {
    const playwrightPath = findPlaywrightChromiumOnMac();
    if (playwrightPath) return playwrightPath;
    // fallback: 시스템 Chrome (macOS 보안 알림 가능성 있음)
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }
  throw new Error(
    "Linux 개발 환경에서는 CHROMIUM_EXECUTABLE_PATH 환경변수를 설정하거나 'npx playwright install chromium'을 실행해주세요"
  );
}

/**
 * 환경에 맞는 헤드리스 크롬 인스턴스 launch
 */
async function launchBrowser(): Promise<Browser> {
  const { chromium: playwright } = await import("playwright-core");

  if (isDev()) {
    return playwright.launch({
      headless: true,
      executablePath: getDevChromePath(),
    });
  }

  // Production (Vercel Linux)
  const sparticuz = (await import("@sparticuz/chromium")).default;
  return playwright.launch({
    args: sparticuz.args,
    executablePath: await sparticuz.executablePath(),
    headless: true,
  });
}

export interface CaptureViewport {
  /** small | medium | large | xlarge 분류와 일치하는 viewport 너비 */
  width: number;
  /** 일반적으로 위에서 1500~2400 정도 (긴 페이지면 fullPage로 다 잡음) */
  height: number;
}

export interface CaptureResult {
  /** data:image/png;base64,... 형태 (외부 호스팅 없이 클라이언트에 직접 전달) */
  imageDataUrl: string;
  /** 스크린샷 시점의 실제 페이지 너비/높이 */
  pageWidth: number;
  pageHeight: number;
}

/**
 * 단일 viewport로 페이지 캡처.
 * - fullPage 옵션으로 전체 페이지 길이를 다 잡음 (스크롤 영역 포함)
 * - 캡처 시 약간의 대기를 줘서 lazy-loaded 콘텐츠도 잡음
 */
export async function captureStaging(
  url: string,
  viewport: CaptureViewport,
  options: { timeoutMs?: number; waitForNetworkIdle?: boolean } = {}
): Promise<CaptureResult> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const waitForNetworkIdle = options.waitForNetworkIdle ?? true;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    browser = await launchBrowser();
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      // 모바일 viewport에는 mobile UA를 주는 게 더 정확한 렌더링
      ...(viewport.width <= 767
        ? {
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            isMobile: true,
            hasTouch: true,
          }
        : {}),
    });

    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: waitForNetworkIdle ? "networkidle" : "domcontentloaded",
      timeout: timeoutMs,
    });

    // lazy-load / 애니메이션 정착 대기 (짧게)
    await page.waitForTimeout(800);

    const buffer = await page.screenshot({
      fullPage: true,
      type: "png",
      timeout: timeoutMs,
    });

    // 페이지 실제 사이즈 (스크롤까지 포함된 height)
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement.scrollHeight,
        document.documentElement.clientHeight
      ),
    }));

    const base64 = buffer.toString("base64");
    return {
      imageDataUrl: `data:image/png;base64,${base64}`,
      pageWidth: dimensions.width,
      pageHeight: dimensions.height,
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

/**
 * 여러 viewport에 대해 병렬 캡처
 */
export async function captureStagingMultiViewport(
  url: string,
  viewports: CaptureViewport[],
  perViewportTimeoutMs = 25_000
): Promise<Array<CaptureResult | null>> {
  return Promise.all(
    viewports.map((vp) =>
      captureStaging(url, vp, { timeoutMs: perViewportTimeoutMs }).catch(
        (e) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[staging-capture] ${vp.width}px viewport failed:`,
              e instanceof Error ? e.message : e
            );
          }
          return null;
        }
      )
    )
  );
}
