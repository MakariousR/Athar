// Needs Ollama running with bge-m3. Run with: npm run test:live
// Real-model checks of the relevance gate: right conversation at rank 1 for
// related questions (incl. English ↔ Arabic), nothing for unrelated ones.
const path = require('path');
const assert = require('assert');
const { test, done, tempDir, ROOT } = require('./helpers');
const { MemoryIndex } = require(path.join(ROOT, 'src/main/memory/memory-index'));
const corpus = require('./fixtures/memory-corpus');

async function embedTexts(texts) {
  const res = await fetch('http://127.0.0.1:11434/api/embed', { method: 'POST', body: JSON.stringify({ model: 'bge-m3', input: texts }) });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
  return (await res.json()).embeddings;
}

let mem;
async function index() {
  if (mem) return mem;
  mem = new MemoryIndex({ dir: tempDir('cm-live-'), embedTexts, embedModel: 'bge-m3' });
  for (const source of ['chatgpt', 'claude', 'gemini']) mem.importThreads(corpus.filter((t) => t.source === source), source);
  for (let i = 0; i < 600 && (mem.embedding || mem.countPending() > 0); i++) await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(mem.countPending(), 0, `embedding incomplete: ${mem.stats().error}`);
  return mem;
}

const related = [
  ['which database did we pick for the bakery orders', 'gpt-postgres'],
  ['what did I decide about the database design', 'gpt-postgres'],
  ['how to stop the cart re-rendering in react', 'claude-react'],
  ['كيف أبدأ تعلم بايثون', 'claude-arabic'],
  ['how do I learn python from scratch', 'claude-arabic'],
  ['which ingress controller did we choose', 'claude-long'],
  ['how to cook chicken kabsa', 'gpt-arabic-food'],
  ['how much to save for taxes as a freelancer', 'gpt-taxes'],
  // natural phrasing with source + date hints (hint words removed before matching)
  ['what did I ask Claude about salary last year', 'claude-salary'],
  ['ماذا سألت كلود عن تعلم البرمجة', 'claude-arabic']
];
for (const [q, expected] of related) {
  test(`related: "${q}" → ${expected}`, async () => {
    const r = await (await index()).search(q);
    assert.strictEqual(r.passages[0] && r.passages[0].threadId, expected, JSON.stringify(r.passages.map((p) => [p.threadId, p.score])));
  });
}

for (const q of ['what is the capital of Australia', 'explain quantum entanglement simply', 'write a poem about the sea', 'ما هي عاصمة أستراليا']) {
  test(`unrelated: "${q}" → no memories`, async () => {
    const r = await (await index()).search(q);
    assert.strictEqual(r.passages.length, 0, JSON.stringify(r.passages.map((p) => [p.threadId, p.score])));
  });
}

done();
