// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
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

// What Gemini's model list returns (trimmed), as of 2026
const GEMINI = [
  ['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'], ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
  ['gemini-3.5-flash', 'Gemini 3.5 Flash'], ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'], ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
  ['gemini-2.5-flash-preview-tts', 'TTS'], ['gemini-2.5-flash-native-audio-preview-12-2025', 'Audio'], ['gemini-3.8-live', 'Live'],
  ['gemini-2.5-flash-image', 'Image'], ['gemma-4-27b-it', 'Gemma 4 27B']
].map(([id, displayName]) => ({ name: `models/${id}`, displayName, supportedGenerationMethods: ['generateContent', 'countTokens'] }))
  .concat([{ name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }]);

function fakeFetch(calls, ok = true) {
  return async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    if (!ok) return { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid. [reason: API_KEY_INVALID]' } }) };
    return { ok: true, status: 200, json: async () => ({ models: GEMINI }) };
  };
}
const KEY = 'AIzaSyD-test_key_1234567890abcdefghij';

test('only Gemini is a cloud provider; model names are "gemini/<id>"', () => {
  assert.deepStrictEqual(cloud.PROVIDER_IDS, ['gemini']);
  assert.deepStrictEqual(['gemini/gemini-2.5-flash', 'openai/gpt-5-mini', 'anthropic/claude-sonnet-4-5', 'qwen2.5:7b'].map(cloud.providerOf),
    ['gemini', null, null, null]);
  assert.strictEqual(cloud.modelId('gemini/gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('Gemini\'s chat models, best first, and the one to suggest', async () => {
  const list = await cloud._internals.fetchModels('gemini', KEY, { fetchImpl: fakeFetch([]) });
  assert.deepStrictEqual(list.map((m) => m.id), ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemma-4-27b-it', 'gemini-3.1-pro-preview']);
  assert.strictEqual(list.find((m) => m.id.startsWith('gemma')).tools, false);
  assert.strictEqual(cloud.recommendedModel('gemini', list), 'gemini/gemini-3.5-flash');
});

test('a key is checked with Google, then saved encrypted — never in plain text or in a URL', async () => {
  const calls = [];
  await assert.rejects(cloud.setKey('gemini', 'not a key'), /doesn't look like a Gemini API key/);
  await assert.rejects(cloud.setKey('openai', 'sk-proj-test_key_1234567890abcdefghij'), /Unknown provider/);
  assert.strictEqual(calls.length, 0);
  await assert.rejects(cloud.setKey('gemini', KEY, { fetchImpl: fakeFetch(calls, false) }), /Gemini API key isn't valid/);
  assert(!cloud.hasKey('gemini'), 'a rejected key isn\'t saved');

  await cloud.setKey('gemini', `  ${KEY}  `, { fetchImpl: fakeFetch(calls) });
  assert.strictEqual(calls[calls.length - 1].headers['x-goog-api-key'], KEY);
  assert(calls.every((c) => !c.url.includes(KEY)), 'the key goes in a header');
  assert(!fs.readFileSync(path.join(userData, 'gemini-key.bin')).toString().includes(KEY), 'stored encrypted');

  const status = await cloud.status();
  assert.deepStrictEqual(Object.keys(status), ['gemini']);
  assert(status.gemini.hasKey && status.gemini.models.length === 7 && status.gemini.recommended);
  assert(!JSON.stringify(status).includes(KEY), 'the window never gets the key');

  cloud.clearKey('gemini');
  assert(!cloud.hasKey('gemini') && !fs.existsSync(path.join(userData, 'gemini-key.bin')));
  assert.deepStrictEqual(await cloud.listModels('gemini'), []);
});

test('Google\'s errors in plain words', () => {
  const fe = (err) => cloud.friendlyError(err, 'gemini/gemini-3.1-pro-preview');
  assert(/Gemini API key isn't valid/.test(fe({ status: 400, message: 'API key not valid. [reason: API_KEY_INVALID]' })));
  assert(/isn't available on your free Gemini plan/.test(fe({ status: 429, message: 'generate_content_free_tier_requests, limit: 0' })));
  assert(/Gemini usage limit for the moment/.test(fe({ status: 429, message: 'Resource has been exhausted (e.g. check quota). limit: 10' })));
  // Google says "check your plan and billing details" for every free limit: it's a limit, not "no credit"
  const daily = { status: 429, message: 'You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20. GenerateRequestsPerDayPerProjectPerModel-FreeTier' };
  assert(/reached its free Gemini limit for today/.test(fe(daily)) && !/credit/.test(fe(daily)), fe(daily));
  assert.strictEqual(cloud.classifyError(daily).kind, 'daily', 'so another Gemini model answers');
  assert(/region/.test(fe({ status: 403, message: 'User location is not supported for the API use.' })));
  assert(/isn't available anymore/.test(fe({ status: 404, message: 'models/gemini-1.5-flash is not found' })));
  assert(/check your internet connection/.test(fe(new Error('fetch failed'))));
  assert.strictEqual(cloud.friendlyError(new Error('No Gemini API key is set. Add one in Settings, or choose a local model.')), 'No Gemini API key is set. Add one in Settings, or choose a local model.');
});

test('Gemini gets its whole context: the window Google lists, and the whole conversation', async () => {
  const withLimit = GEMINI.map((m) => ({ ...m, inputTokenLimit: 1048576 }));
  const list = await cloud._internals.fetchModels('gemini', KEY, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ models: withLimit }) }) });
  assert(list.every((m) => m.contextTokens === 1048576));
  const { buildMessages } = client._internals;
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `message ${i}` }));
  const count = (ctx) => buildMessages('next', ctx, history, [], null, [], null, '').filter((m) => m.role !== 'system').length;
  assert.strictEqual(count({ toolsAvailable: true }), 12, 'a local model: the last 12 messages');
  assert.strictEqual(count({ toolsAvailable: true, wholeConversation: true }), 30, 'a cloud model: all of them');
});

test('a Gemini model needs its key; loading the app asks Google nothing', () => {
  assert.throws(() => cloud.createModel('gemini/gemini-2.5-flash'), /No Gemini API key/);
  assert.throws(() => cloud.createModel('openai/gpt-5-mini'), /not a cloud model/);
  assert(typeof client._internals.executeTool === 'function');
});

done();
