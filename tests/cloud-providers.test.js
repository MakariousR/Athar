const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, ROOT } = require('./helpers');

// Electron's safeStorage, faked: "encrypts" by tagging (the real one uses Windows DPAPI)
const userData = stubElectron();
require.cache[require.resolve('electron', { paths: [ROOT] })].exports.safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
};
const cloud = require(path.join(ROOT, 'src/main/cloud/providers'));
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));

// What each provider's model list returns (trimmed), as of 2026
const GEMINI = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'], ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
  ['gemini-3.5-flash', 'Gemini 3.5 Flash'], ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'], ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
  ['gemini-2.5-flash-preview-tts', 'TTS'], ['gemini-2.5-flash-native-audio-preview-12-2025', 'Audio'], ['gemini-3.8-live', 'Live'],
  ['gemini-2.5-flash-image', 'Image'], ['gemma-4-27b-it', 'Gemma 4 27B']
].map(([id, displayName]) => ({ name: `models/${id}`, displayName, supportedGenerationMethods: ['generateContent', 'countTokens'] }))
  .concat([{ name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }]);
const OPENAI = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'o4-mini', 'o3',
  'gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'gpt-4o-mini-tts', 'gpt-4o-transcribe',
  'gpt-image-1', 'text-embedding-3-small', 'omni-moderation-latest', 'dall-e-3', 'whisper-1', 'tts-1', 'gpt-4o-search-preview', 'davinci-002']
  .map((id, i) => ({ id, created: 1000 - i, object: 'model' }));
const ANTHROPIC = [
  ['claude-haiku-4-5', 'Claude Haiku 4.5', '2025-10-01'], ['claude-sonnet-4-5', 'Claude Sonnet 4.5', '2025-09-29'],
  ['claude-opus-4-1', 'Claude Opus 4.1', '2025-08-05'], ['claude-sonnet-4-0', 'Claude Sonnet 4', '2025-05-22']
].map(([id, display_name, created_at]) => ({ id, display_name, created_at: `${created_at}T00:00:00Z`, type: 'model' }));

/** A fake fetch for the three model lists; `ok: false` answers like a bad key. */
function fakeFetch(calls, ok = true) {
  return async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    if (!ok) return { ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided.', type: 'authentication_error' } }) };
    const body = /googleapis/.test(url) ? { models: GEMINI } : /openai/.test(url) ? { data: OPENAI } : { data: ANTHROPIC };
    return { ok: true, status: 200, json: async () => body };
  };
}
const KEYS = { gemini: 'AIzaSyD-test_key_1234567890abcdefghij', openai: 'sk-proj-test_key_1234567890abcdefghij', anthropic: 'sk-ant-api03-test_key_1234567890abcdef' };

test('model names: "<provider>/<id>"; local models are not cloud models', () => {
  assert.deepStrictEqual(['gemini/gemini-2.5-flash', 'openai/gpt-5-mini', 'anthropic/claude-sonnet-4-5', 'qwen2.5:7b', 'hf.co/x/y'].map(cloud.providerOf),
    ['gemini', 'openai', 'anthropic', null, null]);
  assert.strictEqual(cloud.modelId('openai/gpt-5-mini'), 'gpt-5-mini');
  assert.strictEqual(cloud.providerName('anthropic'), 'Claude');
});

test('each provider\'s chat models, best first, and the one to suggest', async () => {
  const gemini = await cloud._internals.fetchModels('gemini', KEYS.gemini, { fetchImpl: fakeFetch([]) });
  assert.deepStrictEqual(gemini.map((m) => m.id), ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemma-4-27b-it', 'gemini-3.1-pro-preview']);
  assert.strictEqual(gemini.find((m) => m.id.startsWith('gemma')).tools, false);
  assert.strictEqual(cloud.recommendedModel('gemini', gemini), 'gemini/gemini-3.5-flash');

  const openai = await cloud._internals.fetchModels('openai', KEYS.openai, { fetchImpl: fakeFetch([]) });
  assert.deepStrictEqual(openai.map((m) => m.id), ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'],
    'no audio, realtime, speech, images, embeddings, dated snapshots or old generations');
  assert.deepStrictEqual(openai.slice(0, 2).map((m) => m.label), ['GPT-5', 'GPT-5 mini']);
  assert.strictEqual(cloud.recommendedModel('openai', openai), 'openai/gpt-5-mini');

  const anthropic = await cloud._internals.fetchModels('anthropic', KEYS.anthropic, { fetchImpl: fakeFetch([]) });
  assert.deepStrictEqual(anthropic.map((m) => m.label), ['Claude Haiku 4.5', 'Claude Sonnet 4.5', 'Claude Opus 4.1', 'Claude Sonnet 4'], 'newest first');
  assert.strictEqual(cloud.recommendedModel('anthropic', anthropic), 'anthropic/claude-sonnet-4-5');
});

test('a key is checked with the provider, then saved encrypted per provider — never in plain text or in a URL', async () => {
  const calls = [];
  await assert.rejects(cloud.setKey('openai', 'not a key'), /doesn't look like a ChatGPT API key/);
  await assert.rejects(cloud.setKey('anthropic', KEYS.openai), /doesn't look like a Claude API key/, 'an OpenAI key in the Claude field');
  assert.strictEqual(calls.length, 0);
  await assert.rejects(cloud.setKey('openai', KEYS.openai, { fetchImpl: fakeFetch(calls, false) }), /ChatGPT API key isn't valid/);
  assert(!cloud.hasKey('openai'), 'a rejected key isn\'t saved');

  for (const provider of cloud.PROVIDER_IDS) await cloud.setKey(provider, `  ${KEYS[provider]}  `, { fetchImpl: fakeFetch(calls) });
  const headers = calls.slice(-3).map((c) => c.headers);
  assert.strictEqual(headers[0]['x-goog-api-key'], KEYS.gemini);
  assert.strictEqual(headers[1].Authorization, `Bearer ${KEYS.openai}`);
  assert.strictEqual(headers[2]['x-api-key'], KEYS.anthropic);
  assert.strictEqual(headers[2]['anthropic-version'], '2023-06-01');
  assert(calls.every((c) => !Object.values(KEYS).some((k) => c.url.includes(k))), 'keys go in headers');
  for (const provider of cloud.PROVIDER_IDS) {
    const stored = fs.readFileSync(path.join(userData, `${provider}-key.bin`));
    assert(!stored.toString().includes(KEYS[provider]), `${provider}: stored encrypted`);
  }

  const status = await cloud.status();
  assert.deepStrictEqual(Object.keys(status), ['gemini', 'openai', 'anthropic']);
  assert(Object.values(status).every((s) => s.hasKey && s.models.length > 0 && s.recommended));
  assert(!JSON.stringify(status).includes(KEYS.openai), 'the window never gets a key');

  cloud.clearKey('openai');
  assert(!cloud.hasKey('openai') && cloud.hasKey('gemini'), 'one provider removed, the others kept');
  assert.deepStrictEqual(await cloud.listModels('openai'), []);
  cloud.clearKey('gemini');
  cloud.clearKey('anthropic');
});

test('the providers\' errors in plain words', () => {
  const fe = cloud.friendlyError;
  assert(/Gemini API key isn't valid/.test(fe({ status: 400, message: 'API key not valid. [reason: API_KEY_INVALID]' }, 'gemini/gemini-2.5-flash')));
  assert(/ChatGPT API key isn't valid/.test(fe({ status: 401, message: 'Incorrect API key provided' }, 'openai/gpt-5-mini')));
  assert(/OpenAI account has no credit left/.test(fe({ status: 429, message: 'You exceeded your current quota, please check your plan and billing details. insufficient_quota' }, 'openai/gpt-5')));
  assert(/Anthropic account has no credit left/.test(fe({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' }, 'anthropic/claude-sonnet-4-5')));
  assert(/isn't available on your free Gemini plan/.test(fe({ status: 429, message: 'generate_content_free_tier_requests, limit: 0' }, 'gemini/gemini-3.1-pro-preview')));
  assert(/Claude usage limit/.test(fe({ status: 429, message: 'rate_limit_error: Number of requests has exceeded your rate limit' }, 'anthropic/claude-sonnet-4-5')));
  assert(/Anthropic's servers are busy/.test(fe({ status: 529, message: 'overloaded_error' }, 'anthropic/claude-sonnet-4-5')));
  assert(/isn't available anymore/.test(fe({ status: 404, message: 'The model `gpt-4-32k` does not exist', code: 'model_not_found' }, 'openai/gpt-4-32k')));
  assert(/check your internet connection/.test(fe(new Error('fetch failed'), 'openai/gpt-5')));
  assert.strictEqual(fe(new Error('No Claude API key is set. Add one in Settings, or choose a local model.')), 'No Claude API key is set. Add one in Settings, or choose a local model.');
});

test('a cloud model is a capable model, and loading the app asks no provider anything', async () => {
  assert.throws(() => cloud.createModel('openai/gpt-5-mini'), /No ChatGPT API key/);
  assert.throws(() => cloud.createModel('qwen2.5:7b'), /not a cloud model/);
  assert(typeof client._internals.executeTool === 'function');
});

done();
