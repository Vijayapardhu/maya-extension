import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const backgroundSrc = fs.readFileSync(path.join(process.cwd(), 'background.js'), 'utf-8');

/* Minimal in-memory stand-in for the Firestore web SDK, so the store layer can
   be exercised for real: field-path merges, the documentId() "in" query and
   batched writes all behave the way the SDK does. */
function makeFakeFirestore() {
  const store = new Map();
  const join = (...p) => p.join('/');
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const setPath = (target, dotted, value) => {
    const parts = dotted.split('.');
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = clone(value);
  };

  const applyMerge = (docPath, data) => {
    const current = store.get(docPath);
    const next = current ? clone(current) : {};
    for (const [k, v] of Object.entries(data)) setPath(next, k, v);
    store.set(docPath, next);
  };

  const api = {
    store,
    snapshot(id) {
      const p = join('questions', id);
      return { id, exists: () => store.has(p), data: () => clone(store.get(p)) };
    },
    // The SDK's doc()/collection() take the db ref first and ignore it.
    doc: (_dbRef, ...p) => ({ __path: join(...p) }),
    collection: (_dbRef, ...p) => ({ __coll: join(...p) }),
    query: (coll, ...conds) => ({ __coll: coll.__coll, __conds: conds }),
    where: (field, op, value) => ({ __isWhere: true, field, op, value }),
    documentId: () => ({ __docId: true }),
    getDoc: async (d) => {
      const p = d.__path;
      return { id: p.split('/').pop(), exists: () => store.has(p), data: () => clone(store.get(p)) };
    },
    getDocs: async (q) => {
      const ids = q.__conds.find((c) => c && c.__docId);
      const wanted = ids ? ids.value : null;
      const rows = [];
      for (const [key, value] of store.entries()) {
        if (!key.startsWith(q.__coll + '/')) continue;
        const id = key.slice(q.__coll.length + 1);
        if (wanted && !wanted.includes(id)) continue;
        rows.push({ id, data: () => clone(value) });
      }
      return { size: rows.length, forEach: (fn) => rows.forEach(fn) };
    },
    setDoc: async (d, data) => applyMerge(d.__path, data),
    writeBatch: () => {
      const ops = [];
      return {
        set: (d, data) => ops.push(() => applyMerge(d.__path, data)),
        commit: async () => ops.forEach((op) => op()),
      };
    },
    serverTimestamp: () => 0,
    limit: () => {},
  };
  return api;
}

function loadStore(fake) {
  const stubs = `
    const initializeApp = () => ({});
    const getFirestore = () => globalThis.__fake;
    const doc = (...p) => globalThis.__fake.doc(...p);
    const collection = (...p) => globalThis.__fake.collection(...p);
    const query = (...a) => globalThis.__fake.query(...a);
    const where = (...a) => globalThis.__fake.where(...a);
    const getDoc = (...a) => globalThis.__fake.getDoc(...a);
    const getDocs = (...a) => globalThis.__fake.getDocs(...a);
    const setDoc = (...a) => globalThis.__fake.setDoc(...a);
    const writeBatch = (...a) => globalThis.__fake.writeBatch(...a);
    const documentId = (...a) => globalThis.__fake.documentId(...a);
    const serverTimestamp = () => globalThis.__fake.serverTimestamp();
    const limit = (...a) => globalThis.__fake.limit(...a);
    const chrome = {
      runtime: { getManifest: () => ({ version: '0' }), onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} } },
      storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
      alarms: { create: () => {}, onAlarm: { addListener: () => {} } }
    };
    const fetch = async () => ({ ok: false, status: 500, text: async () => '' });
  `;
  globalThis.__fake = fake;
  const body = backgroundSrc.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm, '');
  const fn = new Function(stubs + body + '\nreturn { writeSharedQuestions, writeQuestionBank, writeQuestionDocs, readSharedQuestions, hashQuestion, writeNestedAnswers, testDocRef };');
  return fn();
}

// Shape the content script actually sends: questionText + options + answer.
const Q1 = {
  questionId: 'aaa111',
  questionText: 'Which vitamin deficiency causes scurvy?',
  options: { option1: 'Vitamin A deficiency', option2: 'Vitamin C deficiency', option3: 'Vitamin D deficiency', option4: 'Iron deficiency' },
  answer: 'Vitamin C deficiency',
  confidence: 'exact',
};
const Q2 = {
  questionId: 'bbb222',
  questionText: 'What is the capital of France?',
  options: { option1: 'Berlin', option2: 'Madrid', option3: 'Paris', option4: 'Rome' },
  answer: 'Paris',
  confidence: 'exact',
};

describe('shared question index', () => {
  it('stores the whole record under a hash of the question text', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);

    const saved = await store.writeSharedQuestions('testA', [Q1, Q2]);
    expect(saved).toBe(2);

    const h1 = await store.hashQuestion(Q1.questionText);
    const doc = fake.snapshot(h1);
    expect(doc.exists()).toBe(true);

    const data = doc.data();
    expect(data.h).toBe(h1);
    expect(data.q).toBe(Q1.questionText);
    expect(data.o).toEqual({ a: 'Vitamin A deficiency', b: 'Vitamin C deficiency', c: 'Vitamin D deficiency', d: 'Iron deficiency' });
    expect(data.ans).toEqual({ testA: { a: 'Vitamin C deficiency', c: 'exact', t: expect.any(String) } });
  });

  it('gives the same document to a different user asking the same question', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeSharedQuestions('testA', [Q1, Q2]);

    // A new user on a different test, with their own question ids.
    const entries = [
      { questionId: 'zzz999', hash: await store.hashQuestion('  which VITAMIN deficiency causes scurvy?  ') },
      { questionId: 'yyy888', hash: await store.hashQuestion('What is the capital of France?') },
    ];
    const found = await store.readSharedQuestions(entries);

    expect(found['zzz999'].answer).toBe('Vitamin C deficiency');
    expect(found['yyy888'].answer).toBe('Paris');
    expect(found['zzz999'].testId).toBe('testA');
  });

  it('keeps answers from other tests in the same document', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeSharedQuestions('testA', [{ ...Q1, answer: 'Vitamin A deficiency' }]);
    await store.writeSharedQuestions('testB', [{ ...Q1, answer: 'Vitamin C deficiency' }]);

    const h = await store.hashQuestion(Q1.questionText);
    const data = fake.snapshot(h).data();
    expect(Object.keys(data.ans).sort()).toEqual(['testA', 'testB']);
    expect(data.ans.testA.a).toBe('Vitamin A deficiency');
    expect(data.ans.testB.a).toBe('Vitamin C deficiency');
  });

  it('does not blank out fields a later run does not know', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeSharedQuestions('testA', [Q1]);
    // A partial item for the same question: no options supplied this time.
    await store.writeSharedQuestions('testB', [{ questionId: 'c', questionText: Q1.questionText, answer: 'Something', confidence: 'exact' }]);

    const h = await store.hashQuestion(Q1.questionText);
    const data = fake.snapshot(h).data();
    expect(data.q).toBe(Q1.questionText);
    expect(data.o.b).toBe('Vitamin C deficiency');
    expect(data.ans.testB.a).toBe('Something');
  });

  it('returns the newest answer when several tests answered the same question', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeSharedQuestions('testOld', [Q1]);
    await new Promise((r) => setTimeout(r, 5));
    await store.writeSharedQuestions('testNew', [{ ...Q1, answer: 'A newer answer' }]);

    const found = await store.readSharedQuestions([{ questionId: 'x', hash: await store.hashQuestion(Q1.questionText) }]);
    expect(found.x.answer).toBe('A newer answer');
    expect(found.x.testId).toBe('testNew');
  });

  it('finds nothing for a question nobody has answered', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeSharedQuestions('testA', [Q1]);
    const found = await store.readSharedQuestions([{ questionId: 'x', hash: await store.hashQuestion('Something nobody asked?') }]);
    expect(found).toEqual({});
  });

  it('skips a test id that cannot be used as a map key', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    expect(await store.writeSharedQuestions('bad.id/with/chars', [Q1])).toBe(0);
    expect(fake.store.size).toBe(0);
  });

  it('also keeps the per-test hashmap in sync', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    const res = await store.writeNestedAnswers('testA', [Q1, Q2]);
    expect(res.total).toBe(2);
    expect(res.shared).toBe(2);

    const testDoc = fake.store.get('tests/testA');
    expect(Object.keys(testDoc.answers).sort()).toEqual(['aaa111', 'bbb222']);
    expect(testDoc.answers.aaa111).toEqual({
      answer: 'Vitamin C deficiency',
      questionText: Q1.questionText,
      confidence: 'exact',
      updatedAt: expect.any(String),
    });
  });

  it('marks a weak answer as weak in both stores', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeNestedAnswers('testA', [{ ...Q1, confidence: 'weak' }]);
    expect(fake.store.get('tests/testA').answers.aaa111.confidence).toBe('weak');
    const h = await store.hashQuestion(Q1.questionText);
    expect(fake.snapshot(h).data().ans.testA.c).toBe('weak');
  });

  it('keeps earlier answers when a new chunk is written', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeNestedAnswers('testA', [Q1, Q2]);
    const res = await store.writeNestedAnswers('testA', [Q2]);
    expect(res.total).toBe(2);
    expect(Object.keys(fake.store.get('tests/testA').answers).sort()).toEqual(['aaa111', 'bbb222']);
  });
});

describe('question bank', () => {
  it('stores every question, answered or not', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    const stored = await store.writeQuestionBank('testA', [
      { questionId: 'aaa111', questionText: Q1.questionText, options: Q1.options },
      { questionId: 'bbb222', questionText: Q2.questionText, options: Q2.options },
    ]);
    expect(stored).toBe(2);

    const h1 = await store.hashQuestion(Q1.questionText);
    const data = fake.snapshot(h1).data();
    expect(data.q).toBe(Q1.questionText);
    expect(data.o.b).toBe('Vitamin C deficiency');
    // Present in the bank, but no answer recorded yet.
    expect(data.ans).toBeUndefined();
    expect(data.seen).toEqual({ testA: { t: expect.any(String) } });
  });

  it('does not invent an answer for a question nobody has answered', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeQuestionBank('testA', [{ questionId: 'a', questionText: 'An unanswered question?' }]);
    const found = await store.readSharedQuestions([
      { questionId: 'a', hash: await store.hashQuestion('An unanswered question?') },
    ]);
    expect(found).toEqual({});
  });

  it('records the answer later without losing the question fields', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeQuestionBank('testA', [{ questionId: 'aaa111', questionText: Q1.questionText, options: Q1.options }]);
    await store.writeSharedQuestions('testA', [Q1]);

    const h = await store.hashQuestion(Q1.questionText);
    const data = fake.snapshot(h).data();
    expect(data.q).toBe(Q1.questionText);
    expect(data.o.c).toBe('Vitamin D deficiency');
    expect(data.ans.testA.a).toBe('Vitamin C deficiency');
    expect(data.seen.testA).toBeTruthy();
  });

  it('tracks which tests contain a question', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    await store.writeQuestionBank('testA', [{ questionId: 'x', questionText: Q1.questionText }]);
    await store.writeQuestionBank('testB', [{ questionId: 'y', questionText: Q1.questionText }]);
    const h = await store.hashQuestion(Q1.questionText);
    expect(Object.keys(fake.snapshot(h).data().seen).sort()).toEqual(['testA', 'testB']);
  });

  it('ignores blank questions and unsafe test ids', async () => {
    const fake = makeFakeFirestore();
    const store = loadStore(fake);
    expect(await store.writeQuestionBank('testA', [{ questionId: 'x', questionText: '  ' }])).toBe(0);
    expect(await store.writeQuestionBank('bad.id', [{ questionId: 'x', questionText: 'Real question?' }])).toBe(0);
    expect(fake.store.size).toBe(0);
  });
});
