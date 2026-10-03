// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
// Asking about one specific conversation, and deleting a chat from memory.
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { test, done, stubElectron, tempDir, fakeEmbed, ROOT } = require('./helpers');

stubElectron();
const { MemoryIndex } = require(path.join(ROOT, 'src/main/memory/memory-index'));
const corpus = require('./fixtures/memory-corpus');

async function waitIdle(mem) {
  for (let i = 0; i < 300 && (mem.embedding || mem.countPending() > 0); i++) await new Promise((r) => setTimeout(r, 10));
}

async function makeIndex(extraThreads = []) {
  const mem = new MemoryIndex({ dir: tempDir('athar-focus-'), embedTexts: fakeEmbed, embedModel: 'fake' });
  for (const source of ['chatgpt', 'claude', 'gemini']) {
    mem.importThreads([...corpus, ...extraThreads].filter((t) => t.source === source), source);
  }
  await waitIdle(mem);
  return mem;
}

const only = (r, id) => r.passages.length > 0 && r.passages.every((p) => p.threadId === id);

// ── One conversation, by name ──
test('a question naming a chat gets only that chat, in order', async () => {
  const mem = await makeIndex();
  const r = await mem.search('summarize my chat about the bakery database');
  assert(r.focus && r.focus.threadId === 'gpt-postgres', JSON.stringify(r.focus));
  assert(only(r, 'gpt-postgres'), r.passages.map((p) => p.title).join(', '));
  assert(/ONE conversation/.test(r.note) && /whole conversation/.test(r.note), r.note);
  for (let i = 1; i < r.passages.length; i++) assert(r.passages[i].msgStart >= r.passages[i - 1].msgStart);
});

test('a long chat gives its beginning, its end and the relevant parts', async () => {
  const messages = [];
  for (let i = 1; i <= 40; i++) {
    messages.push({ role: 'user', text: `Part ${i} of the garden irrigation plan: which pipes and timers for bed ${i}?` });
    messages.push({ role: 'assistant', text: `For bed ${i}, use drip lines. ${'Details about flow rates, pressure and spacing. '.repeat(12)}` });
  }
  messages.push({ role: 'user', text: 'Final decision on the controller?' });
  messages.push({ role: 'assistant', text: 'We chose the Rachio smart controller for all beds.' });
  const thread = { id: 'long-garden', title: 'Garden irrigation plan', source: 'claude', createTime: 1770000000, messages };
  const mem = await makeIndex([thread]);
  const r = await mem.search('what did we decide in the garden irrigation plan chat?');
  assert(r.focus && r.focus.threadId === 'long-garden', JSON.stringify(r.focus));
  assert(only(r, 'long-garden'));
  assert.strictEqual(r.passages[0].msgStart, 0, 'starts at the beginning');
  assert.strictEqual(r.passages[r.passages.length - 1].msgEnd, thread.messages.length - 1, 'includes the end');
  assert(r.passages.some((p) => /Rachio/.test(p.text)));
  assert(r.passages.length <= 8 && r.passages.reduce((n, p) => n + p.text.length, 0) <= 12000, 'fits the memory block');
  assert(/It is long/.test(r.note));
});

test('Arabic: "ماذا قلنا في محادثة الكبسة؟" and "لخص محادثة الكبسة"', async () => {
  const mem = await makeIndex();
  for (const q of ['ماذا قلنا في محادثة الكبسة؟', 'لخص محادثة الكبسة']) {
    const r = await mem.search(q);
    assert(r.focus && r.focus.threadId === 'gpt-arabic-food', `${q}: ${JSON.stringify(r.focus)}`);
    assert(only(r, 'gpt-arabic-food'));
  }
});

test('"summarize my last chat" / "المحادثة السابقة" → the most recent one, never the current chat', async () => {
  const mem = await makeIndex();
  const newest = mem.allThreads().reduce((a, b) => ((b.updateTime || 0) > (a.updateTime || 0) ? b : a));
  for (const q of ['summarize my last chat', 'what did we talk about in the previous conversation?', 'لخص المحادثة السابقة']) {
    const r = await mem.search(q);
    assert(r.focus && r.focus.threadId === newest.id, `${q}: ${JSON.stringify(r.focus)}`);
  }
  const r = await mem.search('summarize my last chat', { excludeThreadIds: [newest.id] });
  assert(r.focus && r.focus.threadId !== newest.id);
});

test('"my last Claude chat" respects the source', async () => {
  const mem = await makeIndex();
  const r = await mem.search('summarize my last Claude chat');
  assert(r.focus, 'no focus');
  assert.strictEqual(mem.getThread(r.focus.threadId).source, 'claude');
});

test('questions that are not about one chat search everything as before', async () => {
  const mem = await makeIndex();
  for (const q of ['how do I fix my docker compose error', 'tips for better sleep', 'what is 17 times 23']) {
    const r = await mem.search(q);
    assert(!r.focus, `${q} focused on ${r.focus && r.focus.title}`);
  }
});

test('one shared word is not enough when several chats have it in their title', async () => {
  const extra = [
    { id: 'py-1', title: 'Python decorators', source: 'chatgpt', createTime: 1780000000, messages: [{ role: 'user', text: 'explain decorators' }, { role: 'assistant', text: 'A decorator wraps a function.' }] },
    { id: 'py-2', title: 'Python packaging', source: 'chatgpt', createTime: 1780000100, messages: [{ role: 'user', text: 'how to publish a package' }, { role: 'assistant', text: 'Use a pyproject.toml and twine.' }] }
  ];
  const mem = await makeIndex(extra);
  const vague = await mem.search('what did we say in the python chat?');
  assert(!vague.focus, `picked ${vague.focus && vague.focus.title}`);
  const clear = await mem.search('what did we say in the python packaging chat?');
  assert(clear.focus && clear.focus.threadId === 'py-2');
});

// ── Asking for a list of conversations ──
test('"what were the main chats titles between me and claude" lists every Claude chat once', async () => {
  const mem = await makeIndex();
  const claudeIds = corpus.filter((t) => t.source === 'claude').map((t) => t.id).sort();
  for (const q of ['tell me what were the main chats titles between me and claude', 'ما هي عناوين محادثاتي مع كلود؟', 'list my chats with Claude']) {
    const r = await mem.search(q);
    assert(r.list, `${q}: not a list`);
    assert.deepStrictEqual(r.passages.map((p) => p.threadId).sort(), claudeIds, q);
    assert(r.note.includes(`TOTAL: ${claudeIds.length}`), r.note);
  }
});

test('"how many chats do I have with ChatGPT?" / "كم محادثة عندي مع شات جي بي تي؟" give the total', async () => {
  const mem = await makeIndex();
  const n = corpus.filter((t) => t.source === 'chatgpt').length;
  for (const q of ['how many chats do I have with ChatGPT?', 'كم محادثة عندي مع شات جي بي تي؟']) {
    const r = await mem.search(q);
    assert(r.list && r.note.includes(`TOTAL: ${n} `), `${q}: ${r.note}`);
    assert(r.passages.every((p) => p.source === 'chatgpt'));
  }
});

test('many ways of asking for your chats, or how many, get the full list and the total', async () => {
  const mem = await makeIndex();
  const n = corpus.filter((t) => t.source === 'chatgpt').length;
  for (const q of ['what chats do I have with chatgpt?', 'what are the chats I imported from ChatGPT?', 'how many ChatGPT conversations did I import?',
    'which topics did I talk about with ChatGPT?', 'كم عدد محادثاتي مع شات جي بي تي؟', 'اعرض محادثاتي مع شات جي بي تي',
    'ما المواضيع التي تحدثت عنها مع شات جي بي تي؟']) {
    const r = await mem.search(q);
    assert(r.list && r.note.includes(`TOTAL: ${n} `), `${q}: ${r.note}`);
  }
  const all = await mem.search('what conversations do you remember?');
  assert(all.list && all.note.includes(`TOTAL: ${corpus.length} `), all.note);
});

test('"which of my conversations were about X" lists each matching chat once', async () => {
  const mem = await makeIndex();
  const r = await mem.search('which of my conversations were about kubernetes?');
  assert(r.list && r.passages.length > 0);
  assert.strictEqual(new Set(r.passages.map((p) => p.threadId)).size, r.passages.length, 'a chat listed twice');
  assert.strictEqual(r.passages[0].threadId, 'claude-long');
});

test('ordinary questions are not treated as a list request', async () => {
  const mem = await makeIndex();
  for (const q of ['what did I say about work in our chats?', 'give me a list of numbers in python', 'summarize my chat about the bakery database']) {
    assert(!(await mem.search(q)).list, q);
  }
});

// ── Deleting a chat in the app removes it from memory ──
test('deleting a chat (the real delete handler) removes it from memory search and stored vectors', async () => {
  const electron = require('electron');
  const handlers = new Map();
  electron.ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
  electron.BrowserWindow = { getAllWindows: () => [] };
  const ollama = require(path.join(ROOT, 'src/main/ollama/ollama-client'));
  ollama.embedTexts = fakeEmbed; // no Ollama needed
  const store = require(path.join(ROOT, 'src/main/store/chat-store'));
  const { getMemory } = require(path.join(ROOT, 'src/main/memory'));
  require(path.join(ROOT, 'src/main/ipc-handlers')).registerIpcHandlers();
  const event = {
    senderFrame: { url: pathToFileURL(path.join(ROOT, 'src', 'renderer', 'index.html')).href },
    sender: { send() {}, isDestroyed: () => false }
  };
  const call = (channel, ...args) => handlers.get(channel)(event, ...args);

  const session = store.createSession();
  store.appendMessage(session.id, 'user', 'Where should I store the zanzibarquokka inventory?');
  store.appendMessage(session.id, 'assistant', 'Keep the zanzibarquokka inventory in a spreadsheet.');
  const memory = getMemory();
  memory.syncAppSessions(store.loadSessions());
  await waitIdle(memory);

  const before = await call('memory:search', 'zanzibarquokka inventory');
  assert(before.success !== false, JSON.stringify(before));
  const found = (before.passages || before.results || []).filter((p) => p.threadId === session.id);
  assert(found.length > 0, 'the chat should be in memory before deleting');
  const keys = memory.segments.app.chunks.filter((c) => c.threadId === session.id).map((c) => c.key);
  assert(keys.length > 0 && keys.every((k) => memory.vectors.has(k)));

  memory.pause(); // as while an answer is being written: indexing paused
  const res = await call('chat:delete', session.id);
  assert(res.success, JSON.stringify(res));

  const after = await call('memory:search', 'zanzibarquokka inventory');
  assert(!(after.passages || after.results || []).some((p) => p.threadId === session.id), 'still found after delete');
  assert.strictEqual(memory.getThread(session.id), null);
  assert(!(await memory.search('summarize my last chat')).passages.some((p) => p.threadId === session.id));
  assert(keys.every((k) => !memory.vectors.has(k)), 'vectors of the deleted chat were kept');

  // and on disk
  const { VectorStore } = require(path.join(ROOT, 'src/main/memory/vector-store'));
  const onDisk = new VectorStore(memory.dir, memory.embedModel);
  onDisk.load();
  assert(keys.every((k) => !onDisk.has(k)), 'vectors of the deleted chat are still on disk');
  memory.resume();
});

done();
