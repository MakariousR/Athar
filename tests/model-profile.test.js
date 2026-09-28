// Model profiles: helper level, context size per model and computer, thinking models.
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');
const mp = require(path.join(ROOT, 'src/main/ollama/model-profile'));

const GB = 1024 ** 3;
// Shapes of Ollama's /api/show answer (only the fields used)
const qwen7b = {
  capabilities: ['completion', 'tools', 'insert'],
  details: { parameter_size: '7.6B' },
  model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768, 'qwen2.block_count': 28,
    'qwen2.attention.head_count': 28, 'qwen2.attention.head_count_kv': 4, 'qwen2.embedding_length': 3584 }
};
const qwen14b = {
  capabilities: ['completion', 'tools'],
  details: { parameter_size: '14.8B' },
  model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768, 'qwen2.block_count': 48,
    'qwen2.attention.head_count': 40, 'qwen2.attention.head_count_kv': 8, 'qwen2.embedding_length': 5120 }
};
const thinker = { capabilities: ['completion', 'tools', 'thinking'], details: { parameter_size: '8.2B' }, model_info: {} };
const tiny = { capabilities: ['completion'], details: { parameter_size: '1B' }, model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 8192 } };

test('size and architecture are read from Ollama\'s model description', () => {
  assert.strictEqual(mp.parameterBillions(qwen7b), 7.6);
  assert.strictEqual(mp.parameterBillions({ details: { parameter_size: '500M' } }), 0.5);
  assert.strictEqual(mp.parameterBillions({ model_info: { 'general.parameter_count': 3.2e9 } }), 3.2);
  assert.strictEqual(mp.parameterBillions({}), null);
  assert.strictEqual(mp.kvBytesPerToken(mp.architecture(qwen7b), 7.6), 2 * 28 * 4 * 128 * 2, 'qwen2.5-7B: ~57 KB per token');
});

test('helper level: small models guided, ~14B and up light; override with ATHAR_ASSIST', () => {
  assert.strictEqual(mp.chooseLevel(7.6, ''), 'guided');
  assert.strictEqual(mp.chooseLevel(14.8, ''), 'light');
  assert.strictEqual(mp.chooseLevel(null, ''), 'guided', 'unknown size: guided');
  assert.strictEqual(mp.chooseLevel(7.6, 'light'), 'light');
  assert.strictEqual(mp.chooseLevel(70, 'guided'), 'guided');
});

test('context size fits the computer: 7B in 16 GB keeps 16K; bigger models get less; never more than the model supports', () => {
  const p7 = mp.buildProfile(qwen7b, 4.7 * GB, { totalMemory: 16 * GB, override: '', assistOverride: '' });
  assert.strictEqual(p7.numCtx, 16384, 'your PC with qwen2.5-coder:7b: unchanged');
  assert.strictEqual(p7.level, 'guided');
  assert.strictEqual(p7.tools, true);
  const p14 = mp.buildProfile(qwen14b, 9 * GB, { totalMemory: 16 * GB, override: '', assistOverride: '' });
  assert(p14.numCtx < 16384, `14B in 16 GB: ${p14.numCtx}`);
  assert.strictEqual(p14.level, 'light');
  const p14big = mp.buildProfile(qwen14b, 9 * GB, { totalMemory: 64 * GB, override: '', assistOverride: '' });
  assert.strictEqual(p14big.numCtx, 16384, '14B with 64 GB: full size');
  assert.strictEqual(mp.buildProfile(tiny, 0.8 * GB, { totalMemory: 64 * GB, override: '' }).numCtx, 8192, 'capped at the model\'s own maximum');
  assert.strictEqual(mp.chooseNumCtx({ sizeBytes: 4 * GB, kvPerToken: 60000, totalMemory: 16 * GB, override: '6000' }), 6000, 'OLLAMA_NUM_CTX wins');
});

test('capabilities: tools / vision / thinking; unknown (older Ollama) means "try tools"', () => {
  const t = mp.buildProfile(thinker, 5 * GB, { totalMemory: 16 * GB, override: '' });
  assert(t.thinking && t.tools && !t.vision);
  const unknown = mp.buildProfile(null, null, { totalMemory: 16 * GB, override: '' });
  assert.strictEqual(unknown.tools, true);
  assert.strictEqual(unknown.capabilities, null);
});

test('a thinking model\'s reasoning is removed from finished text', () => {
  assert.strictEqual(mp.stripThinking('<think>\nThe user wants X. Let me…\n</think>\n\nThe answer is 42.'), 'The answer is 42.');
  assert.strictEqual(mp.stripThinking('reasoning without an opening tag…</think>\nAnswer.'), 'Answer.');
  assert.strictEqual(mp.stripThinking('<think>cut off mid-thought'), '');
  assert.strictEqual(mp.stripThinking('Plain answer with <b>html</b>.'), 'Plain answer with <b>html</b>.');
});

test('streaming: reasoning is held back even when tags are split across chunks', () => {
  const run = (chunks) => {
    const shown = []; let thinking = 0; let discarded = 0;
    const f = mp.createThinkFilter({ onText: (t) => shown.push(t), onThinking: () => thinking++, onDiscard: () => { discarded++; shown.length = 0; } });
    chunks.forEach((c) => f.push(c));
    f.flush();
    return { text: shown.join(''), thinking, discarded };
  };
  let r = run(['<thi', 'nk>Let me think', ' about it</th', 'ink>\n\nHello', ' world']);
  assert.strictEqual(r.text, 'Hello world');
  assert.strictEqual(r.thinking, 1);
  r = run(['Plain ', 'answer with a < sign and <b>bold</b>', '.']);
  assert.strictEqual(r.text, 'Plain answer with a < sign and <b>bold</b>.');
  r = run(['first I reason…', ' still reasoning', '</think>', 'The answer.']);
  assert.strictEqual(r.text, 'The answer.');
  assert.strictEqual(r.discarded, 1);
  r = run(['Answer <', 'think>hidden</think> more']);
  assert.strictEqual(r.text, 'Answer more');
});

done();
