(() => {
  const el = document.createElement("script");
  el.src = chrome.runtime.getURL("hook-injected.js");
  (document.documentElement || document.head || document.body).appendChild(el);
})();