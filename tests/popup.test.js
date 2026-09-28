import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const popupHtml = fs.readFileSync(path.join(process.cwd(), 'popup.html'), 'utf-8');
const popupScript = fs.readFileSync(path.join(process.cwd(), 'popup.js'), 'utf-8');
const bodyHtml = popupHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

function mountPopup({ aiTest, stored = {} } = {}) {
  document.body.innerHTML = bodyHtml;

  const setCalls = [];
  const sent = [];
  const state = { ...stored };

  global.chrome = {
    storage: {
      local: {
        get: (keys, callback) => {
          const result = Array.isArray(keys)
            ? keys.reduce((acc, k) => { acc[k] = state[k]; return acc; }, {})
            : { ...keys };
          if (callback) callback(result);
          return Promise.resolve(result);
        },
        set: (items, callback) => {
          Object.assign(state, items);
          setCalls.push(items);
          if (callback) callback();
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      sendMessage: (message, callback) => {
        sent.push(message);
        const response = message.type === 'AI_TEST' ? aiTest : { ok: false, error: 'mocked' };
        if (callback) callback(response);
        return Promise.resolve(response);
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
      getURL: (p) => `chrome-extension://test/${p}`,
    },
  };

  new Function(popupScript)();
  return { state, setCalls, sent };
}

describe('popup.html', () => {
  it('exposes the provider buttons and the connect button', () => {
    expect(bodyHtml).toContain('id="useGemini"');
    expect(bodyHtml).toContain('id="useOpenRouter"');
    expect(bodyHtml).toContain('id="connectGemini"');
    expect(bodyHtml).not.toContain('name="aiProvider"');
  });

  it('has no roll number or answer-path block', () => {
    expect(bodyHtml).not.toContain('id="rollNo"');
    expect(bodyHtml).not.toMatch(/Roll number/i);
    expect(bodyHtml).not.toMatch(/Answer path/i);
  });

  it('never mentions the storage backend in anything the user reads', () => {
    // The popup, and any string popup.js can put on screen.
    expect(bodyHtml).not.toMatch(/firebase/i);
    expect(popupScript).not.toMatch(/(textContent|innerHTML|placeholder|title)\s*=\s*["'`][^"'`]*firebase/i);
    const userStrings = [...popupScript.matchAll(/(?:textContent|innerHTML)\s*=\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    for (const s of userStrings) expect(s).not.toMatch(/firebase/i);
  });

  it('gives every button a visible background', () => {
    const style = bodyHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
    // White text on a button with no background renders invisible.
    expect(style).toMatch(/\bbutton\s*\{[^}]*background:/);
    // No button may rely on an inline colour either - they all get one from CSS.
    for (const id of ['saveJson', 'clearJson', 'useGemini', 'useOpenRouter', 'connectGemini', 'testStore', 'testAI']) {
      expect(style).toMatch(new RegExp(`#${id}\\b[^}]*background:`));
      const tag = bodyHtml.match(new RegExp(`<button id="${id}"[^>]*>`))[0];
      expect(tag).not.toMatch(/style="[^"]*background/);
    }
  });

  it('keeps white button text legible against the button colours', () => {
    const relLum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const style = bodyHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
    const vars = Object.fromEntries([...style.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
    for (const id of ['testStore', 'testAI', 'connectGemini', 'useGemini', 'useOpenRouter']) {
      const hex = style.match(new RegExp(`#${id}[^}]*background:\\s*var\\(--([\\w-]+)\\)`))[1];
      const color = vars[hex];
      const ratio = (1.05 / (relLum(color) + 0.05));
      expect(ratio, `${id} on ${color}`).toBeGreaterThan(4.5);
    }
  });
});

describe('popup.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('parses without syntax errors', () => {
    expect(() => new Function(popupScript)).not.toThrow();
  });

  it('defaults to Gemini and warns while it is not connected', async () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    await tick();
    expect(document.getElementById('geminiFields').style.display).toBe('block');
    expect(document.getElementById('aiStatus').textContent).toMatch(/not connected/i);
  });

  it('saves the key only after a successful connect command', async () => {
    const { state } = mountPopup({
      aiTest: { ok: true, provider: 'gemini', model: 'gemini-3.5-flash', answer: '4' },
    });
    await tick();

    document.getElementById('geminiApiKey').value = 'AIzaTestKey';
    document.getElementById('geminiModel').value = 'gemini-2.0-flash';
    document.getElementById('connectGemini').click();
    await tick();

    expect(state.geminiApiKey).toBe('AIzaTestKey');
    expect(state.geminiModel).toBe('gemini-3.5-flash');
    expect(state.aiProvider).toBe('gemini');
    expect(document.getElementById('connectStatus').textContent).toMatch(/connected/i);
    expect(document.getElementById('aiStatus').textContent).toMatch(/connected/i);
  });

  it('leaves the saved settings alone when the connect command fails', async () => {
    const { state, setCalls } = mountPopup({
      aiTest: { ok: false, error: 'Gemini API 400 - API key not valid' },
      stored: { aiProvider: 'openrouter' },
    });
    await tick();

    document.getElementById('geminiApiKey').value = 'AIzaBadKey';
    document.getElementById('connectGemini').click();
    await tick();

    expect(state.geminiApiKey).toBeUndefined();
    expect(state.aiProvider).toBe('openrouter');
    expect(setCalls.some((c) => 'geminiApiKey' in c)).toBe(false);
    expect(document.getElementById('connectStatus').textContent).toMatch(/not connected: gemini api 400/i);
  });

  it('Use OpenRouter switches provider and hides the Gemini fields', async () => {
    const { state } = mountPopup({ aiTest: { ok: false, error: 'unused' } });
    await tick();

    document.getElementById('useOpenRouter').click();
    await tick();

    expect(state.aiProvider).toBe('openrouter');
    expect(document.getElementById('geminiFields').style.display).toBe('none');
    expect(document.getElementById('aiStatus').textContent).toMatch(/openrouter/i);

    document.getElementById('useGemini').click();
    await tick();
    expect(state.aiProvider).toBe('gemini');
    expect(document.getElementById('geminiFields').style.display).toBe('block');
  });

  it('does not connect without a key', async () => {
    const { sent } = mountPopup({ aiTest: { ok: true, model: 'x', answer: '4' } });
    await tick();
    document.getElementById('connectGemini').click();
    await tick();
    expect(sent.some((m) => m.type === 'AI_TEST')).toBe(false);
    expect(document.getElementById('connectStatus').textContent).toMatch(/paste your gemini api key/i);
  });
});

describe('model picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const openList = () => document.getElementById('modelToggle').click();
  const rows = () => Array.from(document.getElementById('modelList').querySelectorAll('li'));

  it('replaces the unstyleable native datalist', () => {
    expect(bodyHtml).not.toContain('<datalist');
    expect(bodyHtml).not.toContain('geminiModelList');
    expect(bodyHtml).toContain('id="modelList"');
    expect(bodyHtml).toContain('id="modelToggle"');
  });

  it('is hidden until opened, then lists the live models', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    const list = document.getElementById('modelList');
    expect(list.hidden).toBe(true);

    openList();
    expect(list.hidden).toBe(false);
    expect(rows().length).toBeGreaterThan(3);
    expect(rows().map((li) => li.querySelector('.id').textContent)).toContain('gemini-flash-latest');
  });

  it('closes again on the second click', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    openList();
    openList();
    expect(document.getElementById('modelList').hidden).toBe(true);
  });

  it('filters as you type', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    const input = document.getElementById('geminiModel');
    input.value = 'pro';
    openList();
    expect(rows().map((li) => li.querySelector('.id').textContent)).toEqual(['gemini-2.5-pro']);
  });

  it('offers the typed id as a custom choice when it is not a known model', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    const input = document.getElementById('geminiModel');
    input.value = 'gemini-9-ultra-preview';
    openList();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].className).toMatch(/custom/);
    expect(rows()[0].querySelector('.id').textContent).toBe('gemini-9-ultra-preview');
  });

  it('fills the field when a row is picked', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    openList();
    const target = rows().find((li) => li.querySelector('.id').textContent === 'gemini-2.5-flash');
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.getElementById('geminiModel').value).toBe('gemini-2.5-flash');
    expect(document.getElementById('modelList').hidden).toBe(true);
    expect(document.getElementById('connectStatus').textContent).toMatch(/not saved yet/i);
  });

  it('ticks the model already in use', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    document.getElementById('geminiModel').value = 'gemini-2.5-flash-lite';
    openList();
    const current = rows().find((li) => li.querySelector('.id').textContent === 'gemini-2.5-flash-lite');
    expect(current.querySelector('.tick')).toBeTruthy();
    expect(current.getAttribute('aria-selected')).toBe('true');
  });

  it('selects with the keyboard', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    const input = document.getElementById('geminiModel');
    openList();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(input.value).toBe('gemini-flash-latest');
    expect(document.getElementById('modelList').hidden).toBe(true);
  });

  it('closes on Escape without changing the field', () => {
    mountPopup({ aiTest: { ok: false, error: 'unused' } });
    const input = document.getElementById('geminiModel');
    openList();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('modelList').hidden).toBe(true);
    expect(input.value).toBe('');
  });

  it('keeps the free-typed id when connecting', async () => {
    const { state } = mountPopup({
      aiTest: { ok: true, provider: 'gemini', model: 'gemini-9-ultra-preview', answer: '4' },
    });
    await tick();
    document.getElementById('geminiApiKey').value = 'AIzaTestKey';
    document.getElementById('geminiModel').value = 'gemini-9-ultra-preview';
    document.getElementById('connectGemini').click();
    await tick();
    expect(state.geminiModel).toBe('gemini-9-ultra-preview');
  });
});
