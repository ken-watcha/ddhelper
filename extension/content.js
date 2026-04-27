/**
 * DDhelper Capture — content script
 *
 * 도구 페이지에 로드되면 페이지에 "확장 설치됨" 마커를 postMessage로 알림.
 * 도구는 이 메시지를 받아 chrome.runtime.sendMessage(extensionId, ...) 호출 가능.
 */

(function () {
  const manifest = chrome.runtime.getManifest();
  const payload = {
    type: "__DDHELPER_EXT_READY__",
    extensionId: chrome.runtime.id,
    version: manifest.version,
  };

  // 페이지 로드 직후에도 도구가 메시지를 받을 수 있도록 약간의 지연 + 반복
  const announce = () => window.postMessage(payload, "*");

  announce();
  setTimeout(announce, 500);
  setTimeout(announce, 2000);

  // 도구가 직접 "있나요?" 묻는 경우에도 응답
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    if (e.data?.type === "__DDHELPER_EXT_PING__") {
      announce();
    }
  });
})();
