const $ = (id) => document.getElementById(id);

const defaults = { autoRun: true, autoAdvance: true, usePastedJson: false, questionsJson: "", aiProvider: "gemini", geminiApiKey: "", geminiModel: "gemini-flash-latest" };

let currentProvider = "gemini";
let geminiConnected = false;

/* Live model IDs. The field stays free-typed - any ID works, and the background
   falls back to the next model if one has been retired. */
const GEMINI_MODELS = [
  { id: "gemini-flash-latest", label: "Gemini Flash", note: "newest flash" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", note: "cheapest" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "slowest" },
];

let modelRows = [];
let modelSel = -1;
let suppressFocusOpen = false;

function modelValue() {
  return (($("geminiModel") || {}).value || "").trim() || "gemini-flash-latest";
}

function renderModelList() {
  const list = $("modelList");
  const input = $("geminiModel");
  if (!list || !input) return;
  const term = input.value.trim();
  const lower = term.toLowerCase();
  const matches = lower
    ? GEMINI_MODELS.filter((m) => m.id.toLowerCase().includes(lower) || m.label.toLowerCase().includes(lower))
    : GEMINI_MODELS.slice();
  const isCustom = !!term && !GEMINI_MODELS.some((m) => m.id === term) &&
    // Only offer a custom id when nothing matched, or when it clearly looks
    // like a model id - otherwise "pro" would offer itself while filtering.
    (matches.length === 0 || lower.startsWith("gemini"));

  modelRows = (isCustom ? [{ id: term, label: "Use this model ID", custom: true }] : []).concat(matches);
  if (modelSel >= modelRows.length) modelSel = modelRows.length - 1;

  list.textContent = "";
  modelRows.forEach((m, i) => {
    const li = document.createElement("li");
    li.className = (m.custom ? "custom" : "") + (i === modelSel ? " sel" : "") + (!m.custom && m.id === term ? " on" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", m.id === term ? "true" : "false");
    const mid = document.createElement("span");
    mid.className = "mid";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = m.note ? `${m.label} · ${m.note}` : m.label;
    const id = document.createElement("span");
    id.className = "id";
    id.textContent = m.id;
    mid.append(name, id);
    li.append(mid);
    if (!m.custom && m.id === term) {
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.textContent = "✓";
      li.append(tick);
    }
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      chooseModel(m.id);
    });
    list.append(li);
  });

  if (modelSel >= 0) {
    const active = list.children[modelSel];
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "nearest" });
    }
  }
}

function openModelList(selectFirst) {
  const list = $("modelList");
  if (!list) return;
  modelSel = selectFirst ? 0 : -1;
  renderModelList();
  list.hidden = false;
  $("modelToggle").setAttribute("aria-expanded", "true");
  $("geminiModel").setAttribute("aria-expanded", "true");
}

function closeModelList() {
  const list = $("modelList");
  if (!list) return;
  list.hidden = true;
  modelSel = -1;
  $("modelToggle").setAttribute("aria-expanded", "false");
  $("geminiModel").setAttribute("aria-expanded", "false");
}

function chooseModel(id) {
  const input = $("geminiModel");
  if (input) input.value = id;
  closeModelList();
  if (input) {
    // focus() fires the focus handler, which would reopen the list we just
    // closed - so swallow that one focus.
    suppressFocusOpen = true;
    input.focus();
    setTimeout(() => { suppressFocusOpen = false; }, 0);
  }
  if (currentProvider === "gemini") {
    setConnectStatus("Changed but not saved yet - press Connect to test and save.", "err");
  }
}

function hasValidJson(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const questions = Array.isArray(parsed) ? parsed : parsed && parsed.questions;
    return Array.isArray(questions) && questions.length > 0;
  } catch (e) {
    return false;
  }
}

function renderProviderUI() {
  const geminiFields = $("geminiFields");
  if (geminiFields) geminiFields.style.display = currentProvider === "gemini" ? "block" : "none";
  const gemBtn = $("useGemini");
  const orBtn = $("useOpenRouter");
  if (gemBtn) gemBtn.classList.toggle("active", currentProvider === "gemini");
  if (orBtn) orBtn.classList.toggle("active", currentProvider === "openrouter");

  const dot = $("aiDot");
  const status = $("aiStatus");
  const connected = currentProvider === "gemini" ? geminiConnected : true;
  if (dot) dot.className = "status-dot " + (connected ? "connected" : "disconnected");
  if (status) {
    status.textContent = currentProvider === "gemini"
      ? (geminiConnected ? "Gemini: connected" : "Gemini: not connected - press Connect")
      : "OpenRouter: shared free models";
  }
}

function setConnectStatus(text, tone) {
  const el = $("connectStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = tone === "ok" ? "#22c55e" : tone === "err" ? "#ef4444" : "#9ca3af";
}

async function setProvider(provider) {
  currentProvider = provider;
  await chrome.storage.local.set({ aiProvider: provider });
  renderProviderUI();
  if (provider === "gemini" && !geminiConnected) {
    setConnectStatus("Add your API key and press Connect.", "err");
  } else {
    setConnectStatus("");
  }
}

async function load() {
  const s = await chrome.storage.local.get(defaults);
  try { await chrome.storage.local.set({ useFirebase: true, useAI: true }); } catch (e) {}
  const runEl = $("autoRun");
  const advEl = $("autoAdvance");
  if (runEl) runEl.checked = s.autoRun !== false;
  if (advEl) advEl.checked = s.autoAdvance !== false;
  const valid = hasValidJson(s.questionsJson);
  if (valid) {
    $("jsonInput").value = typeof s.questionsJson === "string" ? s.questionsJson : JSON.stringify(s.questionsJson, null, 2);
    $("msg").textContent = "Saved JSON found (" + (Array.isArray(s.questionsJson) ? s.questionsJson.length : "?") + " questions).";
  } else {
    $("jsonInput").value = "";
  }
  const usePasted = s.usePastedJson && valid;
  const srcEl = usePasted ? $('input[name="src"][value="pasted"]') : $('input[name="src"][value="api"]');
  if (srcEl) srcEl.checked = true;
  if (!usePasted) {
    $("msg").textContent = "Automatic mode - answers are taken from the page automatically. No input needed.";
  }

  const prov = s.aiProvider === "openrouter" ? "openrouter" : "gemini";
  currentProvider = prov;
  geminiConnected = !!(s.geminiApiKey && s.geminiApiKey.trim());
  renderProviderUI();
  const keyEl = $("geminiApiKey");
  if (keyEl) keyEl.value = s.geminiApiKey || "";
  const modelEl = $("geminiModel");
  if (modelEl) modelEl.value = s.geminiModel || "gemini-flash-latest";
  if (prov === "gemini") {
    setConnectStatus(
      geminiConnected ? "Connected. Key is saved and being used." : "Not connected yet. Paste your API key and press Connect.",
      geminiConnected ? "ok" : "err"
    );
  }

  checkStoreStatus();
  checkCachedCount();
  checkUpdateStatus();
}

async function checkUpdateStatus() {
  const banner = $("updateBanner");
  const versionEl = $("updateVersion");
  const linkEl = $("updateLink");
  if (!banner || !versionEl || !linkEl) return;
  try {
    const resp = await bgMsg("CHECK_UPDATE", {});
    if (resp.ok && resp.updateAvailable) {
      versionEl.textContent = resp.updateVersion || "";
      linkEl.href = resp.updateUrl || "#";
      banner.style.display = "flex";
    } else {
      banner.style.display = "none";
    }
  } catch (e) {
    banner.style.display = "none";
  }
}

["autoRun", "autoAdvance"].forEach((key) => {
  const el = $(key);
  if (el) el.addEventListener("change", async (e) => {
    await chrome.storage.local.set({ [key]: e.target.checked });
  });
});

$("useGemini").addEventListener("click", () => setProvider("gemini"));
$("useOpenRouter").addEventListener("click", () => setProvider("openrouter"));

// Connect: run a real Gemini command with the values in the fields.
// Saved only when it succeeds — a failure leaves the current setup untouched.
$("connectGemini").addEventListener("click", async () => {
  const btn = $("connectGemini");
  const key = ($("geminiApiKey").value || "").trim();
  const model = ($("geminiModel").value || "").trim() || "gemini-flash-latest";
  if (!key) {
    setConnectStatus("Paste your Gemini API key (starts with AIza) first.", "err");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Connecting...";
  setConnectStatus("Testing your key with a real request...");
  const resp = await bgMsg("AI_TEST", { provider: "gemini", apiKey: key, model });
  btn.disabled = false;
  btn.textContent = "Connect";
  if (resp && resp.ok) {
    const savedModel = resp.model || model;
    $("geminiModel").value = savedModel;
    await chrome.storage.local.set({ geminiApiKey: key, geminiModel: savedModel, aiProvider: "gemini" });
    currentProvider = "gemini";
    geminiConnected = true;
    renderProviderUI();
    setConnectStatus("Connected - " + savedModel + " is answering questions.", "ok");
  } else {
    geminiConnected = false;
    renderProviderUI();
    setConnectStatus("Not connected: " + String((resp && resp.error) || "no response from background"), "err");
  }
});

// Edits are never written straight to storage - Connect validates first.
["geminiApiKey", "geminiModel"].forEach((id) => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => {
    if (currentProvider !== "gemini") return;
    setConnectStatus("Changed but not saved yet - press Connect to test and save.", "err");
  });
});

/* ---- model picker ---- */
(function initModelPicker() {
  const input = $("geminiModel");
  const toggle = $("modelToggle");
  if (!input || !toggle) return;

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    if ($("modelList").hidden) openModelList(false);
    else closeModelList();
  });

  input.addEventListener("focus", () => {
    if (suppressFocusOpen) return;
    if ($("modelList").hidden) openModelList(false);
  });

  input.addEventListener("input", () => {
    if ($("modelList").hidden) openModelList(false);
    else renderModelList();
  });

  input.addEventListener("keydown", (e) => {
    const list = $("modelList");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) {
        openModelList(true);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      modelSel = modelRows.length ? Math.max(0, Math.min(modelRows.length - 1, modelSel + step)) : -1;
      renderModelList();
      return;
    }
    if (e.key === "Enter") {
      if (!list.hidden && modelSel >= 0 && modelRows[modelSel]) {
        e.preventDefault();
        chooseModel(modelRows[modelSel].id);
      }
      return;
    }
    if (e.key === "Escape") closeModelList();
  });

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest(".combo")) return;
    closeModelList();
  });
})();

document.querySelectorAll('input[name="src"]').forEach((r) => {
  r.addEventListener("change", async (e) => {
    const pasted = e.target.value === "pasted";
    if (pasted && !hasValidJson($("jsonInput").value)) {
      $("msg").textContent = "Nothing saved yet - automatic mode stays active. To use pasted JSON, paste it and click Save.";
      await chrome.storage.local.set({ usePastedJson: false });
      const apiEl = $('input[name="src"][value="api"]');
      if (apiEl) apiEl.checked = true;
      return;
    }
    await chrome.storage.local.set({ usePastedJson: pasted });
    $("msg").textContent = pasted
      ? "Using saved pasted JSON."
      : "Automatic mode - answers are taken from the page automatically. No input needed.";
  });
});

$("saveJson").addEventListener("click", async () => {
  const raw = $("jsonInput").value.trim();
  if (!raw) {
    $("msg").textContent = "Paste the JSON first if you want to use it.";
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    if (!Array.isArray(questions) || !questions.length) throw new Error("no questions array found");
    await chrome.storage.local.set({ questionsJson: raw, usePastedJson: false });
    const apiEl = $('input[name="src"][value="api"]');
    if (apiEl) apiEl.checked = true;
    $("msg").textContent = "Saved: " + questions.length + " questions. Automatic mode is still active; enable \"Pasted JSON\" above only if you need it.";
  } catch (e) {
    $("msg").textContent = "Invalid JSON: " + e.message;
  }
});

$("clearJson").addEventListener("click", async () => {
  await chrome.storage.local.set({ questionsJson: "", usePastedJson: false });
  $("jsonInput").value = "";
  const apiEl = $('input[name="src"][value="api"]');
  if (apiEl) apiEl.checked = true;
  $("msg").textContent = "Cleared. Automatic mode is active.";
});

function bgMsg(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) return resolve({ ok: false, error: String(err.message || err) });
      resolve(resp || { ok: false, error: "no response from background" });
    });
  });
}

async function checkStoreStatus() {
  const dot = $("storeDot");
  const status = $("storeStatus");
  if (!dot || !status) return;

  try {
    const resp = await bgMsg("FIREBASE_TEST", {});
    if (resp.ok) {
      dot.className = "status-dot connected";
      status.textContent = "Answer store: connected";
    } else {
      throw new Error(resp.error);
    }
  } catch (e) {
    dot.className = "status-dot disconnected";
    status.textContent = "Answer store: not reachable";
    console.warn("Answer store check failed:", e);
  }
}

async function checkCachedCount() {
  const el = $("cachedCount");
  const sharedEl = $("sharedCount");
  if (!el) return;
  try {
    const resp = await bgMsg("FIREBASE_COUNT", {});
    if (resp.ok) {
      el.textContent = resp.count;
      if (sharedEl) sharedEl.textContent = typeof resp.shared === "number" ? resp.shared : "-";
    } else {
      el.textContent = "-";
      if (sharedEl) sharedEl.textContent = "-";
    }
  } catch (e) {
    el.textContent = "-";
    if (sharedEl) sharedEl.textContent = "-";
  }
}

$("testStore").addEventListener("click", async () => {
  const btn = $("testStore");
  const original = btn.textContent;
  btn.textContent = "Testing...";
  btn.disabled = true;
  try {
    const resp = await bgMsg("FIREBASE_TEST", {});
    if (resp.ok) {
      btn.textContent = "Cache OK ✓";
    } else {
      btn.textContent = "Failed ✗";
    }
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
  } catch (e) {
    btn.textContent = "Failed ✗";
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
  }
});

$("testAI").addEventListener("click", async () => {
  const btn = $("testAI");
  const original = btn.textContent;
  btn.textContent = "Testing...";
  btn.disabled = true;
  try {
    // Tests whatever provider is currently active, with the saved settings.
    const resp = await bgMsg("AI_TEST", { provider: currentProvider });
    if (resp.ok && resp.answer && resp.answer.toLowerCase().includes("4")) {
      btn.textContent = "AI OK ✓";
    } else {
      btn.textContent = "AI: " + (resp.answer || resp.error || "none");
    }
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = "Failed ✗";
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
  }
});

load();
