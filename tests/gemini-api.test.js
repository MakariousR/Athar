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
const gemini = require(path.join(ROOT, 'src/main/cloud/gemini'));
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));
const { chatModels } = gemini._internals;

// What GET /v1beta/models returns (trimmed), as of 2026
const API_MODELS = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'], ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
  ['gemini-3.5-flash', 'Gemini 3.5 Flash'], ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'], ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
  ['gemini-2.5-flash-preview-tts', 'TTS'], ['gemini-2.5-flash-native-audio-preview-12-2025', 'Audio'], ['gemini-3.8-live', 'Live'],
  ['gemini-2.5-flash-image', 'Image'], ['gemma-4-27b-it', 'Gemma 4 27B']
].map(([id, displayName]) => ({ name: `models/${id}`, displayName, inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] }))
  .concat([
    { name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/imagen-4.0-generate-001', displayName: 'Imagen', supportedGenerationMethods: ['predict'] }
  ]);

test('only text chat models are offered, best first: stable, newest, Flash before Pro before Lite', () => {
  const list = chatModels(API_MODELS);
  assert.deepStrictEqual(list.map((m) => m.id), [
    'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemma-4-27b-it', 'gemini-3.1-pro-preview'
  ]);
  assert.strictEqual(list[0].name, 'gemini/gemini-3.5-flash');
  assert.strictEqual(list.find((m) => m.id.startsWith('gemma')).tools, false, 'Gemma on the Gemini API has no function calling');
  assert.strictEqual(gemini.recommendedModel(list), 'gemini/gemini-3.5-flash');
  assert.strictEqual(gemini.recommendedModel(chatModels(API_MODELS.filter((m) => !/flash/.test(m.name)))), 'gemini/gemini-2.5-pro', 'no Flash: the first');
});

test('Google\'s errors in plain words', () => {
  const fe = gemini.friendlyError;
  assert(/key isn't valid/.test(fe({ status: 400, message: 'API key not valid. Please pass a valid API key. [reason: API_KEY_INVALID]' })));
  assert(/isn't available on your free Gemini plan/.test(fe({ status: 429, message: 'Quota exceeded for metric generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro' }, 'gemini/gemini-3.1-pro-preview')));
  assert(/^gemini-3.1-pro-preview isn't available/.test(fe({ status: 429, message: 'limit: 0' }, 'gemini/gemini-3.1-pro-preview')));
  assert(/usage limit for now/.test(fe({ status: 429, message: 'Resource has been exhausted (e.g. check quota). limit: 10' })));
  assert(/region/.test(fe({ status: 403, message: 'User location is not supported for the API use.' })));
  assert(/internet connection/.test(fe(new Error('fetch failed'))));
  assert.strictEqual(fe(new Error('No Gemini API key is set. Add one in Settings, or choose a local model.')), 'No Gemini API key is set. Add one in Settings, or choose a local model.');
});

test('a key is checked with Google, then saved encrypted — never in plain text, and never in a URL', async () => {
  const calls = [];
  const fakeFetch = (ok) => async (url, opts) => {
    calls.push({ url, opts });
    return ok
      ? { ok: true, status: 200, json: async () => ({ models: API_MODELS }) }
      : { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid. [reason: API_KEY_INVALID]' } }) };
  };
  const KEY = 'AIzaSyD-test_key_1234567890abcdefghij';
  await assert.rejects(gemini.setKey('not a key'), /doesn't look like a Gemini API key/);
  assert.strictEqual(calls.length, 0, 'a malformed key isn\'t sent anywhere');
  await assert.rejects(gemini.setKey(KEY, { fetchImpl: fakeFetch(false) }), /key isn't valid/);
  assert(!gemini.hasKey(), 'a rejected key isn\'t saved');

  const list = await gemini.setKey(`  ${KEY}  `, { fetchImpl: fakeFetch(true) });
  assert.strictEqual(list.length, 7);
  assert(calls.every((c) => !c.url.includes(KEY) && c.opts.headers['x-goog-api-key'] === KEY), 'the key goes in a header');
  const stored = fs.readFileSync(path.join(userData, 'gemini-key.bin'));
  assert(!stored.toString().includes(KEY), 'stored encrypted');
  assert(gemini.hasKey());
  assert.strictEqual((await gemini.listModels()).length, 7, 'the list is kept for this session');

  gemini.clearKey();
  assert(!gemini.hasKey() && !fs.existsSync(path.join(userData, 'gemini-key.bin')));
  assert.deepStrictEqual(await gemini.listModels(), []);
});

test('a Gemini model is a capable model with tools (Gemma without), and no Ollama is asked about it', async () => {
  assert(gemini.isCloudModel('gemini/gemini-2.5-flash') && !gemini.isCloudModel('qwen2.5:7b') && !gemini.isCloudModel('gemini'));
  assert.strictEqual(gemini.modelId('gemini/gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.throws(() => gemini.createModel('gemini/gemini-2.5-flash'), /No Gemini API key/);
  const { executeTool } = client._internals; // loading the client must not touch the network
  assert(typeof executeTool === 'function');
});

done();
