const $ = (id) => document.getElementById(id);

const defaults = { autoRun: true, autoAdvance: true, usePastedJson: false, questionsJson: "", useReviewApi: true, useFirebase: true, useAI: true };

function hasValidJson(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const questions = Array.isArray(parsed) ? parsed : parsed && parsed.questions;
    return Array.isArray(questions) && questions.length > 0;
  } catch (e) {
    return false;
  }
}

async function load() {
  const s = await chrome.storage.local.get(defaults);
  const runEl = $("autoRun");
  const advEl = $("autoAdvance");
  const reviewEl = $("useReviewApi");
  const firebaseEl = $("useFirebase");
  const aiEl = $("useAI");
  if (runEl) runEl.checked = s.autoRun;
  if (advEl) advEl.checked = s.autoAdvance;
  if (reviewEl) reviewEl.checked = s.useReviewApi;
  if (firebaseEl) firebaseEl.checked = s.useFirebase;
  if (aiEl) aiEl.checked = s.useAI;
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
  checkFirebaseStatus();
  checkCachedCount();
}

["autoRun", "autoAdvance", "useReviewApi", "useFirebase", "useAI"].forEach((id) => {
  $(id).addEventListener("change", async (e) => {
    await chrome.storage.local.set({ [id]: e.target.checked });
  });
});

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
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => resolve(resp));
  });
}

async function checkFirebaseStatus() {
  const dot = $("firebaseDot");
  const status = $("firebaseStatus");
  if (!dot || !status) return;
  
  try {
    const resp = await bgMsg("FIREBASE_TEST", {});
    if (resp.ok) {
      dot.className = "status-dot connected";
      status.textContent = "Firebase: connected";
    } else {
      throw new Error(resp.error);
    }
  } catch (e) {
    dot.className = "status-dot disconnected";
    status.textContent = "Firebase: not configured or error";
    console.warn("Firebase check failed:", e);
  }
}

async function checkCachedCount() {
  const el = $("cachedCount");
  if (!el) return;
  try {
    const resp = await bgMsg("FIREBASE_COUNT", {});
    if (resp.ok) {
      el.textContent = resp.count;
    } else {
      el.textContent = "-";
    }
  } catch (e) {
    el.textContent = "-";
  }
}

$("testFirebase").addEventListener("click", async () => {
  const btn = $("testFirebase");
  const original = btn.textContent;
  btn.textContent = "Testing...";
  btn.disabled = true;
  try {
    const resp = await bgMsg("FIREBASE_TEST", {});
    if (resp.ok) {
      btn.textContent = "Firebase OK ✓";
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
    const resp = await bgMsg("OPENROUTER_ANSWER", {
      question: "What is 2+2?",
      options: { option1: "3", option2: "4", option3: "5", option4: "6" }
    });
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
