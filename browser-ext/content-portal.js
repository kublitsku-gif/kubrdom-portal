// Мост между панелью и расширением. Панель не знает про расширение ничего, кроме
// двух сообщений, — поэтому портал работает и без него, просто без автосверки.
(function () {
  window.postMessage({ source: "kubrdom-ext", type: "ready" }, "*");

  window.addEventListener("message", function (ev) {
    const d = ev.data;
    if (ev.source !== window || !d || d.source !== "kubrdom-panel") return;
    if (d.type !== "check-prices") return;
    chrome.runtime.sendMessage({ type: "kd-check-prices", items: d.items || [] }, function (res) {
      window.postMessage({
        source: "kubrdom-ext", type: "prices",
        results: (res && res.results) || [],
        error: chrome.runtime.lastError ? String(chrome.runtime.lastError.message) : "",
      }, "*");
    });
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "kd-progress") return;
    window.postMessage({ source: "kubrdom-ext", type: "progress", done: msg.done, total: msg.total }, "*");
  });
})();
