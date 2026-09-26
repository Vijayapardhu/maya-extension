import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp, limit } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

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
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
let aiProvider = "openrouter";
let geminiApiKey = "";
let geminiModel = DEFAULT_GEMINI_MODEL;

async function loadLocalProviderConfig() {
  try {
    const local = await chrome.storage.local.get(["aiProvider", "geminiApiKey", "geminiModel"]);
    if (local.aiProvider) aiProvider = String(local.aiProvider);
    if (local.geminiApiKey) geminiApiKey = String(local.geminiApiKey).trim();
    if (local.geminiModel) geminiModel = String(local.geminiModel).trim();
  } catch (e) {
    console.warn("Failed to load local provider config:", e);
  }
}

async function loadConfig(force = false) {
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
  try { await loadLocalProviderConfig(); } catch (e) {}
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
  try {
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    if (Array.isArray(parts)) {
      return parts.map((p) => (typeof p === "string" ? p : p && p.text ? p.text : "")).join(" ").trim();
    }
  } catch (e) {}
  return "";
}

function matchOption(answer, options) {
  if (!answer) return null;
  let text = String(answer).trim();
  // Strip markdown fences / quotes
  text = text.replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").trim();
  const normalized = text.toLowerCase().trim();
  const opts = [1, 2, 3, 4].map((i) => options[`option${i}`]).filter(Boolean);
  // Exact match first
  for (let i = 1; i <= 4; i++) {
    const opt = options[`option${i}`];
    if (opt && opt.toLowerCase().trim() === normalized) return opt;
  }
  // Contains match
  for (let i = 1; i <= 4; i++) {
    const opt = options[`option${i}`];
    if (!opt) continue;
    const o = opt.toLowerCase().trim();
    if (o && (normalized.includes(o) || o.includes(normalized))) return opt;
  }
  // Letter / number fallback: "A", "B)", "Option 2", "2.", "(3)"
  const m = normalized.match(/(?:option\s*)?\(?\s*([a-d1-4])\s*[).:\-]*/i);
  if (m) {
    const tok = m[1].toLowerCase();
    const idxMap = { a: 1, b: 2, c: 3, d: 4, 1: 1, 2: 2, 3: 3, 4: 4 };
    const idx = idxMap[tok];
    if (idx && options[`option${idx}`]) return options[`option${idx}`];
  }
  void opts;
  return text;
}

async function callGemini(prompt, retries = 1, maxTokens = 1024) {
  if (!geminiApiKey) {
    return { ok: false, error: "Gemini API key not configured. Add it in the extension popup." };
  }
  const model = geminiModel || DEFAULT_GEMINI_MODEL;
  const url = `${GEMINI_API_URL_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  let lastErr = "Gemini request failed";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens }
        })
      });
      if (!response.ok) {
        lastErr = `Gemini API ${response.status}: ` + (await response.text()).slice(0, 300);
        if (response.status === 429 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        return { ok: false, error: lastErr };
      }
      const data = await response.json();
      const answer = extractTextGemini(data);
      if (!answer) {
        lastErr = "Empty Gemini response: " + JSON.stringify(data).slice(0, 300);
        continue;
      }
      return { ok: true, answer, raw: data, model, provider: "gemini" };
    } catch (e) {
      lastErr = `${model}: ` + String(e && e.message ? e.message : e);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800));
    }
  }
  console.warn("Gemini error:", String(lastErr).slice(0, 300));
  return { ok: false, error: lastErr || "request failed" };
}

async function callAI(prompt, retries = 1, maxTokens = 1024) {
  if (aiProvider === "gemini") {
    return callGemini(prompt, retries, maxTokens);
  }
  return _callOpenRouter(prompt, retries, maxTokens);
}

async function _callOpenRouter(prompt, retries = 1, maxTokens = 1024) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, error: "OpenRouter API key not configured in Firebase. Add it to Firestore config/ai as openrouterApiKey (free :free models need no credits)." };
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

function buildPrompt(question, options) {
  const o1 = options.option1 ?? "";
  const o2 = options.option2 ?? "";
  const o3 = options.option3 ?? "";
  const o4 = options.option4 ?? "";
  return `Answer this multiple choice question. Return ONLY the correct option text (exactly as it appears in the options).

Question: ${question}

Options:
1. ${o1}
2. ${o2}
3. ${o3}
4. ${o4}

Correct answer (option text only):`;
}

function buildMultiPrompt(questions) {
  const lines = questions.map((q, i) => {
    const o = q.options || {};
    return `Q${i + 1} [id=${q.questionId}]: ${q.question}\n` +
      `  A. ${o.option1 ?? ""}\n  B. ${o.option2 ?? ""}\n  C. ${o.option3 ?? ""}\n  D. ${o.option4 ?? ""}`;
  });
  return `Answer each multiple choice question. For every question return the option text EXACTLY as it appears in its options.\n\n` +
    lines.join("\n") + `\n\n` +
    `Return ONLY a JSON array, no other text. Format:\n` +
    `[{"questionId":"<id>","answer":"<exact option text>"}, ...]\n` +
    `Include all ${questions.length} questions in order.`;
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
  arr.forEach((item, i) => {
    if (!item) return;
    const id = String(item.questionId ?? item.id ?? questions[i]?.questionId ?? "");
    const q = byId.get(id) || questions[i];
    if (!q) return;
    const rawAns = item.answer ?? item.option ?? item.text ?? "";
    out.push({ questionId: q.questionId, ok: true, answer: matchOption(String(rawAns), q.options || {}) });
  });
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
  for (const [qid, entry] of Object.entries(map)) {
    if (entry && typeof entry === "object" && entry.answer) results[qid] = entry.answer;
    else if (typeof entry === "string") results[qid] = entry;
  }
  return results;
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
  // items: [{ questionId, questionText, answer }]
  const ref = testDocRef(testId);
  const snap = await getDoc(ref);
  const existing = snap.exists() && snap.data() && typeof snap.data().answers === "object" ? snap.data().answers : {};
  const next = { ...existing };
  for (const it of items) {
    if (!it.questionId || !it.answer) continue;
    next[it.questionId] = { answer: it.answer, questionText: it.questionText || "", updatedAt: new Date().toISOString() };
  }
  await setDoc(ref, { testId: String(testId), answers: next, updatedAt: serverTimestamp() }, { merge: true });
  return Object.keys(next).length;
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
              // Nested: one read for the whole test
              const nested = await readNestedAnswers(msg.testId);
              if (nested && Object.keys(nested).length) {
                sendResponse({ ok: true, answers: nested, source: "nested" });
                return;
              }
              // Fallback: legacy flat collection (pre-nesting installs)
              const legacy = await readLegacyAnswers(msg.testId);
              sendResponse({ ok: true, answers: legacy, source: nested ? "nested-empty" : "legacy" });
          } catch (e) {
              sendResponse({ ok: false, error: String(e) });
          }
      })();
      return true;
  }

  if (msg.type === "FIREBASE_SAVE_ANSWERS") {
      (async () => {
          try {
              const items = Array.isArray(msg.answers) ? msg.answers : [];
              try {
                const total = await writeNestedAnswers(msg.testId, items);
                sendResponse({ ok: true, saved: items.length, total, store: "nested" });
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

  // NOTE: no per-question Firebase calls — everything is keyed by test ID:
  // FIREBASE_GET_ANSWERS (one read) + FIREBASE_SAVE_ANSWERS (one write).
  // REVIEW_GET_ANSWERS (one call per test — exact answers from the platform).

  if (msg.type === "REVIEW_GET_ANSWERS") {
      (async () => {
          try {
              // credentials:"include" sends the Maya auth cookies (host permission granted)
              const response = await fetch("https://api.maya.adityauniversity.in/node/api/review-grand-assessment", {
                  method: "POST",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                      assessment: msg.testId,
                      test_type: "general",
                      roll_no: msg.rollNo || null
                  })
              });
              const text = await response.text();
              if (!response.ok) {
                  sendResponse({ ok: false, error: `Review API ${response.status}: ` + text.slice(0, 300) });
                  return;
              }
              let data;
              try {
                  data = JSON.parse(text);
              } catch (e) {
                  sendResponse({ ok: false, error: "Review API returned bad JSON" });
                  return;
              }
              const items = Array.isArray(data.question_details) ? data.question_details
                  : Array.isArray(data.questions) ? data.questions
                  : Array.isArray(data.data) ? data.data
                  : (data.data && Array.isArray(data.data.question_details)) ? data.data.question_details
                  : [];
              const answers = {};
              for (const it of items) {
                  if (!it || typeof it !== "object") continue;
                  const qid = it.question_id || it.questionId || it._id || it.id;
                  const ans = it.answer ?? it.correct_answer ?? it.correctAnswer;
                  if (qid && ans !== undefined && ans !== null && String(ans).trim() !== "") {
                      answers[String(qid)] = ans;
                  }
              }
              console.log(`Review API: ${Object.keys(answers).length} exact answers for test ${msg.testId}`);
              sendResponse({ ok: true, answers, total: Object.keys(answers).length });
          } catch (e) {
              sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
          }
      })();
      return true;
  }

  if (msg.type === "FIREBASE_TEST") {
    (async () => {
      try {
        // OK if EITHER store is reachable (nested is new, flat is legacy)
        let ok = false, lastErr = "";
        try { await getDocs(query(collection(db, "tests"), limit(1))); ok = true; }
        catch (e) { lastErr = String(e); }
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
        let total = 0, tests = 0;
        try {
          const snap = await getDocs(collection(db, "tests"));
          tests = snap.size;
          snap.forEach((d) => {
            const a = d.data() && d.data().answers;
            if (a && typeof a === "object") total += Object.keys(a).length;
          });
        } catch (e) { /* nested store may not exist yet */ }
        try {
          const legacy = await getDocs(collection(db, "answers"));
          total += legacy.size;
        } catch (e) { /* legacy may be locked down */ }
        sendResponse({ ok: true, count: total, tests });
      } catch (e) {
        sendResponse({ ok: false, error: String(e), count: 0 });
      }
    })();
    return true;
  }

  if (msg.type === "OPENROUTER_ANSWER") {
    (async () => {
      try {
        await ensureConfig();
        const prompt = buildPrompt(msg.question, msg.options || {});
        const result = await callAI(prompt, 1);
        if (!result.ok) {
          sendResponse({ ok: false, error: result.error });
          return;
        }
        console.log("AI single response:", JSON.stringify(result.raw).slice(0, 300));
        sendResponse({ ok: true, answer: matchOption(result.answer, msg.options || {}), model: result.model, provider: result.provider });
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
        const r = await callAI(prompt, 1, 4096);
        if (!r.ok) {
          sendResponse({ ok: false, error: r.error });
          return;
        }
        try {
          const results = parseMultiResponse(r.answer, questions);
          console.log("AI batch done:", results.filter((x) => x && x.ok).length + "/" + questions.length);
          sendResponse({ ok: true, results, provider });
        } catch (parseErr) {
          console.warn("Multi-answer parse failed, falling back to single calls:", String(parseErr).slice(0, 200));
          const CONCURRENCY = 3;
          const results = new Array(questions.length);
          let cursor = 0;
          async function worker() {
            while (cursor < questions.length) {
              const i = cursor++;
              const q = questions[i];
              try {
                const single = await callAI(buildPrompt(q.question, q.options || {}), 1);
                if (!single.ok) {
                  results[i] = { questionId: q.questionId, ok: false, error: single.error };
                } else {
                  results[i] = { questionId: q.questionId, ok: true, answer: matchOption(single.answer, q.options || {}) };
                }
              } catch (e) {
                results[i] = { questionId: q.questionId, ok: false, error: String(e) };
              }
              await new Promise((rr) => setTimeout(rr, 250));
            }
          }
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, questions.length) }, () => worker()));
          console.log("AI batch fallback done:", results.filter((x) => x && x.ok).length + "/" + results.length);
          sendResponse({ ok: true, results, provider });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});