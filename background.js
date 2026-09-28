import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp, limit, documentId, writeBatch } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBvEKfLTb8tldAVnA8Tt4dfop_NPPcLVs0",
  authDomain: "maya-e3c45.firebaseapp.com",
  projectId: "maya-e3c45",
  storageBucket: "maya-e3c45.firebasestorage.app",
  messagingSenderId: "1022697421806",
  appId: "1:1022697421806:web:4426cf286ba81c95b5ecff",
  measurementId: "G-MYXTJPFJGM"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
let OPENROUTER_API_KEY = "";
const FREE_MODELS = [
  "qwen/qwen3.8-27b:free",
  "z-ai/glm-5.2:free",
  "thinkingmachines/inkling-small:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free"
];
let MODEL_LIST = [...FREE_MODELS];
let workingModelIdx = 0;
let configLoadedAt = 0;

const GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
// Tried in order when the configured model is missing / shut down.
const GEMINI_MODEL_FALLBACKS = [
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite"
];
const CURRENT_VERSION = chrome.runtime.getManifest().version;
const UPDATE_CHECK_URL = "https://raw.githubusercontent.com/Vijayapardhu/maya-extension/main/version.json";

function versionParts(v) {
  return String(v || "").trim().replace(/^v/i, "").split(".").map((p) => parseInt(p, 10) || 0);
}

function isNewerVersion(remote, current) {
  const r = versionParts(remote);
  const c = versionParts(current);
  const len = Math.max(r.length, c.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] || 0;
    const b = c[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const resp = await fetch(UPDATE_CHECK_URL, { cache: "no-store" });
    if (!resp.ok) return;
    const data = await resp.json();
    const remoteVersion = String(data.version || "").trim();
    const url = String(data.url || "").trim();
    if (!remoteVersion) return;
    if (isNewerVersion(remoteVersion, CURRENT_VERSION)) {
      await chrome.storage.local.set({ updateAvailable: true, updateVersion: remoteVersion, updateUrl: url || UPDATE_CHECK_URL });
    } else {
      await chrome.storage.local.set({ updateAvailable: false, updateVersion: CURRENT_VERSION, updateUrl: "" });
    }
  } catch (e) {
    console.warn("Update check failed:", e);
  }
}

async function initializeUpdateChecker() {
  await checkForUpdate();
  chrome.alarms.create("maya-update-check", { periodInMinutes: 60 * 6 });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    initializeUpdateChecker();
  }
});

chrome.runtime.onStartup.addListener(() => {
  initializeUpdateChecker();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "maya-update-check") {
    checkForUpdate();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_UPDATE") {
    checkForUpdate().then(() => {
      chrome.storage.local.get(["updateAvailable", "updateVersion", "updateUrl"], (s) => {
        sendResponse({ ok: true, updateAvailable: !!s.updateAvailable, updateVersion: s.updateVersion, updateUrl: s.updateUrl });
      });
    });
    return true;
  }
});
let aiProvider = "gemini";
let geminiApiKey = "";
let geminiModel = DEFAULT_GEMINI_MODEL;

async function loadLocalProviderConfig() {
  try {
    const local = await chrome.storage.local.get(["aiProvider", "geminiApiKey", "geminiModel"]);
    if (local.aiProvider) aiProvider = String(local.aiProvider);
    geminiApiKey = local.geminiApiKey ? String(local.geminiApiKey).trim() : "";
    geminiModel = local.geminiModel ? String(local.geminiModel).trim() : DEFAULT_GEMINI_MODEL;
  } catch (e) {
    console.warn("Failed to load local provider config:", e);
  }
}

// Pick up key/model/provider changes from the popup without a reload.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("aiProvider" in changes) aiProvider = String(changes.aiProvider.newValue || "gemini");
  if ("geminiApiKey" in changes) geminiApiKey = String(changes.geminiApiKey.newValue || "").trim();
  if ("geminiModel" in changes) geminiModel = String(changes.geminiModel.newValue || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
});

async function loadConfig(force = false) {
  // Local provider settings are cheap to read and must never be skipped,
  // otherwise a just-saved Gemini key would not be picked up.
  await loadLocalProviderConfig();
  if (!force && configLoadedAt && Date.now() - configLoadedAt < 60000 && OPENROUTER_API_KEY) return;
  try {
    const ref = doc(db, "config", "ai");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.openrouterApiKey) OPENROUTER_API_KEY = String(data.openrouterApiKey).trim();
      if (Array.isArray(data.models) && data.models.length) {
        MODEL_LIST = data.models.map((m) => String(m).trim()).filter(Boolean);
        workingModelIdx = 0;
      } else if (data.model) {
        const m = normalizeModel(data.model);
        if (m) {
          MODEL_LIST = [m];
          workingModelIdx = 0;
        }
      }
      configLoadedAt = Date.now();
      console.log("Config loaded from Firebase:", { models: MODEL_LIST, hasKey: !!OPENROUTER_API_KEY });
    }
  } catch (e) {
    console.warn("Failed to load config from Firebase:", e);
  }
}

function normalizeModel(m) {
  const v = String(m || "").trim();
  // "auto" / "openrouter/auto" route to PAID models (causes 402) — never use them.
  if (!v || v === "auto" || v === "openrouter/auto") return "";
  return v;
}

async function ensureConfig() {
  if (!OPENROUTER_API_KEY) await loadConfig(true);
  else await loadConfig(false);
}

function extractText(message) {
  if (!message) return "";
  const c = message.content;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    const joined = c.map((p) => (typeof p === "string" ? p : p && p.text ? p.text : "")).join(" ").trim();
    if (joined) return joined;
  }
  if (typeof message.reasoning === "string" && message.reasoning.trim()) return message.reasoning.trim();
  return "";
}

function extractTextGemini(data) {
  const candidates = (data && data.candidates) || [];
  for (const c of candidates) {
    const parts = c && c.content && c.content.parts;
    if (!Array.isArray(parts)) continue;
    // Thinking models emit `thought: true` parts — never mix those into the answer.
    const text = parts
      .filter((p) => p && p.thought !== true && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}

function geminiErrorText(raw) {
  try {
    const err = JSON.parse(raw).error;
    if (err) return [err.code, err.status, err.message].filter(Boolean).join(" - ");
  } catch (e) {}
  return String(raw || "").replace(/\s+/g, " ").slice(0, 250);
}

function geminiModelsToTry(model) {
  const chosen = String(model || geminiModel || "").trim() || DEFAULT_GEMINI_MODEL;
  return [chosen, ...GEMINI_MODEL_FALLBACKS.filter((m) => m !== chosen)];
}

const OPTION_LETTER_RE = /^(?:the\s+)?(?:correct\s+)?(?:option|choice|answer|ans)?\s*[([{]?\s*([a-d1-4])\s*[)\]}.,:\-]?\s*$/i;
const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "to", "for", "and", "or", "it", "this", "that", "answer", "correct", "option", "choice", "best", "be", "as", "by", "at", "from", "we", "you"]);

function normText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^["'`]+/, "")
    .replace(/[.,;:!?"'`]+$/g, "")
    .trim();
}

function wordSet(s) {
  const out = new Set();
  for (const w of String(s || "").split(/[^a-z0-9]+/)) {
    if (w && !STOP_WORDS.has(w)) out.add(w);
  }
  return out;
}

/* Maps a model answer onto one of the four options and reports how sure we are.
   Nothing is ever guessed: "none" means the text matched no option, so the
   caller can retry instead of filling in a wrong choice. */
function matchAnswer(answer, options) {
  let raw = String(answer == null ? "" : answer).trim();
  raw = raw.replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").trim();
  if (!raw) return { text: "", confidence: "none" };

  const target = normText(raw);
  const opts = [];
  for (let i = 1; i <= 4; i++) {
    const v = options ? options[`option${i}`] : undefined;
    if (v === undefined || v === null || String(v).trim() === "") continue;
    const n = normText(v);
    opts.push({ index: i, text: String(v), norm: n, words: wordSet(n) });
  }
  if (!opts.length) return { text: raw, confidence: "none" };

  // 1. The whole answer is a letter/number: "B", "option 2", "(c)".
  //    Skipped when the options are themselves numbers - there "4" is a value,
  //    not "the fourth option".
  const numericOptions = opts.filter((o) => /^\d+$/.test(o.norm)).length >= 2;
  const letter = /^\d+$/.test(target) && numericOptions ? null : target.match(OPTION_LETTER_RE);
  if (letter) {
    const pos = { a: 1, b: 2, c: 3, d: 4, 1: 1, 2: 2, 3: 3, 4: 4 }[letter[1].toLowerCase()];
    const hit = opts.find((o) => o.index === pos);
    if (hit) return { text: hit.text, confidence: "letter", optionIndex: hit.index };
  }

  // 2. Exact option text.
  const exact = opts.find((o) => o.norm === target);
  if (exact) return { text: exact.text, confidence: "exact", optionIndex: exact.index };

  // 3. Substring, but only for long enough strings - "4" must not match "42".
  const contained = opts.filter((o) => {
    const short = o.norm.length <= target.length ? o.norm : target;
    const long = o.norm.length <= target.length ? target : o.norm;
    return short.length >= 5 && long.includes(short);
  });
  if (contained.length === 1) {
    return { text: contained[0].text, confidence: "contains", optionIndex: contained[0].index };
  }

  // 4. Word overlap, only when exactly one option is clearly covered.
  const scored = opts.map((o) => {
    if (!o.words.size) return { o, score: 0 };
    let hits = 0;
    for (const w of wordSet(target)) if (o.words.has(w)) hits++;
    return { o, score: hits / o.words.size };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best && best.score >= 0.6 && !(scored[1] && scored[1].score >= 0.6)) {
    return { text: best.o.text, confidence: "fuzzy", optionIndex: best.o.index };
  }

  return { text: raw, confidence: "none" };
}

function matchOption(answer, options) {
  return matchAnswer(answer, options).text;
}

// `overrides` lets the popup test an unsaved key/model (Connect button).
// Nothing is written to storage for an override run.
async function callGemini(prompt, retries = 1, maxTokens = 2048, overrides = null) {
  await loadLocalProviderConfig();
  const key = String((overrides && overrides.apiKey) || geminiApiKey || "").trim();
  if (!key) {
    return { ok: false, error: "Gemini API key not set. Paste your key in the popup and press Connect." };
  }
  const models = geminiModelsToTry(overrides && overrides.model);
  const persist = !overrides;
  let lastErr = "Gemini request failed";
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const url = `${GEMINI_API_URL_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Thinking models spend output tokens on reasoning, so grow the budget
      // on every attempt instead of returning an empty answer.
      const tokens = maxTokens * Math.pow(2, attempt);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            // Pro models reject a non-default temperature; flash models are
            // deterministic at 0, which keeps repeat runs consistent.
            generationConfig: { maxOutputTokens: tokens, temperature: /pro/i.test(model) ? undefined : 0 }
          })
        });
        const text = await response.text();
        if (!response.ok) {
          const reason = geminiErrorText(text);
          lastErr = `Gemini API ${response.status} (model=${model}): ` + reason;
          if (response.status === 401 || response.status === 403 || /api key/i.test(reason)) {
            return { ok: false, error: "Gemini rejected the API key (" + response.status + "). Check the key in the popup." };
          }
          if (response.status === 404 || response.status === 400) {
            // Model missing or shut down — move to the next candidate.
            console.warn(`Gemini model unusable (${model}):`, lastErr.slice(0, 160));
            break;
          }
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
            continue;
          }
          break;
        }
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* handled below */ }
        const answer = data ? extractTextGemini(data) : "";
        if (answer) {
          if (persist && model !== models[0]) {
            geminiModel = model;
            try { await chrome.storage.local.set({ geminiModel: model }); } catch (e) {}
          }
          return { ok: true, answer, raw: data, model, provider: "gemini" };
        }
        const finish = (data && data.candidates && data.candidates[0] && data.candidates[0].finishReason) || "unknown";
        lastErr = `Empty Gemini response (model=${model}, finish=${finish}): ` + text.slice(0, 250);
        if (attempt < retries) continue;
        break;
      } catch (e) {
        lastErr = `${model}: ` + String(e && e.message ? e.message : e);
        if (attempt < retries) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  console.warn("Gemini error:", String(lastErr).slice(0, 300));
  return { ok: false, error: lastErr || "request failed" };
}

async function callAI(prompt, retries = 1, maxTokens = 2048) {
  if (aiProvider === "gemini") {
    return callGemini(prompt, retries, maxTokens);
  }
  return _callOpenRouter(prompt, retries, maxTokens);
}

async function _callOpenRouter(prompt, retries = 1, maxTokens = 1024) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: "The shared AI key is not available. Use Gemini instead, or ask the maintainer to add openrouterApiKey under config/ai (free :free models need no credits)." };
  }
  let lastErr = "no free model available";
  for (let m = 0; m < MODEL_LIST.length; m++) {
    const idx = (workingModelIdx + m) % MODEL_LIST.length;
    const model = MODEL_LIST[idx];
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://maya.adityauniversity.in",
            "X-Title": "Maya AutoPilot"
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: maxTokens
          })
        });
        if (!response.ok) {
          lastErr = `API ${response.status} (model=${model}): ` + (await response.text()).slice(0, 300);
          const status = response.status;
          if (status === 402 || status === 404) {
            console.warn(`Free model unusable (${model}), trying next:`, lastErr.slice(0, 160));
            break; // next model, no point retrying this one
          }
          if (status === 429 && attempt < retries) {
            await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
            continue;
          }
          if (status === 429) break; // rate-limited on all attempts — try next model
          return { ok: false, error: lastErr };
        }
        const data = await response.json();
        const answer = extractText(data.choices?.[0]?.message);
        if (!answer) {
          lastErr = "Empty response (" + model + "): " + JSON.stringify(data).slice(0, 300);
          break; // try next model
        }
        workingModelIdx = idx; // stick with the model that works
        return { ok: true, answer, raw: data, model, provider: "openrouter" };
      } catch (e) {
        lastErr = `${model}: ` + String(e && e.message ? e.message : e);
        if (attempt < retries) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  console.warn("OpenRouter error:", String(lastErr).slice(0, 300));
  return { ok: false, error: lastErr || "request failed" };
}

/* The model returns the option LETTER, never the option text: a letter costs a
   couple of tokens where a copied sentence can cost fifty, and the option text
   is already known locally. buildTextPrompt is the fallback for a model that
   will not return letters. */
function buildPrompt(question, options, strict) {
  const head = strict
    ? "Re-read every option, then reply with the letter of the correct option only."
    : "Reply with the letter of the correct option only.";
  return `${head}

${question}

A. ${options.option1 ?? ""}
B. ${options.option2 ?? ""}
C. ${options.option3 ?? ""}
D. ${options.option4 ?? ""}

Answer:`;
}

function buildTextPrompt(question, options, strict) {
  const head = strict
    ? "Re-read every option, then copy the correct option text exactly as written."
    : "Copy the correct option text exactly as written.";
  return `${head}

${question}

A. ${options.option1 ?? ""}
B. ${options.option2 ?? ""}
C. ${options.option3 ?? ""}
D. ${options.option4 ?? ""}

Answer:`;
}

function buildMultiPrompt(questions, strict) {
  const lines = questions.map((q, i) => {
    const o = q.options || {};
    return `Q${i + 1} [id=${q.questionId}]: ${q.question}\n` +
      `  A. ${o.option1 ?? ""}\n  B. ${o.option2 ?? ""}\n  C. ${o.option3 ?? ""}\n  D. ${o.option4 ?? ""}`;
  });
  const head = strict
    ? `Re-check these ${questions.length} questions and reply with the letter of the correct option for each.`
    : `Answer these ${questions.length} questions.`;
  return `${head} Reply ONLY with a JSON array, nothing else.\n` +
    `[{"id":"<id>","a":"<A|B|C|D>"}, ...] - one entry per question, using the exact id shown.\n\n` +
    lines.join("\n");
}

function buildMultiTextPrompt(questions) {
  const lines = questions.map((q, i) => {
    const o = q.options || {};
    return `Q${i + 1} [id=${q.questionId}]: ${q.question}\n` +
      `  A. ${o.option1 ?? ""}\n  B. ${o.option2 ?? ""}\n  C. ${o.option3 ?? ""}\n  D. ${o.option4 ?? ""}`;
  });
  return `Copy the correct option text for each question. Reply ONLY with a JSON array, nothing else.\n` +
    `[{"id":"<id>","a":"<exact option text>"}, ...] - one entry per question, using the exact id shown.\n\n` +
    lines.join("\n");
}

const answerField = (item) =>
  item && typeof item === "object"
    ? (item.a ?? item.answer ?? item.option ?? item.text ?? "")
    : item;

function toResult(q, rawAnswer) {
  const m = matchAnswer(String(rawAnswer == null ? "" : rawAnswer), q.options || {});
  return { questionId: q.questionId, ok: true, answer: m.text, confidence: m.confidence };
}

function parseMultiResponse(text, questions) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/g, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) throw new Error("AI did not return a JSON array");
  const arr = JSON.parse(t.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error("AI JSON was not an array");
  const byId = new Map(questions.map((q) => [String(q.questionId), q]));
  const out = [];
  const used = new Set();
  // Pass 1 - only trust explicit ids.
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? item.questionId ?? item.qid ?? "").trim();
    const q = byId.get(id);
    if (!q || used.has(id)) continue;
    const rawAns = answerField(item);
    if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") continue;
    used.add(id);
    out.push(toResult(q, rawAns));
  }
  // Pass 2 - positional, but only when the array lines up 1:1 with the batch.
  // Anything else would silently shift answers onto the wrong questions.
  if (out.length < questions.length && arr.length === questions.length) {
    arr.forEach((item, i) => {
      const q = questions[i];
      if (!q) return;
      const id = String(q.questionId);
      if (used.has(id)) return;
      const rawAns = answerField(item);
      if (rawAns === undefined || rawAns === null || String(rawAns).trim() === "") return;
      used.add(id);
      out.push(toResult(q, rawAns));
    });
  }
  return out;
}

/* Rescue path for a reply that is not JSON: "1.B 2.C", "q1: B", or a bare
   list of letters. Only used when the JSON parse fails, and only when the
   counts line up, so a guess is never mapped onto the wrong question. */
function parseLooseLetters(text, questions) {
  const t = String(text || "");
  if (!t.trim() || !questions.length) return [];
  const out = [];
  for (const q of questions) {
    const id = String(q.questionId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = t.match(new RegExp(id + "\\s*[\"']?\\s*[:=\\-–]?\\s*[\"']?\\s*\\(?\\s*([a-d])\\b", "i"));
    if (!m) continue;
    const r = toResult(q, m[1]);
    if (r.confidence !== "none") out.push(r);
  }
  if (out.length === questions.length) return out;
  // Bare "A B C D" list, positional.
  const letters = t.match(/\b([a-d])\b/gi);
  if (letters && letters.length === questions.length) {
    questions.forEach((q, i) => {
      const r = toResult(q, letters[i]);
      if (r.confidence !== "none") out.push(r);
    });
  }
  return out;
}

/* Only questions with no usable answer are re-asked, in ONE extra batched call,
   and only once: a second miss is dropped rather than paid for again.
   A letter answer already maps to a known option, so it needs no re-check. */
const MAX_RECHECK_QUESTIONS = 12;

async function recheckUnmatched(results, questions, maxTokens) {
  const merged = new Map();
  for (const r of results) if (r && r.ok && r.confidence !== "none") merged.set(String(r.questionId), r);

  const retry = [];
  for (const q of questions) {
    if (retry.length >= MAX_RECHECK_QUESTIONS) break;
    if (!merged.has(String(q.questionId))) retry.push(q);
  }
  if (!retry.length) return [...merged.values()];

  const second = await callAI(buildMultiPrompt(retry, true), 0, maxTokens);
  if (second.ok) {
    try {
      for (const r of parseMultiResponse(second.answer, retry)) {
        if (!r || !r.ok || r.confidence === "none") continue;
        const id = String(r.questionId);
        if (!merged.has(id)) merged.set(id, r);
      }
    } catch (e) {
      console.warn("Re-check parse failed:", String(e).slice(0, 160));
    }
  } else {
    console.warn("Re-check failed, leaving those unanswered:", String(second.error).slice(0, 160));
  }

  const out = [...merged.values()];
  // "letter" is a precise mapping, so it is as good as a copied answer.
  for (const r of out) if (r.confidence === "contains" || r.confidence === "fuzzy") r.confidence = "weak";
  return out;
}

/* Nested store: tests/{testId} -> { answers: { [questionId]: { answer, questionText, updatedAt } } }.
   One read gets the whole test; one write saves a whole chunk. */

function testDocRef(testId) {
  return doc(db, "tests", String(testId));
}

async function readNestedAnswers(testId) {
  const snap = await getDoc(testDocRef(testId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  const map = data.answers && typeof data.answers === "object" ? data.answers : {};
  const results = {};
  const confidence = {};
  for (const [qid, entry] of Object.entries(map)) {
    if (entry && typeof entry === "object" && entry.answer) {
      results[qid] = entry.answer;
      if (entry.confidence) confidence[qid] = entry.confidence;
    } else if (typeof entry === "string") {
      results[qid] = entry;
    }
  }
  return { answers: results, confidence };
}

async function readLegacyAnswers(testId) {
  const q = query(collection(db, "answers"), where("testId", "==", testId));
  const snap = await getDocs(q);
  const results = {};
  snap.forEach((d) => {
    const data = d.data();
    if (data && data.questionId && data.answer) results[data.questionId] = data.answer;
  });
  return results;
}

async function writeNestedAnswers(testId, items) {
  // items: [{ questionId, questionText, options, answer, confidence }]
  const ref = testDocRef(testId);
  const snap = await getDoc(ref);
  const existing = snap.exists() && snap.data() && typeof snap.data().answers === "object" ? snap.data().answers : {};
  const next = { ...existing };
  for (const it of items) {
    if (!it.questionId || !it.answer) continue;
    next[it.questionId] = {
      answer: it.answer,
      questionText: it.questionText || "",
      // Only a real match is stored as exact; "weak" gets re-asked next run.
      // A letter answer is an exact pick of a known option, so it is exact.
      confidence: it.confidence === "weak" ? "weak" : "exact",
      updatedAt: new Date().toISOString()
    };
  }
  await setDoc(ref, { testId: String(testId), answers: next, updatedAt: serverTimestamp() }, { merge: true });
  const saved = await writeSharedQuestions(testId, items);
  return { total: Object.keys(next).length, shared: saved };
}

/* ---- shared question index ----
   tests/{testId} answers only helps a user retaking the SAME test. These docs
   are keyed by a hash of the question text, so the next user finds the answer
   even on a different test - a hashmap lookup instead of a scan.

     questions/{hash} = {
       h, q,                                  // hash + question text
       o: { a, b, c, d },                     // options, so the record is self-describing
       ans: { [testId]: { a, c, t } },        // hashmaps: testId -> answer
       u                                     // updatedAt
     }                                          c = confidence, t = timestamp                        */

const FIRMSHIRE_IN_CHUNK = 30; // Firestore "in" limit per query

function questionKey(question) {
  // Punctuation becomes a space, never nothing: "2+2" and "2 + 2" must not
  // collapse to different keys, and must not glue digits into "22".
  return String(question || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function hashQuestion(question) {
  const key = questionKey(question);
  if (!key) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

// Test IDs are used as map keys, so they must be free of field-path characters.
function safeTestKey(testId) {
  const v = String(testId || "");
  return v && !/[./*[\]~$#]/.test(v) ? v : "";
}

/* Writes question docs in batched commits with field-path merges, so one
   commit covers a whole test and answers from other tests are never read back
   or overwritten. An entry with an answer records it under ans.{testId};
   an entry without one just records that this test contains the question. */
const BANK_WRITE_CHUNK = 200;

async function writeQuestionDocs(entries) {
  const now = new Date().toISOString();
  let written = 0;
  for (let start = 0; start < entries.length; start += BANK_WRITE_CHUNK) {
    const batch = writeBatch(db);
    let inBatch = 0;
    for (const e of entries.slice(start, start + BANK_WRITE_CHUNK)) {
      const key = safeTestKey(e.testKey);
      if (!key || !e.hash) continue;
      // Only set fields we actually have, so a partial write can never blank
      // out question text or options another run already stored.
      const patch = { h: e.hash, u: serverTimestamp() };
      if (e.text) patch.q = e.text;
      const o = e.options || {};
      if (o.option1 || o.option2 || o.option3 || o.option4) {
        patch.o = { a: o.option1 || "", b: o.option2 || "", c: o.option3 || "", d: o.option4 || "" };
      }
      if (e.answer) {
        patch[`ans.${key}`] = { a: e.answer, c: e.confidence === "weak" ? "weak" : "exact", t: now };
      } else {
        patch[`seen.${key}`] = { t: now };
      }
      batch.set(doc(db, "questions", e.hash), patch, { merge: true });
      inBatch++;
    }
    if (!inBatch) continue;
    try {
      await batch.commit();
      written += inBatch;
    } catch (e) {
      console.warn("Question bank write failed:", String(e).slice(0, 200));
    }
  }
  return written;
}

async function writeSharedQuestions(testId, items) {
  const key = safeTestKey(testId);
  if (!key) return 0;
  const entries = [];
  for (const it of items) {
    if (!it.questionId || !it.answer) continue;
    const hash = await hashQuestion(it.questionText);
    if (hash) entries.push({ hash, text: it.questionText, options: it.options, answer: it.answer, confidence: it.confidence, testKey: key });
  }
  return writeQuestionDocs(entries);
}

// The whole question set, answered or not, so the bank grows as people browse.
async function writeQuestionBank(testId, questions) {
  const key = safeTestKey(testId);
  if (!key || !Array.isArray(questions) || !questions.length) return 0;
  const entries = [];
  for (const q of questions) {
    const text = q.questionText || q.question;
    const hash = await hashQuestion(text);
    if (hash) entries.push({ hash, text, options: q.options, testKey: key });
  }
  return writeQuestionDocs(entries);
}

// [{ questionId, hash }] -> { [questionId]: { answer, confidence, testId } }
async function readSharedQuestions(entries) {
  const out = {};
  if (!entries.length) return out;
  for (let i = 0; i < entries.length; i += FIRMSHIRE_IN_CHUNK) {
    const chunk = entries.slice(i, i + FIRMSHIRE_IN_CHUNK);
    const hashToId = new Map(chunk.map((e) => [e.hash, String(e.questionId)]));
    try {
      const snap = await getDocs(query(collection(db, "questions"), where(documentId(), "in", [...hashToId.keys()])));
      snap.forEach((d) => {
        const qid = hashToId.get(d.id);
        const data = d.data() || {};
        const ans = data.ans && typeof data.ans === "object" ? data.ans : {};
        // Newest answer for this question, whichever test it came from.
        let best = null;
        for (const [tid, entry] of Object.entries(ans)) {
          if (!entry || !entry.a) continue;
          if (!best || String(entry.t || "") > String(best.t || "")) best = { t: entry.t, a: entry.a, c: entry.c, tid };
        }
        if (qid && best) out[qid] = { answer: best.a, confidence: best.c === "weak" ? "weak" : "exact", testId: best.tid };
      });
    } catch (e) {
      console.warn("Shared question index read failed:", String(e).slice(0, 200));
    }
  }
  return out;
}

loadConfig(true);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_QUESTIONS") {
    chrome.cookies.getAll({ url: "https://api.maya.adityauniversity.in" }, (cookies) => {
      const headers = { "Content-Type": "application/json" };
      if (cookies && cookies.length) {
        headers["Cookie"] = cookies.map((c) => c.name + "=" + c.value).join("; ");
      }
      fetch("https://api.maya.adityauniversity.in/node/api/get-grand-assessment-questions-by-id", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ id: msg.id, roll_no: msg.rollNo || null })
      })
        .then(async (resp) => {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          return resp.json();
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
    });
    return true;
  }

  if (msg.type === "FIREBASE_GET_ANSWERS") {
      (async () => {
          try {
              // 1. This test's own hashmap - one read for every question.
              const nested = await readNestedAnswers(msg.testId);
              const answers = { ...((nested && nested.answers) || {}) };
              const confidence = { ...((nested && nested.confidence) || {}) };
              let sharedHits = 0;
              // 2. Anything still unanswered: look the question text up in the
              //    shared index, so another user's answer still counts.
              const questions = Array.isArray(msg.questions) ? msg.questions : [];
              const missing = questions.filter((q) => q && q.questionId && !answers[String(q.questionId)]);
              if (missing.length) {
                const entries = [];
                for (const q of missing) {
                  const hash = await hashQuestion(q.question);
                  if (hash) entries.push({ questionId: String(q.questionId), hash });
                }
                const shared = await readSharedQuestions(entries);
                for (const [qid, hit] of Object.entries(shared)) {
                  if (answers[qid]) continue;
                  answers[qid] = hit.answer;
                  confidence[qid] = hit.confidence;
                  sharedHits++;
                }
              }
              if (Object.keys(answers).length) {
                sendResponse({
                  ok: true,
                  answers,
                  confidence,
                  sharedHits,
                  source: sharedHits ? "test+shared" : "nested"
                });
                return;
              }
              // Fallback: legacy flat collection (pre-nesting installs)
              const legacy = await readLegacyAnswers(msg.testId);
              sendResponse({ ok: true, answers: legacy, confidence: {}, sharedHits: 0, source: "legacy" });
          } catch (e) {
              sendResponse({ ok: false, error: String(e) });
          }
      })();
      return true;
  }

  if (msg.type === "STORE_QUESTIONS") {
    (async () => {
      try {
        const stored = await writeQuestionBank(msg.testId, msg.questions);
        sendResponse({ ok: true, stored });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === "FIREBASE_SAVE_ANSWERS") {
      (async () => {
          try {
              const items = Array.isArray(msg.answers) ? msg.answers : [];
              try {
                const res = await writeNestedAnswers(msg.testId, items);
                sendResponse({ ok: true, saved: items.length, total: res.total, shared: res.shared, store: "nested" });
              } catch (nestedErr) {
                // Fallback: legacy flat docs (e.g. security rules only allow `answers`)
                console.warn("Nested save failed, falling back to flat docs:", String(nestedErr).slice(0, 200));
                let saved = 0;
                for (const it of items) {
                  if (!it.questionId || !it.answer) continue;
                  try {
                    await setDoc(doc(db, "answers", `${msg.testId}_${it.questionId}`), {
                      testId: msg.testId,
                      questionId: it.questionId,
                      questionText: it.questionText || "",
                      answer: it.answer,
                      updatedAt: serverTimestamp()
                    }, { merge: true });
                    saved++;
                  } catch (e) { console.warn("Flat save failed:", it.questionId, String(e).slice(0, 120)); }
                }
                sendResponse({ ok: true, saved, store: "legacy" });
              }
          } catch (e) {
              sendResponse({ ok: false, error: String(e), saved: 0 });
          }
      })();
      return true;
  }

  // NOTE: no per-question Firebase calls — everything is keyed by test ID
  // (tests/{testId}.answers) plus a shared questions/{hash} index, so one
  // read covers a whole test and one write covers a whole chunk.

  if (msg.type === "FIREBASE_TEST") {
    (async () => {
      try {
        // OK if EITHER store is reachable (nested is new, flat is legacy)
        let ok = false, lastErr = "";
        try { await getDocs(query(collection(db, "tests"), limit(1))); ok = true; }
        catch (e) { lastErr = String(e); }
        if (!ok) {
          try { await getDocs(query(collection(db, "questions"), limit(1))); ok = true; }
          catch (e) { lastErr = String(e); }
        }
        if (!ok) {
          try { await getDocs(query(collection(db, "answers"), limit(1))); ok = true; }
          catch (e) { lastErr = String(e); }
        }
        if (ok) sendResponse({ ok: true });
        else sendResponse({ ok: false, error: lastErr });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "FIREBASE_COUNT") {
    (async () => {
      try {
        let total = 0, tests = 0, shared = 0;
        try {
          const snap = await getDocs(collection(db, "tests"));
          tests = snap.size;
          snap.forEach((d) => {
            const a = d.data() && d.data().answers;
            if (a && typeof a === "object") total += Object.keys(a).length;
          });
        } catch (e) { /* nested store may not exist yet */ }
        try {
          const snap = await getDocs(collection(db, "questions"));
          shared = snap.size;
        } catch (e) { /* shared index may not exist yet */ }
        try {
          const legacy = await getDocs(collection(db, "answers"));
          total += legacy.size;
        } catch (e) { /* legacy may be locked down */ }
        sendResponse({ ok: true, count: total, tests, shared });
      } catch (e) {
        sendResponse({ ok: false, error: String(e), count: 0, shared: 0 });
      }
    })();
    return true;
  }

  // Connection check: runs one real command with the *pending* settings.
  // The popup only saves them when this comes back ok.
  if (msg.type === "AI_TEST") {
    (async () => {
      const provider = msg.provider === "openrouter" ? "openrouter" : "gemini";
      const options = msg.options || { option1: "3", option2: "4", option3: "5", option4: "6" };
      const question = msg.question || "What is 2+2?";
      try {
        const prompt = buildPrompt(question, options);
        const result = provider === "gemini"
          ? await callGemini(prompt, 0, 256, { apiKey: msg.apiKey, model: msg.model })
          : await (async () => { await ensureConfig(); return _callOpenRouter(prompt, 0, 128); })();
        if (!result.ok) {
          console.warn(`AI_TEST ${provider} failed:`, result.error);
          sendResponse({ ok: false, error: result.error, provider });
          return;
        }
        sendResponse({
          ok: true,
          provider,
          model: result.model,
          answer: matchAnswer(result.answer, options).text
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e), provider });
      }
    })();
    return true;
  }

  if (msg.type === "OPENROUTER_ANSWER") {
    (async () => {
      try {
        await ensureConfig();
        const options = msg.options || {};
        const result = await callAI(buildPrompt(msg.question, options), 1, 512);
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error });
          return;
        }
        const matched = matchAnswer(result.answer, options);
        console.log("AI single response:", JSON.stringify(result.raw).slice(0, 300));
        if (matched.confidence === "none") {
          // No guess: one cheap re-ask, then leave the question alone.
          const retry = await callAI(buildTextPrompt(msg.question, options), 0, 512);
          const retryMatch = retry.ok ? matchAnswer(retry.answer, options) : { text: "", confidence: "none" };
          const final = retryMatch.confidence !== "none" ? retryMatch : matched;
          sendResponse({ ok: final.confidence !== "none", answer: final.text, confidence: final.confidence, model: result.model, provider: result.provider });
          return;
        }
        sendResponse({ ok: true, answer: matched.text, confidence: matched.confidence, model: result.model, provider: result.provider });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "OPENROUTER_BATCH_ANSWER") {
    (async () => {
      try {
        await ensureConfig();
        const { questions } = msg;
        if (!Array.isArray(questions) || !questions.length) {
          sendResponse({ ok: false, error: "batch: no questions received" });
          return;
        }
        const provider = aiProvider === "gemini" ? "gemini" : "openrouter-free";
        console.log(`AI batch start: ${questions.length} questions, 1 call, provider=${provider}`);
        const prompt = buildMultiPrompt(questions);
        // Letters back => a tiny reply, so a small budget is plenty.
        const maxTokens = aiProvider === "gemini" ? 2048 : 1536;
        const r = await callAI(prompt, 1, maxTokens);
        if (!r.ok) {
          sendResponse({ ok: false, error: r.error });
          return;
        }
        let results = [];
        try {
          results = parseMultiResponse(r.answer, questions);
        } catch (parseErr) {
          // A model that ignored the JSON contract usually still lists the
          // letters. Recovering them here saves one call per question.
          results = parseLooseLetters(r.answer, questions);
          console.warn("JSON parse failed, recovered from free text:", results.length + "/" + questions.length,
            String(parseErr).slice(0, 120));
        }

        if (results.length) {
          results = await recheckUnmatched(results, questions, maxTokens);
          console.log("AI batch done:", results.length + "/" + questions.length,
            "letters:", results.filter((x) => x && x.confidence === "letter").length);
          sendResponse({ ok: true, results, provider });
          return;
        }

        // Nothing usable at all - last resort, one small call per question.
        const CONCURRENCY = 3;
        const singles = new Array(questions.length);
        let cursor = 0;
        async function worker() {
          while (cursor < questions.length) {
            const i = cursor++;
            const q = questions[i];
            try {
              const single = await callAI(buildPrompt(q.question, q.options || {}), 0, 512);
              if (!single.ok) {
                singles[i] = { questionId: q.questionId, ok: false, error: single.error };
              } else {
                const m = matchAnswer(single.answer, q.options || {});
                singles[i] = { questionId: q.questionId, ok: m.confidence !== "none", answer: m.text, confidence: m.confidence };
              }
            } catch (e) {
              singles[i] = { questionId: q.questionId, ok: false, error: String(e) };
            }
            await new Promise((rr) => setTimeout(rr, 250));
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, questions.length) }, () => worker()));
        console.log("AI per-question fallback done:", singles.filter((x) => x && x.ok).length + "/" + singles.length);
        sendResponse({ ok: true, results: singles, provider });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});