const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');

const catalog = new Function(`${fs.readFileSync(path.join(ROOT, 'src/renderer/model-catalog.js'), 'utf8')}; return MODEL_CATALOG;`)();
const chat = fs.readFileSync(path.join(ROOT, 'src/renderer/chat.js'), 'utf8');
const { parseAdapters } = require(path.join(ROOT, 'src/main/hardware'));
const byName = (n) => catalog.find((m) => m.name === n || (m.aliases || []).includes(n));

test('the whole Ollama library: hundreds of models, every size, each with what it needs', () => {
  assert(catalog.length >= 300, `only ${catalog.length} models`);
  assert.strictEqual(new Set(catalog.map((m) => m.name)).size, catalog.length, 'no duplicates');
  for (const m of catalog) {
    assert(m.name && m.label && m.desc, `${m.name}: name, label and description`);
    assert(m.sizeBytes > 1e7, `${m.name}: download size`);
    assert(m.vram > 0 && m.ram > 0 && m.ramMin > 0 && m.ramMin <= m.ram, `${m.name}: requirements ${m.vram}/${m.ram}/${m.ramMin}`);
    assert(m.ram * 0.75 * 1024 ** 3 > m.sizeBytes * 0.9, `${m.name}: RAM covers the model`);
    assert(typeof m.tools === 'boolean' && typeof m.vision === 'boolean' && typeof m.thinking === 'boolean', m.name);
  }
  for (let i = 1; i < catalog.length; i++) assert(catalog[i].sizeBytes >= catalog[i - 1].sizeBytes, 'smallest first');
  // Every size of a big family
  assert.deepStrictEqual(catalog.filter((m) => m.family === 'qwen3').map((m) => m.name),
    ['qwen3:0.6b', 'qwen3:1.7b', 'qwen3:4b', 'qwen3:8b', 'qwen3:14b', 'qwen3:30b', 'qwen3:32b', 'qwen3:235b']);
});

test('requirements match the architecture (known models)', () => {
  // qwen2.5:7b: 4.7 GB file, 28 layers × 4 KV heads → about 6 GB of graphics memory at 16K
  const q = byName('qwen2.5:7b');
  assert(q.vram >= 5.5 && q.vram <= 6.5, `qwen2.5:7b GPU ${q.vram}`);
  // qwen3:8b caches 2.5× more per token than qwen2.5:7b: more memory for the same size class
  assert(byName('qwen3:8b').vram > q.vram + 1.5);
  // A mixture of experts still needs memory for all its experts
  const moe = byName('qwen3:30b');
  assert(moe.experts && moe.vram > 18, `qwen3:30b ${JSON.stringify(moe.experts)} ${moe.vram}`);
  assert(byName('deepseek-r1:671b').ram > 400);
});

test('capabilities come from the models themselves', () => {
  assert(byName('qwen2.5:7b').tools && !byName('qwen2.5:7b').vision);
  assert(byName('qwen3:8b').thinking);
  assert(byName('qwen2.5vl:7b').vision && byName('llama3.2-vision:11b').vision && byName('gemma3:4b').vision);
  assert(!byName('gemma3:1b').vision, 'the 1B Gemma 3 is text only');
  assert(!byName('gemma3:4b').tools, 'Gemma 3 has no tool calling in Ollama');
});

test('a family name alone is its default size ("mistral" = mistral:7b)', () => {
  assert.strictEqual(byName('mistral').name, 'mistral:7b');
  assert.strictEqual(byName('phi4-mini').name, 'phi4-mini:3.8b');
  assert.strictEqual(byName('qwen2.5').name, 'qwen2.5:7b');
});

test('the default and every recommended model are in the catalog, with tools', () => {
  const order = JSON.parse(chat.match(/const RECOMMENDED_ORDER = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  const def = chat.match(/const CHAT_MODEL\s*=\s*'([^']+)'/)[1];
  for (const n of [def, ...order]) assert(byName(n) && byName(n).tools, `${n} missing or without tools`);
});

test('graphics cards from the Windows registry: dedicated memory only', () => {
  const lines = [
    'Intel(R) Iris(R) Xe Graphics||0',
    'NVIDIA GeForce RTX 4050 Laptop GPU|6439305216|4293918720',
    'Microsoft Basic Display Adapter||0',
    'AMD Radeon RX 580||4294967295',
    'NVIDIA GeForce GT 710||1073741824'
  ].join('\r\n');
  assert.deepStrictEqual(parseAdapters(lines), [
    { name: 'NVIDIA GeForce RTX 4050 Laptop GPU', vramGB: 6 },
    { name: 'AMD Radeon RX 580', vramGB: 4 },
    { name: 'NVIDIA GeForce GT 710', vramGB: 1 }
  ]);
  assert.deepStrictEqual(parseAdapters(''), []);
});

done();
