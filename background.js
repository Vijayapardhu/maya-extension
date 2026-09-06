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
let DEFAULT_MODEL = "auto";

async function loadConfig() {
  try {
    const ref = doc(db, "config", "ai");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.openrouterApiKey) OPENROUTER_API_KEY = data.openrouterApiKey;
      if (data.model) DEFAULT_MODEL = data.model;
      console.log("Config loaded from Firebase:", { model: DEFAULT_MODEL, hasKey: !!OPENROUTER_API_KEY });
    }
  } catch (e) {
    console.warn("Failed to load config from Firebase:", e);
  }
}

loadConfig();

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
             const q = query(collection(db, "answers"), where("testId", "==", msg.testId));
             const snap = await getDocs(q);
             const results = {};
             snap.forEach(d => {
                 const data = d.data();
                 results[data.questionId] = data.answer;
             });
             sendResponse({ ok: true, answers: results });
         } catch (e) {
             sendResponse({ ok: false, error: String(e) });
         }
     })();
     return true;
 }

 if (msg.type === "REVIEW_GET_ANSWERS") {
     (async () => {
         try {
             const cookies = await new Promise((resolve) => {
                 chrome.cookies.getAll({ url: "https://api.maya.adityauniversity.in" }, (c) => resolve(c || []));
             });
             const headers = { "Content-Type": "application/json" };
             if (cookies.length) {
                 headers["Cookie"] = cookies.map((c) => c.name + "=" + c.value).join("; ");
             }
             const response = await fetch("https://api.maya.adityauniversity.in/node/api/review-grand-assessment", {
                 method: "POST",
                 headers: headers,
                 body: JSON.stringify({
                     assessment: msg.testId,
                     test_type: "general",
                     roll_no: msg.rollNo || null
                 })
             });
             if (!response.ok) throw new Error("HTTP " + response.status);
             const data = await response.json();
             const answers = {};
             const items = Array.isArray(data.question_details) ? data.question_details : [];
             for (const item of items) {
                 if (item.question_id && item.answer) {
                     answers[item.question_id] = item.answer;
                 }
             }
             sendResponse({ ok: true, answers });
         } catch (e) {
             sendResponse({ ok: false, error: String(e) });
         }
     })();
     return true;
 }

 if (msg.type === "REVIEW_GET_ANSWER") {
     (async () => {
         try {
             const cookies = await new Promise((resolve) => {
                 chrome.cookies.getAll({ url: "https://api.maya.adityauniversity.in" }, (c) => resolve(c || []));
             });
             const headers = { "Content-Type": "application/json" };
             if (cookies.length) {
                 headers["Cookie"] = cookies.map((c) => c.name + "=" + c.value).join("; ");
             }
             const response = await fetch("https://api.maya.adityauniversity.in/node/api/review-grand-assessment", {
                 method: "POST",
                 headers: headers,
                 body: JSON.stringify({
                     assessment: msg.testId,
                     test_type: "general",
                     roll_no: msg.rollNo || null
                 })
             });
             const text = await response.text();
             console.log("[MayaAF] REVIEW_GET_ANSWER status:", response.status, "body:", text.substring(0, 200));
             if (!response.ok) throw new Error("HTTP " + response.status + ": " + text);
             const data = JSON.parse(text);
             const items = Array.isArray(data.question_details) ? data.question_details : [];
             const found = items.find(item => item.question_id === msg.questionId);
             if (found && found.answer) {
                 sendResponse({ ok: true, answer: found.answer });
             } else {
                 sendResponse({ ok: false, error: "Answer not found in response" });
             }
         } catch (e) {
             console.error("[MayaAF] REVIEW_GET_ANSWER error:", e);
             sendResponse({ ok: false, error: String(e) });
         }
     })();
     return true;
 }

  if (msg.type === "FIREBASE_GET_ANSWER") {
    (async () => {
      try {
        const ref = doc(db, "answers", `${msg.testId}_${msg.questionId}`);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          sendResponse({ ok: true, answer: snap.data().answer });
        } else {
          sendResponse({ ok: true, answer: null });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "FIREBASE_SAVE_ANSWER") {
    (async () => {
      try {
        const ref = doc(db, "answers", `${msg.testId}_${msg.questionId}`);
        await setDoc(ref, {
          testId: msg.testId,
          questionId: msg.questionId,
          questionText: msg.questionText,
          answer: msg.answer,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "FIREBASE_TEST") {
    (async () => {
      try {
        const q = query(collection(db, "answers"), limit(1));
        await getDocs(q);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "FIREBASE_COUNT") {
    (async () => {
      try {
        const snap = await getDocs(collection(db, "answers"));
        sendResponse({ ok: true, count: snap.size });
      } catch (e) {
        sendResponse({ ok: false, error: String(e), count: 0 });
      }
    })();
    return true;
  }

  if (msg.type === "OPENROUTER_ANSWER") {
    (async () => {
      try {
        if (!OPENROUTER_API_KEY) {
          sendResponse({ ok: false, error: "OpenRouter API key not configured in Firebase. Add it to Firestore config/ai document." });
          return;
        }
        if (msg._useAI === false) {
          sendResponse({ ok: false, error: "AI is disabled in settings" });
          return;
        }
        const prompt = `Answer this multiple choice question. Return ONLY the correct option text (exactly as it appears in the options).

Question: ${msg.question}

Options:
1. ${msg.options.option1}
2. ${msg.options.option2}
3. ${msg.options.option3}
4. ${msg.options.option4}

Correct answer (option text only):`;

        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": "https://maya.adityauniversity.in",
            "X-Title": "Maya AutoPilot"
          },
 body: JSON.stringify({
               model: DEFAULT_MODEL,
               messages: [{ role: "user", content: prompt }],
               temperature: 0,
               max_tokens: 1024
             })
        });

        if (!response.ok) {
          const err = await response.text();
          sendResponse({ ok: false, error: "API " + response.status + ": " + err });
          return;
        }

        const data = await response.json();
        console.log("OpenRouter single response:", JSON.stringify(data));
        const message = data.choices?.[0]?.message;
        const answer = (message?.content?.trim()) || (message?.reasoning?.trim());
        
        if (!answer) {
          sendResponse({ ok: false, error: "Empty response: " + JSON.stringify(data) });
          return;
        }

        const normalized = answer.toLowerCase().trim();
        let matchedOption = null;
        for (let i = 1; i <= 4; i++) {
          const opt = msg.options[`option${i}`];
          if (opt && opt.toLowerCase().trim() === normalized) {
            matchedOption = opt;
            break;
          }
        }
        if (!matchedOption) {
          for (let i = 1; i <= 4; i++) {
            const opt = msg.options[`option${i}`];
            if (opt && (normalized.includes(opt.toLowerCase().trim()) || opt.toLowerCase().trim().includes(normalized))) {
              matchedOption = opt;
              break;
            }
          }
        }

        sendResponse({ ok: true, answer: matchedOption || answer });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === "OPENROUTER_BATCH_ANSWER") {
    (async () => {
      try {
        if (!OPENROUTER_API_KEY) {
          sendResponse({ ok: false, error: "OpenRouter API key not configured in Firebase. Add it to Firestore config/ai document." });
          return;
        }
        if (msg._useAI === false) {
          sendResponse({ ok: false, error: "AI is disabled in settings" });
          return;
        }
        const { questions } = msg;
        const promises = questions.map(async (q) => {
          const prompt = `Answer this multiple choice question. Return ONLY the correct option text (exactly as it appears in the options).

Question: ${q.question}

Options:
1. ${q.options.option1}
2. ${q.options.option2}
3. ${q.options.option3}
4. ${q.options.option4}

Correct answer (option text only):`;

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
                   model: DEFAULT_MODEL,
                   messages: [{ role: "user", content: prompt }],
                   temperature: 0,
                   max_tokens: 1024
                 })
            });

            if (!response.ok) {
              return { questionId: q.questionId, ok: false, error: "API " + response.status };
            }

            const data = await response.json();
            console.log("OpenRouter response:", JSON.stringify(data));
            const message = data.choices?.[0]?.message;
            const answer = (message?.content?.trim()) || (message?.reasoning?.trim());
            
            if (!answer) {
              return { questionId: q.questionId, ok: false, error: "Empty response: " + JSON.stringify(data) };
            }

            const normalized = answer.toLowerCase().trim();
            let matchedOption = null;
            for (let i = 1; i <= 4; i++) {
              const opt = q.options[`option${i}`];
              if (opt && opt.toLowerCase().trim() === normalized) {
                matchedOption = opt;
                break;
              }
            }
            if (!matchedOption) {
              for (let i = 1; i <= 4; i++) {
                const opt = q.options[`option${i}`];
                if (opt && (normalized.includes(opt.toLowerCase().trim()) || opt.toLowerCase().trim().includes(normalized))) {
                  matchedOption = opt;
                  break;
                }
              }
            }

            return { questionId: q.questionId, ok: true, answer: matchedOption || answer };
          } catch (e) {
            return { questionId: q.questionId, ok: false, error: String(e) };
          }
        });

        const results = await Promise.all(promises);
        sendResponse({ ok: true, results });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});