(() => {
  if (window.__mayaAutoFillLoaded) return;
  window.__mayaAutoFillLoaded = true;

  const pathMatch = location.pathname.match(/grand-assessment\/([^/]+)/);
  let ASSESS_ID = pathMatch ? pathMatch[1] : null;
  let isDeepDive = location.pathname.includes("emp-skills-deep-dive-in");
  let singleQ = null;
  let deepDiveSolved = 0;

  /* ---------------- helpers ---------------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (fn, timeout = 3000, interval = 40) =>
     new Promise((resolve) => {
       const t0 = Date.now();
       (function poll() {
         if (abortRequested) return resolve(false);
         let done = false;
         try { done = fn(); } catch (e) { /* ignore */ }
         if (done) return resolve(true);
         if (Date.now() - t0 > timeout) return resolve(false);
         setTimeout(poll, interval);
       })();
     });

  function decodeEntities(s) {
    const ta = document.createElement("textarea");
    ta.innerHTML = s;
    return ta.value;
  }

  /* Mirrors the page's fullyDecodeString(): he.decode -> \uXXXX -> strip tags -> &nbsp; -> \n -> <br/> -> trim */
function decode(s) {
    if (!s || typeof s !== "string") return "";
    try {
        let d = decodeEntities(s);
        d = d.replace(/\\u([\dA-F]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
        d = d.replace(/<[^>]+>/g, "");
        d = d.replace(/^&nbsp;/, "").replace(/&nbsp;/g, "");
        d = d.replace(/\\r\\n|\\n|\\r/g, "<br/>");
        return d.trim();
    } catch (e) {
        return s;
    }
  }

  const post = (data) => {
    try {
      window.postMessage({ source: "maya-af-hook", type: "questions", data: data }, "*");
    } catch (e) {}
  };
const postMeta = (meta) => {
    try {
      window.postMessage({ source: "maya-af-hook", type: "meta", data: meta }, "*");
    } catch (e) {}
  };

  const normalize = (s) =>
    decode(s).replace(/<br\/>/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

  /* ---------------- state ---------------- */

  let apiQuestions = [];
  let byText = new Map();
  let autoRun = true;
  let autoAdvance = true;
  // Firebase + AI are always on (no toggles — this is the only answer path).
  let useFirebase = true;
  let useAI = true;
  let running = false;
  let abortRequested = false;
  let matched = 0;
  let dataSource = "none"; /* "captured" | "pasted" | "firebase" | "ai" */
  let pendingForceSweep = false;
  let capturedMeta = null;
  let lastSubmittedQ = null;
  let lastAnsweredCount = -1;
  let failedQ = null;
  let failedCount = 0;
  let firebaseEnabled = false;

  /* ---------------- data loading ---------------- */

  function parseQuestions(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.questions)) return raw.questions;
    return [];
  }

  function setQuestions(qs) {
    apiQuestions = qs;
    byText = new Map(apiQuestions.map((q) => [normalize(q.question), q]));
    lastAnsweredCount = -1;
    storeQuestions();
  }

  /* Every question that appears in a test is written to the shared bank, not
     just the answered ones, so the next person starts with the full set.
     Each question is only sent once per session. */
  const storedQuestionIds = new Set();

  async function storeQuestions() {
    if (!ASSESS_ID || !useFirebase) return;
    const fresh = apiQuestions.filter((q) => q && q._id && q.question && !storedQuestionIds.has(q._id));
    if (!fresh.length) return;
    fresh.forEach((q) => storedQuestionIds.add(q._id));
    const questions = fresh.map((q) => {
      const o = getOptions(q);
      return {
        questionId: q._id,
        questionText: q.question,
        options: { option1: o.option1 || "", option2: o.option2 || "", option3: o.option3 || "", option4: o.option4 || "" }
      };
    });
    try {
      const resp = await bgMsg("STORE_QUESTIONS", { testId: ASSESS_ID, questions }, 30000);
      console.log(`[MayaAF] Stored ${questions.length} questions in the bank:`, resp && resp.ok ? "ok" : (resp && resp.error) || "failed");
    } catch (e) {
      // Let a later question set retry them.
      fresh.forEach((q) => storedQuestionIds.delete(q._id));
      console.warn("[MayaAF] Storing questions failed:", e);
    }
  }

  function useCapturedData(data) {
    if (isDeepDive && data && !Array.isArray(data) && !data.questions && data.question && data.answer) {
      return captureSingleQuestion(data);
    }
    const qs = parseQuestions(data);
    if (!qs.length) {
      console.warn("[MayaAF] Captured data has no questions:", data);
      return;
    }
    if (dataSource === "captured") return;
    const wasFallback = dataSource !== "captured";
    dataSource = "captured";
    setQuestions(qs);
    console.log("[MayaAF] Captured questions:", apiQuestions.length);
    setStatus("Answers captured from the page's network request: " + apiQuestions.length + " questions");
    updateProgress();
    flashPanel();
    if (running) return;
    if (ASSESS_ID && useFirebase) {
      console.log("[MayaAF] useCapturedData triggering the answer load");
      loadFirebaseAndAI().then(() => {
        console.log("[MayaAF] After the answer load - answered:", apiQuestions.filter(q => q.answer).length);
        const answered = apiQuestions.filter(q => q.answer);
        console.log("[MayaAF] Answered questions:", answered.map(q => ({ id: q._id, answer: q.answer, question: q.question?.substring(0, 50) })));
        if (answered.length > 0) {
          setStatus(`Loaded ${answered.length} saved answers`);
        }
        if (autoRun) {
          if (wasFallback) {
            pendingForceSweep = true;
            autoFillAll();
          } else {
            const radios = $$('input[type=radio][name^="question"]');
            if (radios.length && !radios.some((r) => r.checked)) {
              if (autoAdvance) autoFillAll();
              else fillCurrentQuestion(false).then(updateProgress);
            }
          }
        }
      }).catch((e) => console.warn("[MayaAF] answer load failed:", e));
    } else if (autoRun && !running) {
      if (wasFallback) {
        pendingForceSweep = true;
        autoFillAll();
      } else {
        const radios = $$('input[type=radio][name^="question"]');
        if (radios.length && !radios.some((r) => r.checked)) {
          if (autoAdvance) autoFillAll();
          else fillCurrentQuestion(false).then(updateProgress);
        }
      }
    }
  }

  function captureSingleQuestion(q) {
    if (!q || !q.question) return;
    singleQ = q;
    dataSource = "captured";
    setQuestions([q]);
    setStatus("Captured question from the page - filling...");
    updateProgress();
    if (ASSESS_ID && useFirebase) {
      console.log("[MayaAF] captureSingleQuestion triggering the answer load");
      loadFirebaseAndAI().then(() => {
        console.log("[MayaAF] After the answer load - singleQ answer:", singleQ?.answer);
        if (singleQ?.answer) {
          setStatus(`Loaded answer: ${singleQ.answer}`);
        }
        if (autoRun && !running) autoFillAll();
        else fillCurrentQuestion(false).then(updateProgress);
      }).catch((e) => console.warn("[MayaAF] answer load failed:", e));
    } else if (autoRun && !running) {
      autoFillAll();
    } else {
      fillCurrentQuestion(false).then(updateProgress);
    }
  }

  window.addEventListener("message", (e) => {
    if (e.data && e.data.source === "maya-af-hook" && e.data.type === "questions") {
      console.log("[MayaAF] Received questions via message:", e.data.data);
      useCapturedData(e.data.data);
    } else if (e.data && e.data.source === "maya-af-hook" && e.data.type === "meta") {
      capturedMeta = e.data.data || null;
      console.log("[MayaAF] Received meta:", capturedMeta);
      if (capturedMeta && capturedMeta.id && !ASSESS_ID) {
        ASSESS_ID = capturedMeta.id;
        console.log("[MayaAF] Updated ASSESS_ID from meta:", ASSESS_ID);
      }
      if (capturedMeta && capturedMeta.id) {
        chrome.storage.local.set({ currentAssessmentId: capturedMeta.id });
        console.log("[MayaAF] Stored currentAssessmentId:", capturedMeta.id);
      }
    }
  });

  let loadPromise = null;
  function loadQuestions() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (dataSource === "captured") return;
      const s = await chrome.storage.local.get(["questionsJson", "usePastedJson"]);
      if (s.usePastedJson && s.questionsJson) {
        let parsed = null;
        try {
          parsed = typeof s.questionsJson === "string" ? JSON.parse(s.questionsJson) : s.questionsJson;
        } catch (e) { parsed = null; }
        const pastedQs = parseQuestions(parsed);
        if (pastedQs.length) {
          setQuestions(pastedQs);
          dataSource = "pasted";
          setStatus("Using pasted JSON: " + apiQuestions.length + " questions");
        } else {
          setStatus("Waiting for the page's questions to load...");
        }
      } else {
        setStatus("Waiting for the page's questions to load...");
      }
      updateProgress();
    })().finally(() => {
      loadPromise = null;
    });
    return loadPromise;
  }

  /* ---------------- Firebase & AI answer fetching (via background) ---------------- */

  function bgMsg(type, payload, timeoutMs = 30000) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ ok: false, error: `background timeout after ${Math.round(timeoutMs / 1000)}s (${type}) — service worker may be asleep, retrying` });
        }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: String(err.message || err) });
            return;
          }
          if (!resp) {
            resolve({ ok: false, error: "no response from background (worker asleep?)" });
            return;
          }
          resolve(resp);
        });
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve({ ok: false, error: String(e) });
        }
      }
    });
  }

  const OPTION_LETTER_RE = /^(?:the\s+)?(?:correct\s+)?(?:option|choice|answer|ans)?\s*[([{]?\s*([a-d1-4])\s*[)\]}.,:\-]?\s*$/i;
  const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "to", "for", "and", "or", "it", "this", "that", "answer", "correct", "option", "choice", "best", "be", "as", "by", "at", "from", "we", "you"]);

  function normAnswerText(s) {
    return String(s || "")
      .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/^["'`]+/, "")
      .replace(/[.,;:!?"'`]+$/g, "")
      .trim();
  }

  function answerWords(s) {
    const out = new Set();
    for (const w of String(s || "").split(/[^a-z0-9]+/)) {
      if (w && !STOP_WORDS.has(w)) out.add(w);
    }
    return out;
  }

  /* Same matching rules as the background worker: exact text, then a
     long-enough substring, then a unique word overlap. A bare "b" only counts
     as option B when the WHOLE answer is that letter - never when the letter
     just happens to appear somewhere in a sentence. */
  function pickOption(answer, options) {
    const raw = String(answer == null ? "" : answer).trim();
    if (!raw) return { text: "", confidence: "none" };
    const target = normAnswerText(raw);
    const opts = [];
    for (let i = 1; i <= 4; i++) {
      const v = options ? options["option" + i] : undefined;
      if (v === undefined || v === null || String(v).trim() === "") continue;
      const n = normAnswerText(v);
      opts.push({ index: i, text: String(v), norm: n, words: answerWords(n) });
    }
    if (!opts.length) return { text: raw, confidence: "none" };

    const letter = /^\d+$/.test(target) && opts.filter((o) => /^\d+$/.test(o.norm)).length >= 2
      ? null
      : target.match(OPTION_LETTER_RE);
    if (letter) {
      const pos = { a: 1, b: 2, c: 3, d: 4, 1: 1, 2: 2, 3: 3, 4: 4 }[letter[1].toLowerCase()];
      const hit = opts.find((o) => o.index === pos);
      if (hit) return { text: hit.text, confidence: "letter", optionIndex: hit.index };
    }

    const exact = opts.find((o) => o.norm === target);
    if (exact) return { text: exact.text, confidence: "exact", optionIndex: exact.index };

    const contained = opts.filter((o) => {
      const short = o.norm.length <= target.length ? o.norm : target;
      const long = o.norm.length <= target.length ? target : o.norm;
      return short.length >= 5 && long.includes(short);
    });
    if (contained.length === 1) {
      return { text: contained[0].text, confidence: "contains", optionIndex: contained[0].index };
    }

    const scored = opts.map((o) => {
      if (!o.words.size) return { o, score: 0 };
      let hits = 0;
      for (const w of answerWords(target)) if (o.words.has(w)) hits++;
      return { o, score: hits / o.words.size };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= 0.6 && !(scored[1] && scored[1].score >= 0.6)) {
      return { text: best.o.text, confidence: "fuzzy", optionIndex: best.o.index };
    }

    return { text: raw, confidence: "none" };
  }

  // The canonical option text for an answer, or "" when it matches no option.
  function canonicalAnswer(q, answer) {
    const m = pickOption(answer, getOptions(q));
    return m.confidence === "none" ? "" : m.text;
  }

  function getOptions(q) {
    if (!q) return { option1: "", option2: "", option3: "", option4: "" };
    // Standard shape: option1..option4
    if (q.option1 || q.option2 || q.option3 || q.option4) {
      return { option1: q.option1 || "", option2: q.option2 || "", option3: q.option3 || "", option4: q.option4 || "" };
    }
    // Array shape: options: [...]
    if (Array.isArray(q.options) && q.options.length) {
      const arr = q.options.map((o) => (typeof o === "string" ? o : (o && (o.text || o.value || o.answer)) ? String(o.text || o.value || o.answer) : ""));
      return { option1: arr[0] || "", option2: arr[1] || "", option3: arr[2] || "", option4: arr[3] || "" };
    }
    // Lettered shape: optionA..D / option_a / A,B,C,D
    const pick = (...keys) => {
      for (const k of keys) if (q[k]) return q[k];
      return "";
    };
    const a = pick("optionA", "optiona", "A", "a", "opt1");
    const b = pick("optionB", "optionb", "B", "b", "opt2");
    const c = pick("optionC", "optionc", "C", "c", "opt3");
    const d = pick("optionD", "optiond", "D", "d", "opt4");
    if (a || b || c || d) return { option1: a, option2: b, option3: c, option4: d };
    return { option1: "", option2: "", option3: "", option4: "" };
  }

  async function loadFirebaseAndAI() {
       if (abortRequested) return;
       if (!ASSESS_ID) {
         console.log("[MayaAF] answer load skipped: no ASSESS_ID");
         return;
       }
       console.log("[MayaAF] answer load start, ASSESS_ID:", ASSESS_ID);

       // ONE test-ID lookup: if the test doc exists it holds ALL answers,
       // if not, this test has no saved answers yet.
       const cache = await getFirebaseCache();
       if (abortRequested) return;
        if (cache) {
          let hits = 0;
          for (const q of apiQuestions) {
            if (abortRequested) return;
            if (!q._id || !cache[q._id]) continue;
            // A cached answer that is flagged weak, or that matches none of
            // the options, is not trusted - it gets re-asked instead.
            const canonical = cachedAnswerUsable(q, cache[q._id]);
            if (!canonical) {
              console.log("[MayaAF] cached answer needs re-checking, ignoring:", q._id);
              continue;
            }
            q.answer = canonical;
            hits++;
          }
         if (abortRequested) return;
         if (hits > 0) {
           firebaseEnabled = true;
           dataSource = "firebase";
           byText = new Map(apiQuestions.map((q) => [normalize(q.question), q]));
            setStatus(`Loaded ${hits} saved answers`);
           flashPanel();
         }
       }
       console.log("[MayaAF] answer load done");
  }

  // In-memory mirror of the test answer set. Fetched ONCE per test ID —
  // every lookup after that is local.
  let firebaseCache = null; // { testId, answers, weak: { [qid]: true } }
  let pendingSaves = []; // AI answers waiting for one bulk write

  async function getFirebaseCache() {
    if (firebaseCache && firebaseCache.testId === ASSESS_ID) return firebaseCache.answers;
    if (!ASSESS_ID) return null;
    try {
      // The question text travels along so the background can also look the
      // question up in the shared index, not just under this test ID.
      const lookup = apiQuestions
        .filter((q) => q && q._id)
        .map((q) => ({ questionId: q._id, question: q.question || "" }));
      const resp = await bgMsg("FIREBASE_GET_ANSWERS", { testId: ASSESS_ID, questions: lookup }, 30000);
      const answers = (resp && resp.ok && resp.answers) ? resp.answers : {};
      const conf = (resp && resp.confidence) || {};
      const n = Object.keys(answers).length;
      const weakCount = Object.keys(conf).filter((k) => conf[k] === "weak").length;
      const sharedHits = (resp && resp.sharedHits) || 0;
      console.log(`[MayaAF] Store test ${ASSESS_ID}: ${n > 0 ? `FOUND (${n} answers, ${sharedHits} from other users, ${weakCount} to re-check)` : "NOT FOUND (no saved answers yet)"}`);
      if (sharedHits) console.log("[MayaAF] Reused answers written by other users:", sharedHits);
      const weak = {};
      for (const [qid, c] of Object.entries(conf)) if (c === "weak") weak[qid] = true;
      firebaseCache = { testId: ASSESS_ID, answers: { ...answers }, weak };
      return firebaseCache.answers;
    } catch (e) {
      console.warn("Answer store load failed:", e);
      return null;
    }
  }

  function cacheAnswer(question, answer, confidence) {
    const questionId = question && question._id;
    if (!questionId || !answer) return;
    if (firebaseCache && firebaseCache.testId === ASSESS_ID) {
      firebaseCache.answers[questionId] = answer;
      if (firebaseCache.weak) delete firebaseCache.weak[questionId];
    }
    if (!pendingSaves.some((s) => s.questionId === questionId)) {
      const o = getOptions(question);
      // The whole record travels: id, question, options, answer. That is what
      // the shared questions/{hash} index is built from.
      pendingSaves.push({
        questionId,
        questionText: question.question || "",
        options: { option1: o.option1 || "", option2: o.option2 || "", option3: o.option3 || "", option4: o.option4 || "" },
        answer,
        confidence: confidence || "exact"
      });
    }
  }

  // "weak" means a previous run never got a verbatim option match - re-ask
  // instead of trusting it forever.
  function cachedAnswerUsable(q, answer) {
    if (!answer) return "";
    if (firebaseCache && firebaseCache.weak && firebaseCache.weak[q._id]) return "";
    return canonicalAnswer(q, answer);
  }

  async function flushPendingSaves() {
    if (!pendingSaves.length || !ASSESS_ID) return;
    const batch = pendingSaves;
    pendingSaves = [];
    try {
      const resp = await bgMsg("FIREBASE_SAVE_ANSWERS", { testId: ASSESS_ID, answers: batch }, 30000);
      console.log("[MayaAF] Bulk save:", resp && resp.ok ? `ok (${batch.length})` : "failed: " + ((resp && resp.error) || "unknown"));
    } catch (e) {
      console.warn("Bulk save failed:", e);
      pendingSaves = batch.concat(pendingSaves); // retry next flush
    }
  }

  async function getAnswerFromAI(question, options) {
     if (abortRequested) return { answer: null, error: "aborted" };
     if (!useAI) return { answer: null, error: "AI disabled in settings" };
     try {
       if (abortRequested) return { answer: null, error: "aborted" };
        const resp = await bgMsg("OPENROUTER_ANSWER", { question, options, _useAI: useAI });
       if (abortRequested) return { answer: null, error: "aborted" };
       if (resp && resp.ok && resp.answer) {
         return { answer: resp.answer, error: null };
       }
       const err = (resp && resp.error) || "empty AI response";
       console.warn("OpenRouter AI error:", err);
       return { answer: null, error: String(err) };
     } catch (e) {
       if (abortRequested) return { answer: null, error: "aborted" };
       console.warn("OpenRouter AI error:", e);
       return { answer: null, error: String(e) };
     }
   }

  async function saveAnswerToFirebase(question, answer) {
       if (abortRequested) return;
       if (!ASSESS_ID || !useFirebase) return;
       // No direct write — just stage it; flushPendingSaves() does ONE
       // bulk write per test ID.
       cacheAnswer(question, answer);
     }

  async function resolveAnswer(q) {
       if (abortRequested) return null;
       if (q.answer) {
         console.log("[MayaAF] resolveAnswer already has answer:", q._id, q.answer);
         return q.answer;
       }
       
       const options = getOptions(q);
       console.log("[MayaAF] resolveAnswer start:", q._id, "store:", useFirebase, "ai:", useAI);

       // Test-ID cache lookup (local — no further reads after the first)
       if (useFirebase && ASSESS_ID && q._id) {
         if (abortRequested) return null;
         const cache = await getFirebaseCache();
         if (abortRequested) return null;
          if (cache && cache[q._id]) {
            const canonical = cachedAnswerUsable(q, cache[q._id]);
            if (canonical) {
              q.answer = canonical;
              dataSource = "firebase";
              console.log("[MayaAF] Cache hit:", q._id);
              return q.answer;
            }
            console.log("[MayaAF] cached answer needs re-checking, ignoring:", q._id);
          }
        }

        if (abortRequested) return null;
        const { answer: aiAnswer, error: aiError } = await getAnswerFromAI(q.question, options);
       if (abortRequested) return null;
       console.log("[MayaAF] getAnswerFromAI result:", aiAnswer || aiError);
       if (aiAnswer) {
         // Only a real option counts; a stray sentence is not an answer.
         const canonical = canonicalAnswer(q, aiAnswer);
         if (!canonical) {
           q._aiError = "AI answer matched none of the options";
           console.log("[MayaAF] AI answer not an option, skipping:", q._id, JSON.stringify(aiAnswer).slice(0, 120));
           return null;
         }
         q.answer = canonical;
         dataSource = "ai";
         if (useFirebase && ASSESS_ID && q._id) {
           await saveAnswerToFirebase(q, canonical);
         }
         return canonical;
       }
       
       if (abortRequested) return null;
       q._aiError = aiError || "AI returned no answer";
       console.log("[MayaAF] resolveAnswer no answer found:", q._id, q._aiError);
       return null;
     }

async function resolveAnswersBatch(questions, onProgress) {
     if (abortRequested) return;
     const uncached = questions.filter(q => !q.answer);
     console.log("[MayaAF] resolveAnswersBatch:", questions.length, "total,", uncached.length, "uncached");
     if (!uncached.length) return;
     
     const toFetch = [];
      // Test-ID cache lookup (local after first load — zero extra reads)
      if (useFirebase && ASSESS_ID) {
        const cache = await getFirebaseCache();
        if (abortRequested) return;
        if (cache) {
          let hits = 0;
          for (const q of uncached) {
            if (abortRequested) return;
            if (!q.answer && q._id && cache[q._id]) {
              const canonical = cachedAnswerUsable(q, cache[q._id]);
              if (canonical) {
                q.answer = canonical;
                dataSource = "firebase";
                hits++;
              } else {
                console.log("[MayaAF] cached answer needs re-checking, ignoring:", q._id);
              }
            }
          }
          if (hits) console.log("[MayaAF] Cache hits:", hits + "/" + uncached.length);
        }
       }
      for (const q of uncached) {
        if (abortRequested) return;
        if (q.answer) continue; // filled from cache above
        const options = getOptions(q);
        
        if (!useAI) {
          q._aiError = "AI disabled in settings";
          console.log("[MayaAF] Skipping AI for question:", q._id, "(AI disabled)");
          continue;
        }

        if (!options.option1 && !options.option2 && !options.option3 && !options.option4) {
          q._aiError = "no options found on question data";
          console.log("[MayaAF] Skipping AI for question (no options):", q._id);
          continue;
        }
        
        if (abortRequested) return;
        toFetch.push({ questionId: q._id, question: q.question, options });
      }
     
     if (abortRequested) return;
     console.log("[MayaAF] resolveAnswersBatch toFetch:", toFetch.length);
     if (!toFetch.length) {
       const errs = uncached.map((q) => q._aiError).filter(Boolean);
       if (onProgress && errs.length) onProgress("AI skipped: " + String(errs[0]).slice(0, 160));
       return;
     }
     
     if (onProgress) onProgress(`Fetching ${toFetch.length} answers from AI...`);
     
      // One call per chunk. Since the reply is just a letter per question, a
      // bigger chunk means far fewer calls for the same cost of accuracy.
      const CHUNK = 12;
      let totalSuccess = 0;
      let lastErr = "";
      try {
        for (let start = 0; start < toFetch.length; start += CHUNK) {
          if (abortRequested) return;
          const chunk = toFetch.slice(start, start + CHUNK);
          const chunkNo = Math.floor(start / CHUNK) + 1;
          const chunkTotal = Math.ceil(toFetch.length / CHUNK);
          if (onProgress) onProgress(`AI: batch ${chunkNo}/${chunkTotal} (${chunk.length} questions)...`);
          console.log(`[MayaAF] AI chunk ${chunkNo}/${chunkTotal}, size:`, chunk.length);
          if (abortRequested) return;
          // 8 questions x ~10s each / 3 concurrent ≈ 60s worst case; allow 150s.
          const resp = await bgMsg("OPENROUTER_BATCH_ANSWER", { questions: chunk, _useAI: useAI }, 150000);
          if (abortRequested) return;
          if (!resp) {
            lastErr = "no response from background";
            if (onProgress) onProgress("AI fetch failed: no response from background");
            chunk.forEach((t) => {
              const qq = uncached.find((uq) => uq._id === t.questionId);
              if (qq && !qq.answer) qq._aiError = lastErr;
            });
            continue;
          }
          if (!resp.ok) {
            lastErr = resp.error || "batch failed";
            console.warn(`[MayaAF] AI chunk ${chunkNo} error:`, lastErr);
            if (onProgress) onProgress("AI error: " + String(lastErr).slice(0, 160));
            chunk.forEach((t) => {
              const qq = uncached.find((uq) => uq._id === t.questionId);
              if (qq && !qq.answer) qq._aiError = String(lastErr).slice(0, 300);
            });
            continue;
          }
          const toSave = [];
          let success = 0;
          let weak = 0;
          for (const result of resp.results || []) {
            if (abortRequested) return;
            const q = uncached.find(uq => uq._id === result.questionId);
            if (q && result.ok && result.answer) {
              const canonical = canonicalAnswer(q, result.answer);
              if (!canonical) {
                q._aiError = "AI answer matched none of the options";
                console.log("[MayaAF] AI answer not an option, skipping:", q._id, JSON.stringify(result.answer).slice(0, 120));
                continue;
              }
              q.answer = canonical;
              dataSource = "ai";
              success++;
              totalSuccess++;
              if (result.confidence === "weak") weak++;
              if (useFirebase && ASSESS_ID && q._id) {
                // Weak answers still get cached, but flagged, so a later run
                // can tell a guess from a verified match.
                cacheAnswer(q, canonical, result.confidence);
                const o = getOptions(q);
                toSave.push({
                  questionId: q._id,
                  questionText: q.question,
                  options: { option1: o.option1 || "", option2: o.option2 || "", option3: o.option3 || "", option4: o.option4 || "" },
                  answer: canonical,
                  confidence: result.confidence
                });
              }
            } else if (result && !result.ok && result.error) {
              lastErr = result.error;
              if (q && !q.answer) q._aiError = String(result.error).slice(0, 300);
            }
          }
          if (abortRequested) return;
          console.log(`[MayaAF] AI chunk ${chunkNo}/${chunkTotal} done: ${success}/${chunk.length} (weak: ${weak})`);
          if (onProgress) onProgress(`AI answered ${totalSuccess}/${toFetch.length} questions...`);
          if (toSave.length && useFirebase && ASSESS_ID) {
            if (abortRequested) return;
            // ONE write for the whole chunk (tests/{testId} doc)
            await bgMsg("FIREBASE_SAVE_ANSWERS", { testId: ASSESS_ID, answers: toSave }, 30000);
            if (abortRequested) return;
            // Chunk saved directly — drop those from the pending queue
            pendingSaves = pendingSaves.filter((s) => !toSave.some((t) => t.questionId === s.questionId));
          }
        }
        if (totalSuccess > 0) {
          if (onProgress) onProgress(`AI answered ${totalSuccess}/${toFetch.length} questions`);
        } else if (lastErr) {
          if (onProgress) onProgress("AI error: " + String(lastErr).slice(0, 200));
        } else {
          if (onProgress) onProgress(`AI answered 0/${toFetch.length} questions`);
        }
        console.log("[MayaAF] resolveAnswersBatch done, total success:", totalSuccess + "/" + toFetch.length);
      } catch (e) {
        if (abortRequested) return;
        console.warn("Batch AI error:", e);
        if (onProgress) onProgress("AI fetch failed: " + String(e).slice(0, 160));
      }
   }

  /* ---------------- matching & filling ---------------- */

  function currentIndex() {
    const r = $('input[type=radio][name^="question"]');
    if (!r) return -1;
    const m = r.name.match(/question(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  function findQuestion(idx) {
    // 1) Try exact label match via byText map
    const qLabel = $('label[for="question' + idx + '"]') ||
      $$("label").find((l) => !l.classList.contains("form-check-label"));
    if (qLabel) {
      const q = byText.get(normalize(qLabel.innerText));
      if (q) return q;
      // Verify text before falling back to index: avoid matching the wrong
      // question when normalize differs (HTML entities, extra spaces).
      const labelText = qLabel.innerText || qLabel.textContent || "";
      const verified = apiQuestions.find((qq) => textsMatch(qq.question, labelText));
      if (verified) return verified;
    }
    if (isDeepDive && singleQ) return singleQ;
    // 2) Index fallback: support both 0-based (question0) and 1-based (question1) pages
    if (apiQuestions[idx]) return apiQuestions[idx];
    if (idx > 0 && apiQuestions[idx - 1]) return apiQuestions[idx - 1];
    return null;
  }

  function currentQuestionLabel() {
    return $('label[for="question1"]') ||
      $$("label").find((l) => !l.classList.contains("form-check-label"));
  }

  function textsMatch(a, b) {
    const norm = (s) => String(s || "").replace(/^Q?\s*\d*\s*[.:)\-]?\s*/i, "").trim().toLowerCase().replace(/\s+/g, " ");
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return true;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  function findQuestionTextEl(qText) {
    const want = normalize(qText);
    if (!want) return null;
    const cands = $$("label").concat(
      $$("p"), $$("h1"), $$("h2"), $$("h3"), $$("h4"), $$("h5"), $$("h6"),
      $$("div[class*='question' i]"), $$("span[class*='question' i]"),
      $$("div[class*='Question' i]"), $$("span[class*='Question' i]")
    );
    for (const el of cands) {
      const t = normalize(el.innerText || el.textContent || "");
      if (t && (t === want || t.includes(want) || want.includes(t))) return el;
    }
    const leafs = $$("div, span").filter((el) => el.childElementCount === 0);
    for (const el of leafs) {
      const t = normalize((el.textContent || "").trim());
      if (t && (t === want || t.includes(want))) return el;
    }
    return null;
  }

async function fillDeepDiveQuestion(q) {
     if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
     const qEl = findQuestionTextEl(q.question);
     if (!qEl) {
       if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
       return { filled: false, error: "question-mismatch", verified: false, idx: 1 };
     }
     const ans = normalize(q.answer);
     if (!ans) {
       if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
       return { filled: false, error: "no-answer", verified: false, idx: 1 };
     }
     let radios = $$('input[type=radio][name^="question"]');
     if (!radios.length) radios = $$("input[type=radio]");
     const tryMatch = (pred) => {
       for (const radio of radios) {
         const fc = radio.closest(".form-check");
         const lbl = fc ? $("label", fc) : null;
         const text = lbl ? normalize(lbl.innerText || lbl.textContent || "") : "";
         const val = normalize(radio.value);
         if (pred(text, val)) return radio;
       }
       return null;
     };
      let hit = tryMatch((text, val) => (text && text === ans) || (val && val === ans));
      if (!hit) hit = tryMatch((text, val) =>
        ((text && text.length >= 5 && (text.includes(ans) || ans.includes(text))) ||
         (val && val.length >= 5 && (val.includes(ans) || ans.includes(val)))));
      if (!hit) {
        const letter = ans.match(OPTION_LETTER_RE);
        if (letter) {
          const pos = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[letter[1].toLowerCase()];
          if (pos !== undefined && radios[pos]) hit = radios[pos];
        }
      }
     if (hit) {
         if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
         const ok = await trySelectRadio(hit, 1);
         if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
         if (ok) {
           matched++;
           deepDiveSolved++;
           updateProgress();
           setStatus("Filled - solved " + deepDiveSolved + " question" + (deepDiveSolved > 1 ? "s" : ""));
           flashPanel();
         }
         return { filled: ok, verified: ok, idx: 1, answer: q.answer };
     }
     if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
     const cands = $$("label, button, div, span, li, td").filter((el) => el.childElementCount === 0);
     const anyEl = cands.find((el) => {
       if (abortRequested) return false;
       const t = normalize((el.textContent || "").trim());
       return t && (t === ans || t.includes(ans) || ans.includes(t));
     });
     if (anyEl) {
       if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
       anyEl.click();
       const ok = await waitFor(() => {
         if (/selected|active|checked|chosen|highlight/i.test(String(anyEl.className || ""))) return true;
         const nb = $$("button").find((b) => /next question|submit/i.test((b.textContent || "").toLowerCase()));
         return nb ? !nb.disabled : false;
       }, 900, 50);
       if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
       const success = ok || radios.length === 0;
       if (success) {
         matched++;
         deepDiveSolved++;
         updateProgress();
         setStatus("Filled - solved " + deepDiveSolved + " question" + (deepDiveSolved > 1 ? "s" : ""));
         flashPanel();
       }
       return { filled: success, verified: ok, idx: 1, answer: q.answer };
     }
     if (abortRequested) return { filled: false, error: "aborted", verified: false, idx: 1 };
     return { filled: false, error: "no-option", verified: false, idx: 1, answer: q.answer };
   }

async function submitDeepDive() {
     if (abortRequested) return false;
     const findBtn = () => {
       const all = $$("button").concat($$("input[type=submit]"));
       const cands = all.filter((b) => {
         if (b.disabled) return false;
         const t = ((b.textContent || b.value || "") + " " + (b.title || ""))
           .trim().toLowerCase().replace(/[>➜→]+/g, "").replace(/\s+/g, " ");
         return t.includes("submit") || t.includes("next question") || t === "next" || t.includes("save & next");
       });
       return cands.find((b) => b.offsetParent !== null) || cands[0] || null;
     };
     if (!findBtn()) {
       if (abortRequested) return false;
       const appeared = await waitFor(() => !!findBtn(), 2500, 100);
       if (abortRequested) return false;
       if (!appeared) return false;
     }
     let clickedOnce = false;
     for (let attempt = 0; attempt < 3; attempt++) {
       if (abortRequested) return false;
       const btn = findBtn();
       if (!btn) break;
       const before = pageProgress();
       btn.click();
       clickedOnce = true;
       if (abortRequested) return false;
       const advanced = await waitFor(() => {
         if (abortRequested) return false;
         if (!singleQ) return true;
         if (!findQuestionTextEl(singleQ.question)) return true;
         if ($$("input[type=radio]:checked").length === 0) return true;
         const after = pageProgress();
         return !!(before && after && after.done > before.done);
       }, 2500, 150);
       if (abortRequested) return false;
       if (advanced) return true;
     }
       if (abortRequested) return false;
       return clickedOnce;
     }

   let pageProgCache = null;
  let pageProgAt = 0;
  function pageProgress() {
    if (Date.now() - pageProgAt < 2000) return pageProgCache;
    pageProgAt = Date.now();
    try {
      const t = document.body ? document.body.innerText : "";
      const m = t.match(/(\d+)\s*\/\s*(\d+)[\s\S]{0,40}?total\s*attempted/i);
      pageProgCache = m ? { done: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
    } catch (e) {
      pageProgCache = null;
    }
    return pageProgCache;
  }

  let fallbackBusy = false;
  function getReloadSameCount() {
    try {
      return parseInt(sessionStorage.getItem("maya-af-reload-same") || "0", 10) || 0;
    } catch (e) { return 0; }
  }
  function trackReload(qText) {
    try {
      const lastQ = sessionStorage.getItem("maya-af-last-reload-q") || "";
      const same = lastQ === qText ? (getReloadSameCount() + 1) : 1;
      sessionStorage.setItem("maya-af-last-reload-q", qText);
      sessionStorage.setItem("maya-af-reload-same", String(same));
      return same;
    } catch (e) { return 1; }
  }
  function resetReloadTracking() {
    try {
      sessionStorage.removeItem("maya-af-last-reload-q");
      sessionStorage.removeItem("maya-af-reload-same");
    } catch (e) {}
  }
async function deepDiveSelfFetch() {
     if (abortRequested) return null;
     if (fallbackBusy) return null;
     fallbackBusy = true;
     try {
       if (abortRequested) return null;
       const params = new URLSearchParams(location.search);
       const tech = params.get("technology");
       const topic = params.get("topic");
       let roll = params.get("roll_no") || null;
       if (!roll && capturedMeta && capturedMeta.roll_no) roll = capturedMeta.roll_no;
       if (!tech || !topic) {
         if (abortRequested) return null;
         return null;
       }
       if (abortRequested) return null;
       const resp = await fetch("https://api.maya.adityauniversity.in/node/api/get-random-deep-dive-question", {
         method: "POST",
         credentials: "omit",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ technology: tech, roll_no: roll, topic: topic })
       });
       if (abortRequested) return null;
       if (!resp.ok) return null;
       if (abortRequested) return null;
       const q = await resp.json();
       if (abortRequested) return null;
       if (!q || !q.question || !q.answer) return null;
       if (singleQ || !findQuestionTextEl(q.question)) {
         if (abortRequested) return null;
         return null;
       }
       if (abortRequested) return null;
       return q;
     } catch (e) {
       if (abortRequested) return null;
       return null;
     } finally {
       setTimeout(() => { fallbackBusy = false; }, 2000);
     }
   }

  function findRadioForAnswer(idx, ans) {
    const radios = $$('input[type=radio][name="question' + idx + '"]');
    const target = normalize(ans);
    if (!target) return null;
    // Exact match first
    for (const radio of radios) {
      const fc = radio.closest(".form-check");
      const lbl = fc ? $("label", fc) : null;
      const text = lbl ? normalize(lbl.innerText) : "";
      const val = normalize(radio.value);
      if ((text && text === target) || (val && val === target)) return radio;
    }
    // Contains match (AI often adds/removes punctuation) - long strings only,
    // so "4" cannot latch onto "42" and a shared word cannot win by accident.
    for (const radio of radios) {
      const fc = radio.closest(".form-check");
      const lbl = fc ? $("label", fc) : null;
      const text = lbl ? normalize(lbl.innerText || lbl.textContent || "") : "";
      const val = normalize(radio.value);
      if ((text && text.length >= 5 && (text.includes(target) || target.includes(text))) ||
          (val && val.length >= 5 && (val.includes(target) || target.includes(val)))) return radio;
    }
    // Letter / number answer - only when the whole answer IS the letter.
    const letter = target.match(OPTION_LETTER_RE);
    if (letter) {
      const pos = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[letter[1].toLowerCase()];
      if (pos !== undefined && radios[pos]) return radios[pos];
    }
    return null;
  }

  function getChecked(idx) {
    if (isDeepDive) return $$("input[type=radio]:checked")[0] || null;
    return $('input[type=radio][name="question' + idx + '"]:checked') || null;
  }

async function trySelectRadio(radio, idx) {
     if (abortRequested) return false;
     if (radio.checked) return true;
     radio.click();
     radio.dispatchEvent(new Event("change", { bubbles: true }));
     if (abortRequested) return false;
     if (await waitFor(() => !!getChecked(idx), 700, 40)) return true;
     if (abortRequested) return false;
     radio.click();
     radio.dispatchEvent(new Event("change", { bubbles: true }));
     if (abortRequested) return false;
     return await waitFor(() => !!getChecked(idx), 1200, 60);
   }

  async function fillCurrentQuestion(force) {
    if (isDeepDive) {
      if (!singleQ) return { filled: false, error: "no-data", verified: false, idx: 1 };
      const resolved = await resolveAnswer(singleQ);
      if (!resolved) return { filled: false, error: "no-answer: " + (singleQ._aiError || "AI failed"), verified: false, idx: 1 };
      singleQ.answer = resolved;
      return fillDeepDiveQuestion(singleQ);
    }
    const radios = $$('input[type=radio][name^="question"]');
    if (!radios.length) return { filled: false, error: "no-radios", verified: false };
    const idx = currentIndex();
    if (idx < 0) return { filled: false, error: "no-index", verified: false };
    if (getChecked(idx) && !force) return { filled: false, already: true, verified: true, idx };
    if (!apiQuestions.length) return { filled: false, error: "no-data", verified: false, idx };
    const q = findQuestion(idx);
    if (!q) return { filled: false, error: "no-match", verified: false, idx };
    console.log("[MayaAF] fillCurrentQuestion idx:", idx, "q._id:", q._id, "q.question:", q.question?.substring(0, 50));
    const resolved = await resolveAnswer(q);
    if (!resolved) return { filled: false, error: "no-answer: " + (q._aiError || "AI failed"), verified: false, idx };
    q.answer = resolved;
    const ans = normalize(resolved);
    const radio = findRadioForAnswer(idx, ans);
    if (!radio) return { filled: false, error: "no-option", verified: false, idx, answer: resolved };
    const verified = await trySelectRadio(radio, idx);
    if (verified) {
      matched++;
      updateProgress();
    }
    console.log("[MayaAF] fillCurrentQuestion result:", { filled: verified, idx, answer: resolved });
    return { filled: verified, verified: verified, idx, answer: resolved };
  }

  /* ---------------- navigator grid helpers ---------------- */

  function getGrid() {
    return $$("div").find((d) => /repeat\(\s*5\s*,\s*1fr\s*\)/.test(d.style.gridTemplateColumns || ""));
  }

  function isSquareAnswered(square) {
    const t = (square.textContent || "").trim();
    return t.length > 0 && !/^\d+$/.test(t);
  }

  function getGridStats() {
    const grid = getGrid();
    if (!grid) return null;
    const squares = Array.from(grid.children);
    const total = squares.length;
    const answered = squares.filter(isSquareAnswered).length;
    return { total, answered };
  }

  /* ---------------- sweep: fill every unanswered question ---------------- */

  async function sweepQuestions(forceAll) {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (abortRequested) return;
      if (apiQuestions.length && getGrid()) break;
      if (!apiQuestions.length) setStatus("Waiting for the page's questions to load...");
      await sleep(300);
    }
    if (!apiQuestions.length) {
      setStatus("No question data from the page yet. Reload the test page if it stays empty.");
      return;
    }
    if (!getGrid()) {
      setStatus("Question navigator not found. Make sure the test page loaded.");
      return;
    }

    const unanswered = apiQuestions.filter(q => !q.answer);
    console.log("[MayaAF] sweepQuestions start, total:", apiQuestions.length, "unanswered:", unanswered.length);
    if (unanswered.length) {
      await resolveAnswersBatch(unanswered, (msg) => setStatus(msg));
    }
    console.log("[MayaAF] sweepQuestions after batch, answered:", apiQuestions.filter(q => q.answer).length);

    const passes = forceAll ? 1 : 5;
    let failures = [];
    for (let pass = 0; pass < passes; pass++) {
      if (abortRequested) break;
      let t = 0;
      let pending = 0;
      while (true) {
        if (abortRequested) break;
        const grid = getGrid();
        if (!grid) break;
        const squares = Array.from(grid.children);
        if (t >= squares.length) break;
        const sq = squares[t];
        if (!forceAll && isSquareAnswered(sq)) { t++; continue; }
        pending++;
        // Support both 0-based and 1-based question naming on the page
        const targetIdx = currentIndex() !== t
          ? (async () => {
              sq.click();
              const ok = await waitFor(
                () => {
                  const ci = currentIndex();
                  return (ci === t || ci === t + 1) && (
                    $('input[type=radio][name="question' + ci + '"]') ||
                    $('input[type=radio][name^="question"]')
                  );
                },
                2500, 60
              );
              return ok;
            })()
          : true;
        if (targetIdx !== true) {
          const ok = await targetIdx;
          if (!ok) { failures.push({ q: t + 1, error: "navigation failed" }); t++; continue; }
          await sleep(150);
        }
        const r = await fillCurrentQuestion(true);
        if (r.filled) {
          setStatus("Filled question " + (t + 1) + " / " + apiQuestions.length);
          flashPanel();
          await waitFor(() => {
            const g2 = getGrid();
            return g2 && g2.children[t] && isSquareAnswered(g2.children[t]);
          }, 2500, 60);
        } else {
          failures.push({ q: t + 1, error: r.error || "unknown" });
          const errText = String(r.error || "unknown");
          setStatus("Question " + (t + 1) + ": " + errText.slice(0, 200) +
            (r.error === "no-option" && r.answer ? " (answer: '" + r.answer + "')" : ""));
        }
        t++;
      }
      if (abortRequested) break;
      if (pending === 0) break;
      const stats = getGridStats();
      // Don't give up just because nothing is marked answered yet — AI errors
      // (bad key/model, 429) need retries across passes, not an early break.
      if (!stats) break;
      if (stats.answered === stats.total) break;
      if (abortRequested) break;
      await sleep(300);
    }
    if (failures.length) {
      console.warn("[MayaAF] sweep failures:", failures);
    }
    // ONE bulk write for any AI answers staged during per-question fills
    await flushPendingSaves();
  }

  async function autoFillAll() {
    if (running) return;
    running = true;
    abortRequested = false;
    const stopBtn = $("#maya-af-stop");
    if (stopBtn) stopBtn.style.display = "block";
    console.log("[MayaAF] autoFillAll start, ASSESS_ID:", ASSESS_ID, "apiQuestions:", apiQuestions.length, "isDeepDive:", isDeepDive);
    try {
      if (ASSESS_ID && apiQuestions.length) {
        setStatus("Loading answers...");
        console.log("[MayaAF] autoFillAll loading answers");
        await loadFirebaseAndAI();
        console.log("[MayaAF] autoFillAll after loading answers, answered:", apiQuestions.filter(q => q.answer).length);
      }
      if (isDeepDive) {
         const t0 = Date.now();
         setStatus("Waiting for the page's question data...");
         while (!singleQ && Date.now() - t0 < 60000) {
           if (abortRequested) return;
           await sleep(400);
         }
         if (abortRequested) return;
         if (!singleQ) {
           setStatus("No question data from the page yet. Reload the test page if it stays empty.");
           return;
         }
         if (abortRequested) return;
         if (!findQuestionTextEl(singleQ.question)) {
           setStatus("Waiting for the next question...");
           return;
         }
         if (abortRequested) return;
         if (!singleQ.answer && !abortRequested) {
           setStatus("Asking AI for the answer...");
           const resolved = await resolveAnswer(singleQ);
           if (resolved) singleQ.answer = resolved;
           else {
             setStatus("Question: no-answer: " + (singleQ._aiError || "AI failed").slice(0, 200));
             if (abortRequested) return;
             return;
           }
         }
         if (abortRequested) return;
         const r = await fillDeepDiveQuestion(singleQ);
         if (abortRequested) return;
         if (r && r.filled && autoAdvance) {
           const qText = normalize(singleQ.question);
           if (qText === lastSubmittedQ) {
             setStatus("Question already submitted - waiting for the next one...");
             return;
           }
           resetReloadTracking();
           failedQ = null;
           failedCount = 0;
           lastSubmittedQ = qText;
           const submitted = await submitDeepDive();
           if (abortRequested) return;
           if (!submitted) setStatus("Filled but the submit button was not found. Please submit manually.");
         } else if (r && !r.filled) {
           const qText = normalize(singleQ.question);
           if (failedQ === qText) failedCount++;
           else { failedQ = qText; failedCount = 1; }
           if (r.error === "no-option" || r.error === "question-mismatch") {
             const same = trackReload(qText);
             if (same <= 2) {
               setStatus("Option not found - reloading for a new question...");
               await sleep(1800);
               location.reload();
               return;
             }
             setStatus("Question: " + (r.error || "unknown") +
               (r.error === "no-option" && r.answer ? " (answer: '" + r.answer + "')" : "") +
               " - the same question keeps reloading, so further reloads are paused. You can click Retry to force one more.");
           } else {
             setStatus("Question: " + (r.error || "unknown"));
           }
         } else if (r && r.filled && !autoAdvance) {
           resetReloadTracking();
           failedQ = null;
           failedCount = 0;
         }
         if (abortRequested) return;
         return;
       }
      await sweepQuestions(false);
      if (pendingForceSweep && !abortRequested) {
        pendingForceSweep = false;
        setStatus("Exact answers captured - correcting any auto-filled answers...");
        await sweepQuestions(true);
      }
      if (!abortRequested) {
        const stats = getGridStats();
        if (stats && stats.answered < stats.total) {
          setStatus("Verifying unanswered questions...");
          await sweepQuestions(true);
        }
      }
      if (!abortRequested) {
        const stats = getGridStats();
        setStatus(stats && stats.answered === stats.total
          ? "Done - all questions filled."
          : "Run finished - some questions could not be filled automatically.");
      }
    } finally {
      await flushPendingSaves();
      running = false;
      if (stopBtn) stopBtn.style.display = "none";
      updateProgress();
    }
  }

  /* ---------------- progress UI ---------------- */

  function updateProgress() {
    const stats = getGridStats();
    const el = $("#maya-af-progress");
    const bar = $("#maya-af-barfill");
    const ring = $("#maya-af-ringval");
    const ringPct = $("#maya-af-ringpct");
    const mini = $("#maya-af-mini");
    const RING_C = 106.8;
    let pct = 0;
    if (!el) return;
    if (isDeepDive) {
      const pp = pageProgress();
      if (pp && pp.total) {
        pct = Math.round((pp.done / pp.total) * 100);
        el.textContent = "Attempted: " + pp.done + " / " + pp.total +
          (deepDiveSolved ? " (auto: " + deepDiveSolved + ")" : "");
      } else {
        el.textContent = deepDiveSolved ? "Solved: " + deepDiveSolved : (singleQ ? "1 question ready" : "");
      }
      if (bar) bar.style.width = pct + "%";
      if (ring) ring.style.strokeDashoffset = RING_C * (1 - pct / 100);
      if (ringPct) ringPct.textContent = pct ? pct + "%" : "";
      paintMini(pct);
      return;
    }
    if (stats) {
      pct = stats.total ? Math.round((stats.answered / stats.total) * 100) : 0;
      el.textContent = "Answered: " + stats.answered + " / " + stats.total + " (" + pct + "%)";
    } else if (apiQuestions.length) {
      el.textContent = "Answered: 0 / " + apiQuestions.length;
    } else {
      el.textContent = "";
    }
    if (bar) bar.style.width = pct + "%";
    if (ring) ring.style.strokeDashoffset = RING_C * (1 - pct / 100);
    if (ringPct) ringPct.textContent = pct ? pct + "%" : "";
    paintMini(pct);
  }

  function paintMini(pct) {
    const mini = $("#maya-af-mini");
    if (!mini) return;
    mini.textContent = "";
    mini.style.background = pct >= 100
      ? "rgba(34,197,94,.55)"
      : pct > 0
        ? "rgba(34,197,94,.35)"
        : "rgba(245,158,11,.4)";
  }

  let flashTimer = null;
  function flashPanel() {
    const p = $("#maya-af-panel");
    if (!p) return;
    p.classList.add("maya-af-flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => p.classList.remove("maya-af-flash"), 550);
  }

  function setStatus(msg) {
    const el = $("#maya-af-status");
    if (el) el.textContent = msg;
    const dot = $("#maya-af-dot");
    if (!dot) return;
    const m = String(msg).toLowerCase();
    if (m.includes("error") || m.includes("not found") || m.includes("fail") || m.includes("miss") || m.includes("stays empty")) {
      dot.className = "maya-af-dot err";
    } else if (m.includes("wait") || m.includes("loading") || m.includes("captured") || m.includes("waiting")) {
      dot.className = "maya-af-dot wait";
    } else {
      dot.className = "maya-af-dot ok";
    }
  }

  /* ---------------- panel ---------------- */

  function buildPanel() {
    if ($("#maya-af-panel")) return;
    const style = document.createElement("style");
    style.textContent = `
      #maya-af-panel{position:fixed;right:16px;bottom:16px;z-index:999999;width:290px;font-family:Segoe UI,Arial,sans-serif;
        background:linear-gradient(180deg,#202b3d,#161e2c);color:#e5e7eb;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.5),0 0 0 1px rgba(0,135,48,.25);
        font-size:13px;overflow:hidden;border:1px solid #2b3a4f;animation:mayaAfFadeUp .3s ease;transition:box-shadow .35s ease}
      #maya-af-panel.maya-af-flash{box-shadow:0 0 30px rgba(34,197,94,.7),0 0 0 1px rgba(34,197,94,.55)}
      #maya-af-panel.maya-af-min .maya-af-body{display:none}
      @keyframes mayaAfFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      #maya-af-panel .maya-af-header{display:flex;justify-content:space-between;align-items:center;color:#fff;padding:9px 12px;
        font-weight:600;font-size:13px;cursor:grab;user-select:none;background:linear-gradient(120deg,#005e21,#00a03a,#007a2d)}
      #maya-af-panel .maya-af-header:active{cursor:grabbing}
      #maya-af-panel .maya-af-logo{width:18px;height:18px;border-radius:5px;margin-right:7px;vertical-align:-4px;box-shadow:0 0 6px rgba(255,255,255,.35)}
      #maya-af-panel .maya-af-title{flex:1;display:flex;align-items:center}
      #maya-af-panel .maya-af-controls{display:flex;gap:10px}
      #maya-af-panel .maya-af-btn{cursor:pointer;font-size:14px;line-height:1;opacity:.9;padding:2px;transition:transform .15s}
      #maya-af-panel .maya-af-btn:hover{opacity:1;transform:scale(1.25)}
      #maya-af-panel .maya-af-body{padding:10px 12px;position:relative}
      #maya-af-panel .maya-af-top{display:flex;gap:10px;align-items:center;margin-bottom:8px}
      #maya-af-panel .maya-af-ring{position:relative;width:44px;height:44px;flex:none}
      #maya-af-panel .maya-af-ring svg{transform:rotate(-90deg)}
      #maya-af-panel .maya-af-ring .maya-af-ringbg{fill:none;stroke:#111827;stroke-width:5}
      #maya-af-panel .maya-af-ring #maya-af-ringval{fill:none;stroke:#22c55e;stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset .3s ease}
      #maya-af-panel #maya-af-ringpct{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#e5e7eb}
      #maya-af-panel .maya-af-mid{flex:1;min-width:0}
      #maya-af-panel .maya-af-statusrow{display:flex;align-items:flex-start;gap:7px;margin-bottom:6px}
      #maya-af-panel .maya-af-dot{width:8px;height:8px;border-radius:50%;flex:none;margin-top:5px;background:#f59e0b}
      #maya-af-panel .maya-af-dot.ok{background:#22c55e;box-shadow:0 0 6px #22c55e}
      #maya-af-panel .maya-af-dot.err{background:#ef4444;box-shadow:0 0 6px #ef4444}
      #maya-af-panel .maya-af-dot.wait{background:#f59e0b;animation:mayaAfPulse 1.2s infinite}
      @keyframes mayaAfPulse{0%,100%{opacity:1}50%{opacity:.35}}
      #maya-af-panel #maya-af-status{color:#9ca3af;word-break:break-word;line-height:1.4}
      #maya-af-panel .maya-af-bar{height:5px;background:#111827;border-radius:3px;overflow:hidden;margin-bottom:4px}
      #maya-af-panel #maya-af-barfill{height:100%;width:0;background:linear-gradient(90deg,#008730,#22c55e);border-radius:3px;transition:width .4s ease}
      #maya-af-panel #maya-af-progress{font-weight:600;color:#d1d5db;font-size:12px}
      #maya-af-panel .maya-af-row{display:flex;gap:6px;margin:10px 0}
      #maya-af-panel button{flex:1;border:none;border-radius:9px;padding:8px 2px;font-size:11px;font-weight:600;cursor:pointer;color:#fff;transition:transform .12s,filter .15s,box-shadow .15s}
      #maya-af-panel button:hover{filter:brightness(1.2);transform:translateY(-1px)}
      #maya-af-panel button:active{transform:translateY(0)}
      #maya-af-panel #maya-af-fillall{background:linear-gradient(135deg,#008730,#00a03a);box-shadow:0 2px 8px rgba(0,135,48,.4)}
      #maya-af-panel #maya-af-fillcur{background:#374151}
      #maya-af-panel #maya-af-retry{background:linear-gradient(135deg,#4f46e5,#6366f1)}
      #maya-af-panel #maya-af-stop{background:linear-gradient(135deg,#b91c1c,#ef4444);display:none}
      #maya-af-panel label.maya-af-toggle{display:flex;align-items:center;gap:8px;margin:6px 0;cursor:pointer;font-size:12px;color:#d1d5db}
      #maya-af-panel label.maya-af-toggle input{display:none}
      #maya-af-panel .maya-af-switch{width:30px;height:16px;background:#374151;border-radius:10px;position:relative;flex:none;transition:background .2s}
      #maya-af-panel .maya-af-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#9ca3af;transition:all .2s}
      #maya-af-panel label.maya-af-toggle input:checked + .maya-af-switch{background:#008730}
      #maya-af-panel label.maya-af-toggle input:checked + .maya-af-switch::after{left:16px;background:#fff}
      #maya-af-panel .maya-af-note{font-size:11px;color:#6b7280;margin-top:8px;border-top:1px solid #2b3a4f;padding-top:7px}
      #maya-af-mini{position:fixed;right:3px;top:50%;margin-top:-7px;z-index:999999;width:14px;height:14px;border-radius:50%;
        background:rgba(34,197,94,.35);display:none;cursor:pointer;transition:background .2s,box-shadow .2s;
        font-family:Segoe UI,Arial,sans-serif}
      #maya-af-mini:hover{background:rgba(34,197,94,.8);box-shadow:0 0 6px rgba(34,197,94,.5)}
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "maya-af-panel";
    panel.innerHTML = `
      <div class="maya-af-header">
        <span class="maya-af-title"><img class="maya-af-logo" src="` + chrome.runtime.getURL("icons/icon128.png") + `" alt="">Maya AutoPilot</span>
        <span class="maya-af-controls">
          <span class="maya-af-btn maya-af-min" title="Minimize">&#8211;</span>
          <span class="maya-af-btn maya-af-close" title="Hide">&#10005;</span>
        </span>
      </div>
      <div class="maya-af-body">
        <div class="maya-af-top">
          <div class="maya-af-ring">
            <svg width="44" height="44">
              <circle class="maya-af-ringbg" cx="22" cy="22" r="17"></circle>
              <circle id="maya-af-ringval" cx="22" cy="22" r="17"></circle>
            </svg>
            <span id="maya-af-ringpct">0%</span>
          </div>
          <div class="maya-af-mid">
            <div class="maya-af-statusrow">
              <span id="maya-af-dot" class="maya-af-dot wait"></span>
              <div id="maya-af-status">Loading...</div>
            </div>
            <div class="maya-af-bar"><div id="maya-af-barfill"></div></div>
            <div id="maya-af-progress"></div>
          </div>
        </div>
        <div class="maya-af-row">
          <button id="maya-af-fillall">&#9654; Autofill all</button>
          <button id="maya-af-fillcur">Fill current</button>
          <button id="maya-af-retry">&#8635; Retry</button>
          <button id="maya-af-stop">&#9632; Stop</button>
        </div>
        <label class="maya-af-toggle"><input type="checkbox" id="maya-af-autorun"><span class="maya-af-switch"></span> Auto-run when a question appears</label>
        <label class="maya-af-toggle"><input type="checkbox" id="maya-af-advance"><span class="maya-af-switch"></span> Auto-advance to next question</label>
        <div class="maya-af-note">` + (isDeepDive
          ? "Deep-dive mode: each question is captured from the page and answered+submitted automatically."
          : "Answers come from the page's own network request. Click Autofill all if a question is left unanswered.") + `</div>
      </div>`;
    document.body.appendChild(panel);

    const mini = document.createElement("div");
    mini.id = "maya-af-mini";
    document.body.appendChild(mini);
    panel.style.display = "none";
    mini.style.display = "flex";
    mini.addEventListener("click", () => {
      panel.style.display = "block";
      panel.classList.remove("maya-af-min");
      mini.style.display = "none";
    });

    chrome.storage.local.get("panelPos", (s) => {
      if (s.panelPos && typeof s.panelPos.x === "number") {
        panel.style.left = s.panelPos.x + "px";
        panel.style.top = s.panelPos.y + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      }
    });

    const header = $(".maya-af-header", panel);
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest(".maya-af-btn")) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const move = (ev) => {
        const x = Math.min(Math.max(0, rect.left + ev.clientX - startX), window.innerWidth - 60);
        const y = Math.min(Math.max(0, rect.top + ev.clientY - startY), window.innerHeight - 40);
        panel.style.left = x + "px";
        panel.style.top = y + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        const r = panel.getBoundingClientRect();
        chrome.storage.local.set({ panelPos: { x: r.left, y: r.top } });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    $(".maya-af-min", panel).addEventListener("click", () => {
      panel.style.display = "none";
      panel.classList.remove("maya-af-min");
      mini.style.display = "flex";
    });
    $(".maya-af-close", panel).addEventListener("click", () => {
      panel.style.display = "none";
      panel.classList.remove("maya-af-min");
      mini.style.display = "flex";
    });
    $("#maya-af-fillall", panel).addEventListener("click", () => autoFillAll());
    $("#maya-af-fillcur", panel).addEventListener("click", () => fillCurrentQuestion(false).then(updateProgress));
    $("#maya-af-retry", panel).addEventListener("click", async () => {
      const raw = document.documentElement.getAttribute("data-maya-af-questions");
      if (raw) {
        try { useCapturedData(JSON.parse(raw)); } catch (e) { /* ignore */ }
      }
      resetReloadTracking();
      if (dataSource !== "captured") {
        if (isDeepDive) {
          setStatus("Deep-dive: waiting for the page's question data...");
          autoFillAll();
        } else {
          loadQuestions()
            .then(() => { if (!running) autoFillAll(); })
            .catch((e) => setStatus("Data error: " + e.message));
        }
      } else if (!running) {
        autoFillAll();
      }
    });
    $("#maya-af-stop", panel).addEventListener("click", () => {
      abortRequested = true;
    });
    $("#maya-af-autorun", panel).addEventListener("change", (e) => {
      autoRun = e.target.checked;
      chrome.storage.local.set({ autoRun: autoRun });
    });
    $("#maya-af-advance", panel).addEventListener("change", (e) => {
      autoAdvance = e.target.checked;
      chrome.storage.local.set({ autoAdvance: autoAdvance });
    });
    const arEl = $("#maya-af-autorun", panel);
    const adEl = $("#maya-af-advance", panel);
    if (arEl) arEl.checked = autoRun;
    if (adEl) adEl.checked = autoAdvance;
  }

  /* ---------------- settings sync ---------------- */

  function applySettings(settings) {
    if (typeof settings.autoRun === "boolean") autoRun = settings.autoRun;
    if (typeof settings.autoAdvance === "boolean") autoAdvance = settings.autoAdvance;
    // Self-heal: Firebase + AI must stay on. Old installs may have stored false,
    // which caused "AI disabled in settings" skips. Force back to true.
    useFirebase = true;
    useAI = true;
    if (settings.useFirebase === false || settings.useAI === false) {
      try { chrome.storage.local.set({ useFirebase: true, useAI: true }); } catch (e) {}
    }
    console.log("[MayaAF] applySettings:", { autoRun, autoAdvance, useFirebase, useAI });
    const ar = $("#maya-af-autorun");
    const ad = $("#maya-af-advance");
    if (ar) ar.checked = autoRun;
    if (ad) ad.checked = autoAdvance;
    if ("questionsJson" in settings || "usePastedJson" in settings) {
      loadQuestions().catch((e) => setStatus("Data error: " + e.message));
    }
  }

  chrome.storage.local.get(
    { autoRun: true, autoAdvance: true, useFirebase: true, useAI: true, questionsJson: "", usePastedJson: false },
    (s) => applySettings(s)
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const s = {};
    for (const k in changes) s[k] = changes[k].newValue;
    applySettings(s);
  });

  /* ---------------- SPA navigation support ---------------- */

  let pollTimer = null;
  let watchdogTimer = null;
  let lastRaw = null;

  function injectHook() {
    if (document.documentElement.hasAttribute("data-maya-af-hook-installed")) {
      console.log("[MayaAF] Hook already installed");
      return;
    }
    console.log("[MayaAF] Injecting hook...");
    const el = document.createElement("script");
    el.src = chrome.runtime.getURL("hook-injected.js");
    (document.documentElement || document.head || document.body).appendChild(el);
  }

function startPoller() {
     clearInterval(pollTimer);
     pollTimer = setInterval(() => {
       if (abortRequested) return;
       const raw = document.documentElement.getAttribute("data-maya-af-questions");
       if (raw) {
         clearInterval(pollTimer);
         console.log("[MayaAF] Poller found questions");
         try { useCapturedData(JSON.parse(raw)); } catch (e) { /* ignore */ }
         return;
       }
       if (abortRequested) return;
       const rawMeta = document.documentElement.getAttribute("data-maya-af-meta");
        if (rawMeta) {
          try {
            capturedMeta = JSON.parse(rawMeta) || capturedMeta;
            if (capturedMeta && capturedMeta.id && !ASSESS_ID) {
              ASSESS_ID = capturedMeta.id;
              console.log("[MayaAF] Updated ASSESS_ID from poller meta:", ASSESS_ID);
            }
          } catch (e) { /* ignore */ }
        }
     }, 400);
   }

function startWatchdog() {
     clearInterval(watchdogTimer);
     lastRaw = null;
     watchdogTimer = setInterval(() => {
       if (abortRequested) return;
       const raw = document.documentElement.getAttribute("data-maya-af-questions");
       if (raw && raw !== lastRaw) {
         lastRaw = raw;
         try { useCapturedData(JSON.parse(raw)); } catch (e) { /* ignore */ }
       }
       if (autoRun && !running && isDeepDive) {
         const currentQ = singleQ && findQuestionTextEl(singleQ.question) ? singleQ : null;
         if (currentQ) {
           const radios = $$("input[type=radio]");
           const gaveUp = failedQ === normalize(currentQ.question) && failedCount >= 5;
           if (!gaveUp && (!radios.length || !radios.some((r) => r.checked))) autoFillAll();
         } else if (!singleQ) {
           deepDiveSelfFetch().then((q) => {
             if (q && !singleQ && findQuestionTextEl(q.question)) captureSingleQuestion(q);
           }).catch(() => {});
         }
       }
       updateProgress();
     }, 2500);
   }

  function resetForNavigation() {
    document.documentElement.removeAttribute("data-maya-af-questions");
    document.documentElement.removeAttribute("data-maya-af-meta");
    singleQ = null;
    deepDiveSolved = 0;
    resetReloadTracking();
    lastSubmittedQ = null;
    failedQ = null;
    failedCount = 0;
    lastAnsweredCount = -1;
    matched = 0;
    pendingForceSweep = false;
    dataSource = "none";
    apiQuestions = [];
    byText = new Map();
    capturedMeta = null;
    firebaseCache = null;
    pendingSaves = [];
    storedQuestionIds.clear();
  }

  function handleNavigation() {
    injectHook();
    resetForNavigation();
    isDeepDive = location.pathname.includes("emp-skills-deep-dive-in");
    startPoller();
    if (isDeepDive) startWatchdog();
    setStatus("Waiting for the page's questions to load...");
    updateProgress();
    if (!isDeepDive) loadQuestions().catch(() => {});
  }

  /* ---------------- init ---------------- */

  async function init() {
    buildPanel();
    injectHook();
    if (!isDeepDive) loadQuestions().catch((e) => setStatus("Error: " + e.message));
    startPoller();
    if (isDeepDive) startWatchdog();
    console.log("[MayaAF] init settings:", { autoRun, autoAdvance, useFirebase, useAI, isDeepDive });

    const observer = new MutationObserver(() => {
      if (isDeepDive || !autoRun || running) return;
      clearTimeout(observer.timer);
      observer.timer = setTimeout(() => {
        const radios = $$('input[type=radio][name^="question"]');
        if (!radios.length) return;
        const stats = getGridStats();
        const anyPending = stats && stats.answered < stats.total;
        if (anyPending && stats.answered > lastAnsweredCount) {
          lastAnsweredCount = stats.answered;
          autoFillAll();
        } else {
          updateProgress();
        }
      }, 350);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        handleNavigation();
      }
    }, 800);
  }

  init();
})();