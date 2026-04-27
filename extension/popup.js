/**
 * DDhelper Capture — popup
 *
 * 확장 아이콘 클릭 시 뜨는 작은 패널의 동적 부분 처리.
 * - 버전 표시
 * - 도구 URL 링크 (storage에 저장된 값 우선, 없으면 기본값)
 */

const DEFAULT_TOOL_URL = "https://ddhelper-two.vercel.app";

document.addEventListener("DOMContentLoaded", async () => {
  // manifest 버전 표시
  try {
    const manifest = chrome.runtime.getManifest();
    document.getElementById("version").textContent = `v${manifest.version}`;
  } catch {}

  // 도구 URL (저장된 값이 있으면 사용)
  let toolUrl = DEFAULT_TOOL_URL;
  try {
    const stored = await chrome.storage.local.get(["toolUrl"]);
    if (stored.toolUrl) toolUrl = stored.toolUrl;
  } catch {}

  const openBtn = document.getElementById("open-tool");
  if (openBtn) openBtn.href = toolUrl;
});
