(() => {
  if (window.__mayaAFHook) return;
  window.__mayaAFHook = true;
  const TARGETS = ["get-grand-assessment-questions-by-id", "get-random-deep-dive-question"];
  const isTarget = (url) => !!url && TARGETS.some((t) => String(url).includes(t));
  const post = (data) => {
    try {
      window.postMessage({ source: "maya-af-hook", type: "questions", data: data }, "*");
      document.documentElement.setAttribute("data-maya-af-questions", JSON.stringify(data));
    } catch (e) {}
  };
  const postMeta = (meta) => {
    try {
      window.postMessage({ source: "maya-af-hook", type: "meta", data: meta }, "*");
      document.documentElement.setAttribute("data-maya-af-meta", JSON.stringify(meta));
    } catch (e) {}
  };
  const extractMeta = (body) => {
    try {
      if (typeof body === "string") body = JSON.parse(body);
      if (body instanceof URLSearchParams) {
        const id = body.get("id");
        const roll_no = body.get("roll_no");
        if (id && roll_no) return { id: id, roll_no: roll_no };
        return null;
      }
      if (body && body.id && body.roll_no) return { id: body.id, roll_no: body.roll_no };
    } catch (e) {}
    return null;
  };
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const url = (typeof args[0] === "string" ? args[0] : (args[0] && args[0].url)) || "";
      const p = origFetch.apply(this, args);
      if (isTarget(url)) {
        const meta = extractMeta(args[1] && args[1].body);
        if (meta) postMeta(meta);
        p.then((resp) => {
          try { resp.clone().json().then(post).catch(() => {}); } catch (e) {}
        }).catch(() => {});
      }
      return p;
    };
  }
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__mayaAFUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const meta = extractMeta(args[0]);
    if (meta) postMeta(meta);
    this.addEventListener("load", function () {
      try {
        if (isTarget(this.__mayaAFUrl) && this.responseText) {
          post(JSON.parse(this.responseText));
        }
      } catch (e) {}
    });
return origSend.apply(this, args);
    };
  document.documentElement.setAttribute("data-maya-af-hook-installed", "1");
  })();