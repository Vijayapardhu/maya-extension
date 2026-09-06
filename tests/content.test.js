import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const contentPath = path.join(process.cwd(), 'content.js');
const contentScript = fs.readFileSync(contentPath, 'utf-8');

describe('content.js', () => {
  it('should parse without syntax errors', () => {
    expect(() => new Function(contentScript)).not.toThrow();
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
