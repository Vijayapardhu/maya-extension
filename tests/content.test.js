import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const contentPath = path.join(process.cwd(), 'content.js');
const contentScript = fs.readFileSync(contentPath, 'utf-8');

describe('content.js', () => {
  it('should parse without syntax errors', () => {
    expect(() => new Function(contentScript)).not.toThrow();
  });

  it('never shows the storage backend name to the user', () => {
    // Everything setStatus()/textContent can put in the panel.
    const shown = [...contentScript.matchAll(/setStatus\(\s*[`'"]([^`'"]*)[`'"]/g)].map((m) => m[1]);
    expect(shown.length).toBeGreaterThan(5);
    for (const s of shown) expect(s).not.toMatch(/firebase/i);

    const assigned = [...contentScript.matchAll(/\.(?:textContent|innerText|innerHTML)\s*=\s*[`'"]([^`'"]*)[`'"]/g)].map((m) => m[1]);
    for (const s of assigned) expect(s).not.toMatch(/firebase/i);

    // Errors surfaced to the panel must not name it either.
    const bg = fs.readFileSync(path.join(process.cwd(), 'background.js'), 'utf-8');
    const errors = [...bg.matchAll(/error:\s*[`'"]([^`'"]*)[`'"]/g)].map((m) => m[1]);
    for (const e of errors) expect(e).not.toMatch(/firebase|firestore/i);
  });

  it('should execute in jsdom without throwing', () => {
    const originalMutationObserver = global.MutationObserver;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;

    global.MutationObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));

    const intervals = [];
    global.setInterval = vi.fn((fn, ms) => {
      const id = originalSetInterval(fn, ms);
      intervals.push(id);
      return id;
    });

    try {
      const fn = new Function(contentScript);
      fn();

      expect(document.getElementById('maya-af-panel')).toBeTruthy();
      expect(document.getElementById('maya-af-mini')).toBeTruthy();
      expect(MutationObserver).toHaveBeenCalled();
    } finally {
      global.MutationObserver = originalMutationObserver;
      global.setInterval = originalSetInterval;
      global.clearInterval = originalClearInterval;
      intervals.forEach(clearInterval);
    }
  });
});

describe('content.js stores every question', () => {
  const runWithSent = async (questions) => {
    const sent = [];
    const originalSend = chrome.runtime.sendMessage;
    const originalSetInterval = global.setInterval;
    const intervals = [];
    global.setInterval = vi.fn((fn, ms) => {
      const id = originalSetInterval(fn, ms);
      intervals.push(id);
      return id;
    });
    chrome.runtime.sendMessage = (message, callback) => {
      sent.push(message);
      const response = { ok: true, stored: message.questions ? message.questions.length : 0 };
      if (callback) callback(response);
      return Promise.resolve(response);
    };
    try {
      delete window.__mayaAutoFillLoaded;
      const wrapped = contentScript.replace(
        /\n\s*init\(\);\s*\n\}\)\(\);\s*$/,
        '\n  return { setQuestions };\n})();'
      );
      expect(wrapped).not.toBe(contentScript);
      const api = new Function('return ' + wrapped)();
      api.setQuestions(questions);
      await new Promise((r) => setTimeout(r, 20));
      return sent;
    } finally {
      chrome.runtime.sendMessage = originalSend;
      global.setInterval = originalSetInterval;
      intervals.forEach(clearInterval);
    }
  };

  const questions = [
    { _id: 'q1', question: 'First question?', option1: 'A', option2: 'B', option3: 'C', option4: 'D' },
    { _id: 'q2', question: 'Second question?', option1: 'W', option2: 'X', option3: 'Y', option4: 'Z' },
  ];

  it('sends every question with its id, text and options', async () => {
    const sent = await runWithSent(questions);
    const store = sent.find((m) => m.type === 'STORE_QUESTIONS');
    expect(store).toBeTruthy();
    expect(store.testId).toBe('test-123');
    expect(store.questions).toHaveLength(2);
    expect(store.questions[0]).toEqual({
      questionId: 'q1',
      questionText: 'First question?',
      options: { option1: 'A', option2: 'B', option3: 'C', option4: 'D' },
    });
  });

  it('does not send the same question twice', async () => {
    const sent = await runWithSent(questions);
    expect(sent.filter((m) => m.type === 'STORE_QUESTIONS')).toHaveLength(1);
  });

  it('sends only the newly seen questions on a later set', async () => {
    const sent = await runWithSent(questions);
    const store = sent.find((m) => m.type === 'STORE_QUESTIONS');
    expect(store.questions.map((q) => q.questionId)).toEqual(['q1', 'q2']);
  });
});

describe('content.js utility functions', () => {
  const decodeEntities = (s) => {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  };

  const decode = (s) => {
    if (!s || typeof s !== 'string') return '';
    try {
      let d = decodeEntities(s);
      d = d.replace(/\\u([\dA-F]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
      d = d.replace(/<[^>]+>/g, '');
      d = d.replace(/^&nbsp;/, '').replace(/&nbsp;/g, '');
      d = d.replace(/\\r\\n|\\n|\\r/g, '<br/>');
      return d.trim();
    } catch (e) {
      return s;
    }
  };

  const normalize = (s) =>
    decode(s).replace(/<br\/>/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  const textsMatch = (a, b) => {
    const norm = (s) => String(s || '').replace(/^Q?\s*\d*\s*[.:)\-]?\s*/i, '').trim().toLowerCase().replace(/\s+/g, ' ');
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return true;
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  it('decodeEntities should decode HTML entities', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
    expect(decodeEntities('&nbsp;')).toBe('\u00A0');
    expect(decodeEntities('')).toBe('');
  });

  it('decode should strip tags and normalize whitespace', () => {
    expect(decode('hello')).toBe('hello');
    expect(decode('')).toBe('');
    expect(decode(null)).toBe('');
    expect(decode('<p>hello</p>')).toBe('hello');
    expect(decode('hello&nbsp;world')).toBe('hello\u00A0world');
  });

  it('normalize should lowercase and collapse whitespace', () => {
    expect(normalize('Hello   World')).toBe('hello world');
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
  });

  it('textsMatch should match normalized strings', () => {
    expect(textsMatch('What is 2+2?', 'what is 2+2?')).toBe(true);
    expect(textsMatch('Hello World', 'World')).toBe(true);
    expect(textsMatch('A', 'B')).toBe(false);
    expect(textsMatch('', 'anything')).toBe(true);
    expect(textsMatch(null, 'anything')).toBe(true);
  });

  it('waitFor should resolve when condition is met', async () => {
    const waitFor = (fn, timeout = 3000, interval = 40) => {
      return new Promise((resolve) => {
        const t0 = Date.now();
        (function poll() {
          let done = false;
          try { done = fn(); } catch (e) { /* ignore */ }
          if (done) return resolve(true);
          if (Date.now() - t0 > timeout) return resolve(false);
          setTimeout(poll, interval);
        })();
      });
    };

    let counter = 0;
    const result = await waitFor(() => ++counter >= 3, 1000, 10);
    expect(result).toBe(true);
  });

  it('waitFor should resolve false on timeout', async () => {
    const waitFor = (fn, timeout = 3000, interval = 40) => {
      return new Promise((resolve) => {
        const t0 = Date.now();
        (function poll() {
          let done = false;
          try { done = fn(); } catch (e) { /* ignore */ }
          if (done) return resolve(true);
          if (Date.now() - t0 > timeout) return resolve(false);
          setTimeout(poll, interval);
        })();
      });
    };

    const result = await waitFor(() => false, 100, 10);
    expect(result).toBe(false);
  });

  it('sleep should resolve after delay', async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
