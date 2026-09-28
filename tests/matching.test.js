import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const backgroundSrc = fs.readFileSync(path.join(process.cwd(), 'background.js'), 'utf-8');
const contentSrc = fs.readFileSync(path.join(process.cwd(), 'content.js'), 'utf-8');

/* Runs the real background.js with Firebase + chrome stubbed out, so the
   matching code under test is the shipped code, not a copy of it. */
function loadBackground() {
  const stubs = `
    const initializeApp = () => ({});
    const getFirestore = () => ({});
    const doc = () => ({});
    const getDoc = async () => ({ exists: () => false });
    const setDoc = async () => {};
    const collection = () => ({});
    const query = () => ({});
    const where = () => ({});
    const getDocs = async () => ({ size: 0, forEach: () => {} });
    const serverTimestamp = () => 0;
    const limit = () => {};
    const documentId = () => 'documentId()';
    const writeBatch = () => ({ set: () => {}, commit: async () => {} });
    const chrome = {
      runtime: { getManifest: () => ({ version: '0.0.0' }), onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} } },
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
    };
    const fetch = async () => ({ ok: false, status: 500, text: async () => '', json: async () => ({}) });
  `;
  const body = backgroundSrc.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm, '');
  return new Function(stubs + body + '\nreturn { matchAnswer, matchOption, parseMultiResponse, parseLooseLetters, buildMultiPrompt, buildMultiTextPrompt, buildPrompt, buildTextPrompt, questionKey, hashQuestion, safeTestKey };')();
}

/* Runs the real content.js in jsdom and hands back the pure helpers by
   returning them from inside the IIFE. */
function loadContentHelpers() {
  const originalSetInterval = global.setInterval;
  const intervals = [];
  global.setInterval = vi.fn((fn, ms) => {
    const id = originalSetInterval(fn, ms);
    intervals.push(id);
    return id;
  });
  try {
    const wrapped = contentSrc.replace(
      /\n\s*init\(\);\s*\n\}\)\(\);\s*$/,
      '\n  return { pickOption, normAnswerText, answerWords, OPTION_LETTER_RE };\n})();'
    );
    expect(wrapped).not.toBe(contentSrc);
    return new Function('return ' + wrapped)();
  } finally {
    global.setInterval = originalSetInterval;
    intervals.forEach(clearInterval);
  }
}

const bg = loadBackground();
const ct = loadContentHelpers();

const options = {
  option1: 'True',
  option2: 'Scurvy',
  option3: 'Vitamin C deficiency',
  option4: 'Rickets',
};

describe('matchAnswer', () => {
  it('accepts an exact copy of the option text', () => {
    const m = bg.matchAnswer('Scurvy', options);
    expect(m.text).toBe('Scurvy');
    expect(m.confidence).toBe('exact');
  });

  it('ignores case, trailing punctuation and quotes', () => {
    expect(bg.matchAnswer('"scurvy".', options).confidence).toBe('exact');
    expect(bg.matchAnswer('  Vitamin C deficiency ', options).text).toBe('Vitamin C deficiency');
  });

  it('treats a bare letter as that option only when it is the whole answer', () => {
    expect(bg.matchAnswer('B', options).text).toBe('Scurvy');
    expect(bg.matchAnswer('option 3', options).text).toBe('Vitamin C deficiency');
    expect(bg.matchAnswer('(c)', options).text).toBe('Vitamin C deficiency');
  });

  it('never maps a letter that merely appears inside a sentence', () => {
    // The old regex matched the "a" in "answer" and locked onto option 1.
    const m = bg.matchAnswer('The correct answer is Scurvy', options);
    expect(m.text).toBe('Scurvy');
    expect(m.confidence).not.toBe('letter');
    expect(bg.matchAnswer('The correct answer is Rickets', options).text).toBe('Rickets');
  });

  it('does not let a short substring latch onto a longer option', () => {
    const numeric = { option1: '42', option2: '14', option3: '7', option4: '1' };
    expect(bg.matchAnswer('14', numeric).text).toBe('14');
    expect(bg.matchAnswer('4', numeric).confidence).toBe('none');
  });

  it('handles a verbose answer through unique word overlap', () => {
    const m = bg.matchAnswer('It is caused by a lack of vitamin C in the diet', options);
    expect(m.text).toBe('Vitamin C deficiency');
    expect(['fuzzy', 'contains']).toContain(m.confidence);
  });

  it('refuses to guess when two options match equally well', () => {
    const m = bg.matchAnswer('Paris', { option1: 'Paris, France', option2: 'Paris, Texas', option3: 'Lyon', option4: 'Nice' });
    expect(m.confidence).toBe('none');
  });

  it('refuses to guess when the answer matches nothing', () => {
    expect(bg.matchAnswer('None of these', options).confidence).toBe('none');
    expect(bg.matchAnswer('', options).confidence).toBe('none');
  });

  it('matchOption still returns text for older callers', () => {
    expect(bg.matchOption('B', options)).toBe('Scurvy');
  });
});

describe('parseMultiResponse', () => {
  const questions = [
    { questionId: 'q1', question: 'Q one', options: { option1: 'A1', option2: 'A2', option3: 'A3', option4: 'A4' } },
    { questionId: 'q2', question: 'Q two', options: { option1: 'B1', option2: 'B2', option3: 'B3', option4: 'B4' } },
    { questionId: 'q3', question: 'Q three', options: { option1: 'C1', option2: 'C2', option3: 'C3', option4: 'C4' } },
  ];

  it('reads the compact letter contract', () => {
    const out = bg.parseMultiResponse('[{"id":"q1","a":"A"},{"id":"q2","a":"B"},{"id":"q3","a":"C"}]', questions);
    expect(out.map((r) => r.answer)).toEqual(['A1', 'B2', 'C3']);
    expect(out.every((r) => r.confidence === 'letter')).toBe(true);
  });

  it('maps answers by id, out of order', () => {
    const out = bg.parseMultiResponse(JSON.stringify([
      { id: 'q3', a: 'C' },
      { id: 'q1', a: 'A' },
      { id: 'q2', a: 'B' },
    ]), questions);
    expect(out.map((r) => r.answer).sort()).toEqual(['A1', 'B2', 'C3']);
  });

  it('does not shift answers when ids are missing', () => {
    // 2 answers for 3 questions: q2 stays unanswered instead of being guessed.
    const out = bg.parseMultiResponse('[{"id":"q1","a":"A"},{"id":"q3","a":"C"}]', questions);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.questionId === 'q3').answer).toBe('C3');
    expect(out.find((r) => r.questionId === 'q2')).toBeUndefined();
  });

  it('still understands a model that returns option text', () => {
    const out = bg.parseMultiResponse('[{"id":"q1","a":"A2"}]', questions);
    expect(out[0].answer).toBe('A2');
    expect(out[0].confidence).toBe('exact');
  });

  it('strips markdown fences and prose around the array', () => {
    const out = bg.parseMultiResponse('Here:\n```json\n[{"id":"q1","a":"A"}]\n```', questions);
    expect(out[0].answer).toBe('A1');
  });

  it('throws when there is no array at all', () => {
    expect(() => bg.parseMultiResponse('I cannot answer that.', questions)).toThrow();
  });
});

describe('parseLooseLetters', () => {
  const questions = [
    { questionId: 'q1', question: 'Q one', options: { option1: 'A1', option2: 'A2', option3: 'A3', option4: 'A4' } },
    { questionId: 'q2', question: 'Q two', options: { option1: 'B1', option2: 'B2', option3: 'B3', option4: 'B4' } },
  ];

  it('recovers an "id: letter" list', () => {
    const out = bg.parseLooseLetters('q1: B\nq2: D', questions);
    expect(out.map((r) => r.answer)).toEqual(['A2', 'B4']);
  });

  it('recovers a bare letter list', () => {
    const out = bg.parseLooseLetters('B\nC', questions);
    expect(out.map((r) => r.answer)).toEqual(['A2', 'B3']);
  });

  it('recovers nothing when the count does not line up', () => {
    expect(bg.parseLooseLetters('B', questions)).toEqual([]);
  });

  it('recovers nothing from prose', () => {
    expect(bg.parseLooseLetters('I cannot answer that.', questions)).toEqual([]);
  });
});

describe('prompts stay small', () => {
  const question = { questionId: 'q1', question: 'Capital of France?', options };

  it('asks for one letter, not the option text', () => {
    const p = bg.buildPrompt(question.question, options);
    expect(p).toMatch(/letter of the correct option only/i);
    expect(p.trim().endsWith('Answer:')).toBe(true);
  });

  it('keeps the batch contract to two short lines', () => {
    const p = bg.buildMultiPrompt([question], false);
    expect(p).toContain('[{"id":"<id>","a":"<A|B|C|D>"}, ...]');
    expect(p).toContain('[id=q1]');
    expect(p).not.toMatch(/EXACTLY/);
  });

  it('has a text-only fallback prompt', () => {
    expect(bg.buildTextPrompt(question.question, options)).toMatch(/copy the correct option text/i);
    expect(bg.buildMultiTextPrompt([question])).toMatch(/exact option text/i);
  });

  it('re-check prompt asks for letters again', () => {
    expect(bg.buildMultiPrompt([question], true)).toMatch(/re-check/i);
  });

  it('is far shorter than the old text-copying contract', () => {
    const batch = bg.buildMultiPrompt([question], false);
    const old = `Answer each of the following 1 multiple choice questions.\n\nQ1 [id=q1]: Capital of France?\n  A. True\n  B. Scurvy\n  C. Vitamin C deficiency\n  D. Rickets\n\nReturn ONLY a JSON array, no other text. Format:\n[{"questionId":"<id>","answer":"<exact option text>"}, ...]\nCopy each answer EXACTLY as it appears in that question's options.\nInclude all 1 questions, using the exact id shown on each question.`;
    expect(batch.length).toBeLessThan(old.length);
  });
});

describe('shared question index', () => {
  it('normalises the question text so small edits still match', () => {
    expect(bg.questionKey('  What is 2+2?  ')).toBe('what is 2 2');
    expect(bg.questionKey('What is 2 + 2?')).toBe(bg.questionKey('what is 2+2'));
    expect(bg.questionKey('Capital of France?')).toBe('capital of france');
    // Digits must not get glued together by dropped punctuation.
    expect(bg.questionKey('2+2')).not.toBe(bg.questionKey('22'));
    expect(bg.questionKey('Capital of France?')).not.toBe(bg.questionKey('Capital of Italy?'));
  });

  it('hashes to a short stable document id', async () => {
    const a = await bg.hashQuestion('What is 2+2?');
    const b = await bg.hashQuestion('what is  2 + 2 ?');
    const c = await bg.hashQuestion('What is 3+3?');
    expect(a).toHaveLength(24);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('returns no hash for an empty question', async () => {
    expect(await bg.hashQuestion('   ')).toBe('');
  });

  it('only accepts test ids that are safe as map keys', () => {
    expect(bg.safeTestKey('66f1a2b3c4d5')).toBe('66f1a2b3c4d5');
    expect(bg.safeTestKey('a.b')).toBe('');
    expect(bg.safeTestKey('a/b')).toBe('');
    expect(bg.safeTestKey('')).toBe('');
  });
});

describe('content.js option picking matches the worker', () => {
  it('applies the same rules', () => {
    expect(ct.pickOption('Scurvy', options).confidence).toBe('exact');
    expect(ct.pickOption('B', options).text).toBe('Scurvy');
    expect(ct.pickOption('The correct answer is Rickets', options).text).toBe('Rickets');
    expect(ct.pickOption('None of these', options).confidence).toBe('none');
  });

  it('anchors the letter pattern', () => {
    expect(ct.OPTION_LETTER_RE.test('b')).toBe(true);
    expect(ct.OPTION_LETTER_RE.test('option 2')).toBe(true);
    expect(ct.OPTION_LETTER_RE.test('the correct answer is b')).toBe(false);
  });
});
