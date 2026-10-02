const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, tempDir, fakeEmbed, ROOT } = require('./helpers');

const { MemoryIndex } = require(path.join(ROOT, 'src/main/memory/memory-index'));
const corpus = require('./fixtures/memory-corpus');

async function waitIdle(mem) {
  for (let i = 0; i < 200 && (mem.embedding || mem.countPending() > 0); i++) await new Promise((r) => setTimeout(r, 10));
}
async function makeIndex(dir = tempDir('athar-del-')) {
  const mem = new MemoryIndex({ dir, embedTexts: fakeEmbed, embedModel: 'fake' });
  for (const source of ['chatgpt', 'claude', 'gemini']) mem.importThreads(corpus.filter((t) => t.source === source), source);
  await waitIdle(mem);
  return { mem, dir };
}
const reopen = (dir) => new MemoryIndex({ dir, embedTexts: fakeEmbed, embedModel: 'fake' });
const ids = (mem) => mem.allThreads().map((t) => t.id).sort();

test('deleting chosen conversations removes them from the list, search and saved file', async () => {
  const { mem, dir } = await makeIndex();
  const before = mem.allThreads().length;
  assert.strictEqual(mem.deleteThreads(['gpt-docker', 'claude-react', 'not-there']), 2);
  assert.strictEqual(mem.allThreads().length, before - 2);
  assert(!ids(mem).includes('gpt-docker'));
  const { passages } = await mem.search('docker compose port already allocated');
  assert(!passages.some((p) => p.threadId === 'gpt-docker'), 'no longer found by search');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'threads.json'), 'utf8'));
  assert(saved.threads.every((t) => t.id !== 'gpt-docker'), 'gone from the saved file (only its id is kept, to skip it in later imports)');
  const again = reopen(dir);
  assert.deepStrictEqual(ids(again), ids(mem), 'still gone after a restart');
});

test('a deleted conversation stays out when a newer export is imported', async () => {
  const { mem, dir } = await makeIndex();
  mem.deleteThreads(['gpt-docker']);
  const result = mem.importThreads(corpus.filter((t) => t.source === 'chatgpt'), 'chatgpt');
  assert.strictEqual(result.forgotten, 1);
  assert(!ids(mem).includes('gpt-docker'));
  // ...also after a restart
  const again = reopen(dir);
  assert.strictEqual(again.importThreads(corpus.filter((t) => t.source === 'chatgpt'), 'chatgpt').forgotten, 1);
});

test('removing a whole source starts it over: re-importing brings everything back, other sources keep their deletions', async () => {
  const { mem } = await makeIndex();
  mem.deleteThreads(['gpt-docker', 'claude-react']);
  mem.deleteSource('chatgpt');
  assert(!mem.allThreads().some((t) => t.source === 'chatgpt'));
  mem.importThreads(corpus.filter((t) => t.source === 'chatgpt'), 'chatgpt');
  assert(ids(mem).includes('gpt-docker'), 'the ChatGPT one is back');
  assert.strictEqual(mem.importThreads(corpus.filter((t) => t.source === 'claude'), 'claude').forgotten, 1, 'the Claude one stays deleted');
});

test('clear all imported history: everything imported goes, chats made in Athar stay, importing again works', async () => {
  const { mem, dir } = await makeIndex();
  mem.syncAppSessions([{ id: 'app-1', title: 'Garden', messages: [{ role: 'user', text: 'tomatoes?' }, { role: 'assistant', text: 'Cherry ones.' }] }]);
  mem.deleteThreads(['gpt-docker']);
  const total = corpus.length;
  assert.strictEqual(mem.clearImported(), total - 1);
  assert.deepStrictEqual(ids(mem), ['app-1']);
  assert.deepStrictEqual(mem.stats().sources, { app: { name: 'This app', count: 1, lastImport: null } });
  assert.strictEqual(reopen(dir).allThreads().length, 0, 'nothing imported after a restart');
  // A fresh start: even the one deleted before comes back
  for (const source of ['chatgpt', 'claude', 'gemini']) mem.importThreads(corpus.filter((t) => t.source === source), source);
  assert(ids(mem).includes('gpt-docker'));
});

test('deleting the last conversation of a source removes that source from the summary', async () => {
  const { mem } = await makeIndex();
  const gemini = corpus.filter((t) => t.source === 'gemini').map((t) => t.id);
  mem.deleteThreads(gemini);
  assert(!('gemini' in mem.stats().sources));
});

done();
