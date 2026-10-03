// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, tempDir, fakeEmbed, ROOT } = require('./helpers');

const { MemoryIndex, formatMemoryContext } = require(path.join(ROOT, 'src/main/memory/memory-index'));
const { chunkThread } = require(path.join(ROOT, 'src/main/memory/chunker'));
const { parseMemoryQuery } = require(path.join(ROOT, 'src/main/memory/query-parser'));
const { tokenize } = require(path.join(ROOT, 'src/main/memory/bm25'));
const corpus = require('./fixtures/memory-corpus');

async function makeIndex(dir = tempDir('cm-mem-'), embedTexts = fakeEmbed) {
  const mem = new MemoryIndex({ dir, embedTexts, embedModel: 'fake' });
  for (const source of ['chatgpt', 'claude', 'gemini']) mem.importThreads(corpus.filter((t) => t.source === source), source);
  await waitIdle(mem);
  return { mem, dir };
}

async function waitIdle(mem) {
  for (let i = 0; i < 200 && (mem.embedding || mem.countPending() > 0); i++) await new Promise((r) => setTimeout(r, 10));
}

const NOW = new Date('2026-09-26T12:00:00');

// ── Chunking ──
test('long conversations are split into passages with message ranges', () => {
  const thread = corpus.find((t) => t.id === 'claude-long');
  const chunks = chunkThread(thread);
  assert(chunks.length > 5, `only ${chunks.length} chunks`);
  const last = chunks[chunks.length - 1];
  assert(/Traefik/.test(last.text));
  assert.strictEqual(last.msgEnd, thread.messages.length - 1);
  for (let i = 1; i < chunks.length; i++) assert(chunks[i].msgStart >= chunks[i - 1].msgStart);
});

test('a single very long message is split, not truncated', () => {
  const text = 'Paragraph about topic. '.repeat(400);
  const chunks = chunkThread({ id: 't', title: 'x', messages: [{ role: 'assistant', text }] });
  assert(chunks.length >= 5);
  assert(chunks.every((c) => c.msgStart === 0 && c.msgEnd === 0));
  assert(chunks.reduce((n, c) => n + c.text.length, 0) > text.length * 0.9);
});

// ── Query parsing ──
test('date and source hints (English)', () => {
  const q = (s) => parseMemoryQuery(s, NOW);
  assert.deepStrictEqual(q('what did I ask Claude about postgres').sources, ['claude']);
  assert.deepStrictEqual(q('my chatgpt chats').sources, ['chatgpt']);
  const spring = q('what did we decide last spring').dateRange;
  assert.strictEqual(spring.from.getMonth(), 2);
  assert.strictEqual(spring.from.getFullYear(), 2026);
  const lastMonth = q('things from last month').dateRange;
  assert.strictEqual(lastMonth.from.getMonth(), 7);
  const march = q('in March').dateRange;
  assert.strictEqual(march.from.getFullYear(), 2026);
  const lastOct = q('last October').dateRange;
  assert.strictEqual(lastOct.from.getFullYear(), 2025);
  assert.strictEqual(q('in 2024').dateRange.from.getFullYear(), 2024);
  assert.strictEqual(q('the 2024 election').dateRange.soft, true, 'bare year is only a soft hint');
  assert.strictEqual(q('how do I bake bread').dateRange, null);
});

test('hint phrases are removed from the search text', () => {
  const q = (s) => parseMemoryQuery(s, NOW).text;
  assert.strictEqual(q('what did I ask Claude about salary last year?'), 'what did I ask about salary?');
  assert.strictEqual(q('python tips in ChatGPT'), 'python tips');
  assert.strictEqual(q('the 2024 election results'), 'the 2024 election results', 'soft year stays');
  assert.strictEqual(q('how may I help'), 'how may I help', '"may" alone is not a month');
  assert.strictEqual(parseMemoryQuery('how may I help', NOW).dateRange, null);
});

test('natural questions with hints still find the conversation', async () => {
  const { mem } = await makeIndex();
  // (fake embedder = shared words only, so use the conversation's own words; bge-m3 also matches synonyms — see memory.live.test.js)
  const r = await mem.search('what did I ask Claude about negotiating the job offer last year');
  assert.strictEqual(r.passages[0] && r.passages[0].threadId, 'claude-salary', JSON.stringify(r));
});

test('filter-only questions list that period\'s conversations', async () => {
  const { mem } = await makeIndex();
  const r = await mem.search('what did I talk about in 2025?');
  const ids = r.passages.map((p) => p.threadId);
  assert(ids.length >= 5, JSON.stringify(ids));
  assert(r.passages.every((p) => p.date.startsWith('2025')), JSON.stringify(r.passages.map((p) => p.date)));
  const claude = await mem.search('my Claude chats');
  assert(claude.passages.length > 0 && claude.passages.every((p) => p.source === 'claude'));
});

test('date and source hints (Arabic)', () => {
  const q = (s) => parseMemoryQuery(s, NOW);
  assert.strictEqual(q('ماذا سألت الشهر الماضي').dateRange.from.getMonth(), 7);
  assert.strictEqual(q('محادثاتي في العام الماضي').dateRange.from.getFullYear(), 2025);
  assert.deepStrictEqual(q('ماذا قال لي كلود عن بايثون').sources, ['claude']);
  assert.deepStrictEqual(q('في شات جي بي تي').sources, ['chatgpt']);
});

// ── Import & search ──
test('import is idempotent; changed conversations are updated', async () => {
  const { mem } = await makeIndex();
  const again = mem.importThreads(corpus.filter((t) => t.source === 'chatgpt'), 'chatgpt');
  assert.strictEqual(again.added, 0);
  assert.strictEqual(again.updated, 0);
  const changed = JSON.parse(JSON.stringify(corpus.find((t) => t.id === 'gpt-sleep')));
  changed.messages.push({ role: 'user', text: 'Thanks, that helped a lot with the 3am waking.' });
  const res = mem.importThreads([changed], 'chatgpt');
  assert.strictEqual(res.updated, 1);
});

test('finds the right passage, including deep inside a long conversation', async () => {
  const { mem } = await makeIndex();
  const r = await mem.search('which ingress controller Traefik did we decide');
  assert.strictEqual(r.passages[0].threadId, 'claude-long');
  assert(/Traefik/.test(r.passages[0].text));
  const db = await mem.search('postgres orders table index');
  assert.strictEqual(db.passages[0].threadId, 'gpt-postgres');
  assert(db.passages[0].date === '2025-04-12');
});

test('unrelated questions return no memories', async () => {
  const { mem } = await makeIndex();
  for (const q of ['capital of Australia', 'write a poem about the sea', 'explain quantum entanglement']) {
    const r = await mem.search(q);
    assert.strictEqual(r.passages.length, 0, `${q} → ${r.passages.map((p) => p.threadId)}`);
  }
});

test('Arabic search with normalisation (hamza, teh marbuta, definite article)', async () => {
  const { mem } = await makeIndex();
  const r = await mem.search('وصفه كبسه دجاج');
  assert.strictEqual(r.passages[0] && r.passages[0].threadId, 'gpt-arabic-food');
});

test('source filter from the query, and widening when it finds nothing', async () => {
  const { mem } = await makeIndex();
  const r = await mem.search('postgres in claude');
  assert(r.passages.every((p) => p.source === 'claude'), JSON.stringify(r.passages.map((p) => p.source)));
  const g = await mem.search('postgres orders index in gemini');
  assert(g.passages.length > 0 && /other sources/.test(g.note || ''), JSON.stringify(g));
});

test('date filter from the query', async () => {
  const { mem } = await makeIndex();
  const r = await mem.search('sourdough starter smells in 2024');
  assert.strictEqual(r.passages[0].threadId, 'gpt-recipe');
  const none = await mem.search('sourdough starter smells in 2021');
  assert(/closest matches from other dates/.test(none.note || ''), JSON.stringify(none.note));
});

test('max two passages per conversation; current chat excluded', async () => {
  const { mem } = await makeIndex();
  const r = await mem.search('Kubernetes networking step details trade-offs', { limit: 10 });
  const fromLong = r.passages.filter((p) => p.threadId === 'claude-long');
  assert(fromLong.length <= 2);
  const ex = await mem.search('Kubernetes networking step details trade-offs', { excludeThreadIds: ['claude-long'] });
  assert(!ex.passages.some((p) => p.threadId === 'claude-long'));
});

test('in-app chats are searchable and replaced on sync', async () => {
  const { mem } = await makeIndex();
  mem.syncAppSessions([{ id: 's_1', title: 'Guitar practice', createdAt: Date.now(), messages: [
    { role: 'user', text: 'How do I practice barre chords on guitar?', timestamp: Date.now() },
    { role: 'assistant', text: 'Start with the F barre chord, press near the fret, 5 minutes daily.', timestamp: Date.now() }
  ] }]);
  await waitIdle(mem);
  const r = await mem.search('barre chords guitar practice');
  assert.strictEqual(r.passages[0].threadId, 's_1');
  assert.strictEqual(r.passages[0].source, 'app');
  mem.syncAppSessions([]);
  assert.strictEqual((await mem.search('barre chords guitar practice')).passages.length, 0);
});

test('persists to disk: a new instance reuses stored vectors (no re-embedding)', async () => {
  const { mem, dir } = await makeIndex();
  mem.saveVectors();
  let calls = 0;
  const counting = (texts) => { calls += texts.length; return fakeEmbed(texts); };
  const again = new MemoryIndex({ dir, embedTexts: counting, embedModel: 'fake' });
  again.load();
  assert.strictEqual(again.countPending(), 0);
  assert.strictEqual(again.stats().threads, corpus.length);
  const r = await again.search('postgres orders table index');
  assert.strictEqual(r.passages[0].threadId, 'gpt-postgres');
  assert.strictEqual(calls, 1, 'only the query itself is embedded');
});

test('deleting a source removes its conversations and garbage-collects vectors', async () => {
  const { mem, dir } = await makeIndex();
  const before = mem.vectors.size;
  const removed = mem.deleteSource('claude');
  assert.strictEqual(removed, corpus.filter((t) => t.source === 'claude').length);
  assert(mem.vectors.size < before);
  assert.strictEqual((await mem.search('Zustand react cart re-render')).passages.length, 0);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'vectors.json'), 'utf8'));
  assert.strictEqual(fs.statSync(path.join(dir, 'vectors.bin')).size, meta.keys.length * meta.dim);
});

test('keyword search works before embeddings exist (Ollama down)', async () => {
  const failing = () => Promise.reject(new Error('connect ECONNREFUSED'));
  const mem = new MemoryIndex({ dir: tempDir('cm-mem-'), embedTexts: failing, embedModel: 'fake' });
  mem.importThreads(corpus.filter((t) => t.source === 'chatgpt'), 'chatgpt');
  await waitIdle(mem);
  assert(mem.stats().error && /ECONNREFUSED/.test(mem.stats().error));
  const r = await mem.search('docker compose port 5432 allocated');
  assert.strictEqual(r.passages[0].threadId, 'gpt-docker');
});

test('migrates the old whole-thread store once', async () => {
  const userData = tempDir('cm-legacy-');
  fs.mkdirSync(path.join(userData, 'history'), { recursive: true });
  fs.mkdirSync(path.join(userData, 'embeddings'), { recursive: true });
  const old = corpus.slice(0, 3).map((t) => ({ ...t, fullText: 'x', embedding: [0.1, 0.2] }));
  fs.writeFileSync(path.join(userData, 'history', 'threads.json'), JSON.stringify(old));
  fs.writeFileSync(path.join(userData, 'embeddings', 'cache.json'), '{}');
  const mem = new MemoryIndex({ dir: path.join(userData, 'memory'), embedTexts: fakeEmbed, embedModel: 'fake', legacyDir: userData });
  mem.load();
  assert.strictEqual(mem.stats().threads, 3);
  assert(!fs.existsSync(path.join(userData, 'embeddings')));
  assert(fs.existsSync(path.join(userData, 'history', 'threads.backup.json')));
  assert(!fs.readFileSync(path.join(userData, 'history', 'threads.backup.json'), 'utf8').includes('embedding'));
});

test('memory prompt block has citations and respects the size budget', () => {
  const passages = [1, 2, 3].map((i) => ({ sourceName: 'ChatGPT', title: `T${i}`, date: '2025-01-0' + i, text: 'x'.repeat(2000) }));
  const block = formatMemoryContext(passages, { maxChars: 3000 });
  assert(/\[M1\] ChatGPT · "T1" · 2025-01-01/.test(block));
  assert(block.length < 3800, `block too long: ${block.length}`);
  assert.strictEqual(formatMemoryContext([]), '');
});

done();
