const path = require('path');
const assert = require('assert');
const { createRequire } = require('module');
const { test, done, stubElectron, ROOT } = require('./helpers');

// Electron's safeStorage, faked (see gemini-api.test.js)
stubElectron();
require.cache[require.resolve('electron', { paths: [ROOT] })].exports.safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString()
};
const gemini = require(path.join(ROOT, 'src/main/cloud/providers'));
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));
const req = createRequire(path.join(ROOT, 'package.json'));
const { MockLanguageModelV4, simulateReadableStream } = req('ai/test');
const { APICallError } = req('@ai-sdk/provider');

// Google's real 429 bodies (trimmed)
const DAILY = '{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 250, model: gemini-3.5-flash","status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}';
const MINUTE = '{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 10. Please retry in 34.5s.","details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"34s"}]}}';
const NOT_IN_PLAN = '{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro"}}';
const RETIRED = '{"error":{"code":404,"message":"models/gemini-1.5-flash is not found for API version v1beta, or is not supported for generateContent."}}';

test('why a model can\'t answer, and for how long it is set aside', () => {
  const now = new Date('2026-10-02T15:00:00Z'); // 08:00 in California
  const daily = gemini.classifyError({ status: 429, message: DAILY }, now);
  assert.strictEqual(daily.kind, 'daily');
  assert.strictEqual(daily.until - now.getTime(), 16 * 3600 * 1000, 'until midnight Pacific time');
  const minute = gemini.classifyError({ status: 429, message: MINUTE }, now);
  assert.deepStrictEqual([minute.kind, minute.until - now.getTime()], ['minute', 35 * 1000], 'Google\'s "retry in 34.5s"');
  assert.strictEqual(gemini.classifyError({ status: 429, message: NOT_IN_PLAN }).kind, 'not-in-plan');
  assert.strictEqual(gemini.classifyError({ status: 404, message: RETIRED }).kind, 'gone');
  // Errors every model would hit: no switching
  assert.strictEqual(gemini.classifyError({ status: 400, message: 'API key not valid. [reason: API_KEY_INVALID]' }), null);
  assert.strictEqual(gemini.classifyError(new Error('fetch failed')), null);
});

test('a set-aside model comes back when its limit resets; the order is the chosen model, then the best others', async () => {
  gemini._internals.resetUnavailable();
  await gemini.setKey('gemini', 'AIzaSyD-test_key_1234567890abcdefghij', { fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }) }) });
  gemini._internals.setModels('gemini', [{ name: 'gemini/a' }, { name: 'gemini/b' }, { name: 'gemini/c' }]);
  gemini.markUnavailable('gemini/b', { kind: 'minute', until: Date.now() + 50 });
  assert.deepStrictEqual(await gemini.fallbackOrder('gemini/c'), ['gemini/c', 'gemini/a']);
  assert.strictEqual(gemini.unavailableKind('gemini/b'), 'minute');
  await new Promise((r) => setTimeout(r, 70));
  assert(gemini.isAvailable('gemini/b') && gemini.unavailableKind('gemini/b') === null);
  assert.deepStrictEqual(await gemini.fallbackOrder('gemini/c'), ['gemini/c', 'gemini/a', 'gemini/b']);
});

// ── A whole answer, with fake Gemini models ──
const answering = (text) => new MockLanguageModelV4({
  doStream: async () => ({
    stream: simulateReadableStream({ chunks: [
      { type: 'text-start', id: '1' }, { type: 'text-delta', id: '1', delta: text }, { type: 'text-end', id: '1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }
    ] })
  })
});
const failing = (statusCode, body, calls) => new MockLanguageModelV4({
  doStream: async () => {
    calls.n += 1;
    throw new APICallError({ message: 'error', url: 'https://generativelanguage.googleapis.com', requestBodyValues: {}, statusCode, responseBody: body, isRetryable: false });
  }
});

async function ask(modelName) {
  const steps = [];
  let streamed = '';
  const text = await client.generate('What did I decide about the database?', null, [], modelName,
    (t) => { streamed += t; }, (s) => { if (s && s.text) steps.push(s.text); });
  return { text, steps, streamed };
}

test('the chosen Gemini model reached its daily limit: the next one answers, and the answer says so', async () => {
  gemini._internals.resetUnavailable();
  const API = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].map((id) => ({ name: `models/${id}`, displayName: id.replace('gemini-', 'Gemini ').replace('-flash', ' Flash').replace('-lite', '-Lite'), supportedGenerationMethods: ['generateContent'] }));
  await gemini.setKey('gemini', 'AIzaSyD-test_key_1234567890abcdefghij', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ models: API }) }) });
  const calls = { n: 0 };
  const models = {
    'gemini/gemini-3.5-flash': failing(429, DAILY, calls),
    'gemini/gemini-2.5-flash': answering('You chose PostgreSQL.')
  };
  const original = gemini.createModel;
  gemini.createModel = (name) => models[name] || answering('(another model)');
  try {
    const first = await ask('gemini/gemini-3.5-flash');
    assert(first.text.startsWith('You chose PostgreSQL.'), first.text);
    assert(/_Answered by Gemini 2\.5 Flash: Gemini 3\.5 Flash reached its free limit for today\._$/.test(first.text), first.text);
    assert(first.steps.some((s) => /Gemini 3\.5 Flash reached its free limit for today — trying Gemini 2\.5 Flash…/.test(s)), first.steps.join(' | '));
    assert.strictEqual(calls.n, 1);

    // The next message: the chosen model isn't tried again until the limit resets
    const second = await ask('gemini/gemini-3.5-flash');
    assert.strictEqual(calls.n, 1, 'not asked again today');
    assert(/_Answered by Gemini 2\.5 Flash: Gemini 3\.5 Flash reached its free limit for today\._$/.test(second.text), second.text);
  } finally {
    gemini.createModel = original;
  }
});

test('every Gemini model at its limit: a plain message; a bad key: no switching', async () => {
  gemini._internals.resetUnavailable();
  const calls = { n: 0 };
  const original = gemini.createModel;
  gemini.createModel = () => failing(429, DAILY, calls);
  try {
    const all = await ask('gemini/gemini-3.5-flash');
    assert.strictEqual(calls.n, 3, 'each model tried once');
    assert(/All your Gemini models have reached their limits for now/.test(all.text), all.text);

    gemini._internals.resetUnavailable();
    calls.n = 0;
    gemini.createModel = () => failing(400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', calls);
    const bad = await ask('gemini/gemini-3.5-flash');
    assert.strictEqual(calls.n, 1, 'a bad key fails the same everywhere: not switched');
    assert(/key isn't valid/.test(bad.text), bad.text);
  } finally {
    gemini.createModel = original;
    gemini.clearKey('gemini');
  }
});

test('Search on: Gemini 3+ gets Google Search; if Google refuses it next to other tools, Athar\'s search tool instead', async () => {
  gemini._internals.resetUnavailable();
  assert(gemini.canUseGoogleSearch('gemini/gemini-3.5-flash') && !gemini.canUseGoogleSearch('gemini/gemini-2.5-flash') && !gemini.canUseGoogleSearch('gemini/gemma-4-27b-it'));
  await gemini.setKey('gemini', 'AIzaSyD-test_key_1234567890abcdefghij', { fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ models: [{ name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent'] }] }) }) });
  const seenTools = [];
  const model = new MockLanguageModelV4({
    doStream: async (opts) => {
      const names = (opts.tools || []).map((t) => t.name);
      seenTools.push(names);
      if (names.includes('google_search')) {
        throw new APICallError({ message: 'Tool use with function calling is unsupported', url: 'x', requestBodyValues: {}, statusCode: 400,
          responseBody: '{"error":{"code":400,"message":"Tool use with function calling is unsupported"}}', isRetryable: false });
      }
      return answering('Gold is about $3,900 an ounce today (Reuters, 2 Oct 2026).').doStream(opts);
    }
  });
  const original = gemini.createModel;
  gemini.createModel = () => model;
  try {
    const steps = [];
    const text = await client.generate('What is the price of gold today?', null, [], 'gemini/gemini-3.5-flash', () => {}, (s) => { if (s && s.text) steps.push(s.text); },
      [], null, null, [], null, { searchOn: true });
    assert(seenTools[0].includes('google_search') && seenTools[0].includes('url_context') && seenTools[0].includes('search_memory'), JSON.stringify(seenTools[0]));
    assert(seenTools[1].includes('web_search') && !seenTools[1].includes('google_search'), JSON.stringify(seenTools[1]));
    assert(steps.some((s) => /can't use Google Search here — searching with Athar's search instead/.test(s)), steps.join(' | '));
    assert(/Reuters/.test(text) && !/training data/.test(text), 'searched: no "training data" note');
    assert(!gemini.canUseGoogleSearch('gemini/gemini-3.5-flash'), 'remembered for this session');

    // Search off: no web tools at all, and the answer says how old its information is
    seenTools.length = 0;
    const off = await client.generate('What is the price of gold today?', null, [], 'gemini/gemini-3.5-flash', () => {}, () => {});
    assert(!seenTools[0].some((n) => /web_search|fetch_web_page|google_search/.test(n)), JSON.stringify(seenTools[0]));
    assert(/training data/.test(off), off);
  } finally {
    gemini.createModel = original;
    gemini.clearKey('gemini');
  }
});

done();
