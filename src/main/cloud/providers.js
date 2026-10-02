'use strict';

// Cloud models with the user's own API key: Gemini (Google).
//
// Optional: Athar answers with a local model by default. With a key, the
// provider's models appear in the model list as "<provider>/<model id>"
// (e.g. "gemini/gemini-2.5-flash"). The question, the conversation, the memory
// excerpts found for it and attached-file excerpts then go to that company;
// memory indexing and search stay on this computer.
//
// Keys are stored encrypted with the operating system (Electron safeStorage)
// and never go back to the window. Each provider's own model list says which
// models a key can use; when the chosen one can't answer (a limit reached,
// not in the plan, retired), another model of the same provider takes over.

const fs = require('fs');
const path = require('path');

// ─── The providers ───────────────────────────────────────────────────────────

// Gemini: not chat models (speech, audio, live, images/video, embeddings, special purpose)
const GEMINI_NOT_CHAT_RE = /(tts|audio|live|image|imagen|veo|embedding|embed|aqa|robotics|computer-use|lyria|learnlm|deep-research|thinking-exp|-exp-\d)/i;

/** "gemini-2.5-flash" → [2, 5] */
function versionOf(id) {
  const m = /(\d+)(?:[.-](\d+))?/.exec(String(id).replace(/^(gemini|gemma)-?/, ''));
  return m ? [Number(m[1]), Number(m[2] || 0)] : [0, 0];
}

const PROVIDERS = {
  gemini: {
    name: 'Gemini',
    company: 'Google',
    keyUrl: 'aistudio.google.com/apikey',
    keyRe: /^[\w-]{20,}$/,
    async list(key, fetchImpl) {
      const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(res.status, body);
      const out = [];
      for (const m of body.models || []) {
        const id = String(m.name || '').replace(/^models\//, '');
        const methods = m.supportedGenerationMethods || [];
        if (!/^(gemini|gemma)-/.test(id) || GEMINI_NOT_CHAT_RE.test(id) || !methods.includes('generateContent')) continue;
        out.push({ id, label: m.displayName || id, tools: !/^gemma-/.test(id), preview: /preview|exp/i.test(id), contextTokens: m.inputTokenLimit || null });
      }
      const tier = (id) => (/flash-lite/.test(id) ? 2 : /flash/.test(id) ? 0 : /pro/.test(id) ? 1 : 3);
      const family = (id) => (/^gemma-/.test(id) ? 1 : 0); // Gemma (smaller, open models) after Gemini
      return out.sort((a, b) => {
        const [va, vb] = [versionOf(a.id), versionOf(b.id)];
        return (a.preview - b.preview) || (family(a.id) - family(b.id)) || (vb[0] - va[0]) || (vb[1] - va[1]) ||
          (tier(a.id) - tier(b.id)) || a.id.localeCompare(b.id);
      });
    },
    // The newest stable Flash model (on Google's free plan)
    recommend: (list) => list.find((m) => /flash/.test(m.id) && !/lite/.test(m.id) && !m.preview),
    create(key, id) {
      const { createGoogleGenerativeAI } = require('@ai-sdk/google');
      return createGoogleGenerativeAI({ apiKey: key })(id);
    }
  }
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function httpError(status, body) {
  const err = new Error((body && body.error && (body.error.message || body.error.type)) || `HTTP ${status}`);
  err.status = status;
  err.responseBody = JSON.stringify(body || {});
  return err;
}

// ─── Model names ─────────────────────────────────────────────────────────────

/** "gemini/gemini-2.5-flash" → "gemini"; a local model → null */
function providerOf(name) {
  const p = String(name || '').split('/')[0];
  return String(name || '').includes('/') && PROVIDERS[p] ? p : null;
}

function isCloudModel(name) {
  return providerOf(name) !== null;
}

/** "gemini/gemini-2.5-flash" → "gemini-2.5-flash" */
function modelId(name) {
  const p = providerOf(name);
  return p ? String(name).slice(p.length + 1) : String(name || '');
}

function providerName(provider) {
  return PROVIDERS[provider] ? PROVIDERS[provider].name : provider;
}

// ─── Keys (one per provider, encrypted) ──────────────────────────────────────

let electron = null;
function getElectron() {
  if (electron === null) {
    try { electron = require('electron'); } catch { electron = {}; }
  }
  return electron;
}

let dataDirOverride = null; // tests
function keyPath(provider) {
  const dir = dataDirOverride || getElectron().app.getPath('userData');
  return path.join(dir, `${provider}-key.bin`);
}

function encryptionAvailable() {
  const { safeStorage } = getElectron();
  try { return Boolean(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
}

const cachedKeys = new Map(); // provider → key | null
const models = new Map();     // provider → [model]

function getKey(provider) {
  if (cachedKeys.has(provider)) return cachedKeys.get(provider);
  let key = null;
  try {
    const file = keyPath(provider);
    if (fs.existsSync(file) && encryptionAvailable()) key = getElectron().safeStorage.decryptString(fs.readFileSync(file)) || null;
  } catch { key = null; }
  cachedKeys.set(provider, key);
  return key;
}

function hasKey(provider) {
  return Boolean(PROVIDERS[provider] && getKey(provider));
}

function clearKey(provider) {
  cachedKeys.set(provider, null);
  models.delete(provider);
  try { fs.rmSync(keyPath(provider), { force: true }); } catch { /* already gone */ }
}

// ─── Models ──────────────────────────────────────────────────────────────────

/** The text models a key can use, best first, as { name: "<provider>/<id>", id, label, tools, provider }. Throws a friendly error. */
async function fetchModels(provider, key = getKey(provider), { fetchImpl = fetch } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider "${provider}".`);
  if (!key) throw new Error(`No ${p.name} API key is set.`);
  let list;
  try {
    list = await p.list(key, fetchImpl);
  } catch (err) {
    if (err && err.status) throw new Error(friendlyError(err, null, provider));
    throw new Error(`Couldn't reach ${p.company} — check your internet connection.`);
  }
  return list.map((m) => ({ ...m, provider, name: `${provider}/${m.id}` }));
}

/** Checks a new key against the provider, then saves it. Returns its models. */
async function setKey(provider, key, opts = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider "${provider}".`);
  const trimmed = String(key || '').trim();
  if (!p.keyRe.test(trimmed)) throw new Error(`That doesn't look like a ${p.name} API key. Copy it from ${p.keyUrl}.`);
  const list = await fetchModels(provider, trimmed, opts);
  if (list.length === 0) throw new Error('This key works, but no chat models are available for it.');
  if (!encryptionAvailable()) throw new Error('This computer can\'t store the key securely (system encryption is unavailable).');
  const file = keyPath(provider);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, getElectron().safeStorage.encryptString(trimmed));
  cachedKeys.set(provider, trimmed);
  models.set(provider, list);
  return list;
}

/** A provider's models (fetched once per app session). */
async function listModels(provider) {
  if (!hasKey(provider)) return [];
  if (!models.has(provider)) models.set(provider, await fetchModels(provider));
  return models.get(provider);
}

function knownModel(name) {
  const p = providerOf(name);
  return (p && (models.get(p) || []).find((m) => m.name === name)) || null;
}

/** The model to suggest for a provider's list. */
function recommendedModel(provider, list) {
  const p = PROVIDERS[provider];
  const pick = (p && p.recommend(list || [])) || (list || [])[0];
  return pick ? pick.name : null;
}

// ChatGPT and Claude keys were supported briefly: delete any such key left on this computer
let oldKeysRemoved = false;
function removeOldKeys() {
  if (oldKeysRemoved) return;
  oldKeysRemoved = true;
  for (const old of ['openai', 'anthropic']) {
    try { fs.rmSync(keyPath(old), { force: true }); } catch { /* not there */ }
  }
}

/** For the window: each provider's key state and models. */
async function status() {
  removeOldKeys();
  const out = {};
  for (const provider of PROVIDER_IDS) {
    const base = { provider, name: PROVIDERS[provider].name, company: PROVIDERS[provider].company, keyUrl: PROVIDERS[provider].keyUrl };
    if (!hasKey(provider)) { out[provider] = { ...base, success: true, hasKey: false, models: [], recommended: null, encryption: encryptionAvailable() }; continue; }
    try {
      const list = await listModels(provider);
      out[provider] = { ...base, success: true, hasKey: true, models: list, recommended: recommendedModel(provider, list), encryption: true };
    } catch (err) {
      out[provider] = { ...base, success: false, hasKey: true, models: [], recommended: null, error: err.message };
    }
  }
  return out;
}

/** The AI SDK model for "<provider>/<id>". */
function createModel(name) {
  const provider = providerOf(name);
  if (!provider) throw new Error(`"${name}" is not a cloud model.`);
  const key = getKey(provider);
  if (!key) throw new Error(`No ${providerName(provider)} API key is set. Add one in Settings, or choose a local model.`);
  return PROVIDERS[provider].create(key, modelId(name));
}

// ─── Searching the web ───────────────────────────────────────────────────────
// Gemini 3 and newer can use Google Search (and read linked pages) next to
// Athar's own tools (memory search, files). Gemini 2.x can't combine them —
// those, and any model whose Google Search fails, use Athar's search tool.

const googleSearchUnsupported = new Set(); // models that refused Google Search with other tools (this session)

function canUseGoogleSearch(name) {
  if (providerOf(name) !== 'gemini' || googleSearchUnsupported.has(name)) return false;
  const m = /^gemini-(\d+)/.exec(modelId(name));
  return Boolean(m) && Number(m[1]) >= 3;
}

/** Google Search and URL reading, as AI SDK tools (no key needed to describe them). */
function googleTools() {
  const { google } = require('@ai-sdk/google');
  return { google_search: google.tools.googleSearch({}), url_context: google.tools.urlContext({}) };
}

/** Google refused its tools next to function tools: this model uses Athar's search tool from now on. */
function isGoogleToolsRefusal(err) {
  const status = err && (err.status || err.statusCode);
  const message = String((err && (err.message || err.responseBody)) || '');
  return (status === 400 || !status) && /(google_?search|url_?context|built-?in tool|function calling|tool use|multiple tools|unsupported).{0,120}(not supported|unsupported|cannot|can't|isn't)|not supported.{0,60}(tool|function calling)/i.test(message);
}

function stopGoogleSearch(name) {
  googleSearchUnsupported.add(name);
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** The providers' errors in plain words. */
function friendlyError(err, name = null, provider = providerOf(name)) {
  const status = err && (err.status || err.statusCode);
  const message = String((err && (err.message || err.responseBody)) || '');
  const p = PROVIDERS[provider] || { name: 'The cloud model', company: 'the provider', keyUrl: '' };
  const which = name ? `${modelLabel(name)} ` : 'This model ';
  if (/^No \w+ API key is set/.test(message)) return message;
  if (/API_KEY_INVALID|API key not valid|invalid.{0,10}api.?key|incorrect api key|authentication_error|invalid x-api-key/i.test(message) || status === 401) {
    return `The ${p.name} API key isn't valid. Copy it again from ${p.keyUrl} and paste the whole key.`;
  }
  // Google's limit errors say "You exceeded your current quota, please check your plan and billing
  // details" for every free-plan limit — which limit it is, is in the details
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message)) {
    if (/limit:\s*0\b/.test(message)) {
      return `${which}isn't available on your free ${p.name} plan. Choose another ${p.name} model in Settings.`;
    }
    if (/PerDay/i.test(message)) {
      return `${which}reached its free ${p.name} limit for today. It resets at midnight California time (around 10–11 AM in Egypt); meanwhile choose another model.`;
    }
    return `You've reached your ${p.name} usage limit for the moment. Wait a minute and try again, or choose another model.`;
  }
  if (status === 529 || /overloaded/i.test(message)) return `${p.company}'s servers are busy right now. Try again in a moment.`;
  if (status === 403 || /PERMISSION_DENIED|does not have access|not available in your (country|region)|location is not supported|unsupported_country/i.test(message)) {
    return `${p.company} refused the request: this model may not be available for your key or in your region.`;
  }
  if (status === 404 || /is not found|not supported for generateContent|model_not_found|not_found_error|does not exist/i.test(message)) {
    return `${which}isn't available anymore. Choose another ${p.name} model in Settings.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return `Couldn't reach ${p.company} — check your internet connection, or choose a local model.`;
  }
  return `${p.name} reported an error: ${message.slice(0, 200) || `HTTP ${status}`}`;
}

// ─── When a model can't answer: another model of the same provider takes over ─
// A model that reached its limit (per day or per minute), isn't in the key's
// plan, or was retired is set aside — for the day, a minute, or this session —
// and the next one in the provider's list (best first) answers instead. Once a
// limit resets, the chosen model is used again.

const unavailable = new Map(); // model name → { until (ms timestamp), kind }

/** Milliseconds until midnight Pacific time, when Google resets daily free limits. */
function msUntilPacificMidnight(now = new Date()) {
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const passed = ((pt.getHours() * 60 + pt.getMinutes()) * 60 + pt.getSeconds()) * 1000;
  return Math.max(60 * 1000, 24 * 3600 * 1000 - passed);
}

/**
 * Whether another model may answer instead, and for how long this one is set
 * aside: 'not-in-plan' and 'gone' (this session), 'daily' (until the daily
 * reset), 'minute' (the provider's "retry in Ns", else a minute). null: an
 * error every model would hit too (bad key, no internet, region).
 */
function classifyError(err, now = new Date()) {
  const status = err && (err.status || err.statusCode);
  const message = String((err && (err.message || err.responseBody)) || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate_limit/i.test(message)) {
    if (/limit:\s*0\b/.test(message)) return { kind: 'not-in-plan', until: Infinity };
    if (/PerDay/i.test(message)) return { kind: 'daily', until: now.getTime() + msUntilPacificMidnight(now) };
    const retry = /retry in ([\d.]+)\s*s/i.exec(message) || /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message) || /try again in ([\d.]+)\s*s/i.exec(message);
    return { kind: 'minute', until: now.getTime() + (retry ? Math.ceil(Number(retry[1])) : 60) * 1000 };
  }
  if (status === 529 || /overloaded_error/i.test(message)) return { kind: 'busy', until: now.getTime() + 30 * 1000 };
  if (status === 404 || /is not found|not supported for generateContent|model_not_found|not_found_error|no longer available|has been deprecated|does not exist/i.test(message)) {
    return { kind: 'gone', until: Infinity };
  }
  if (status === 403 && /does not have access to (the )?model/i.test(message)) return { kind: 'not-in-plan', until: Infinity };
  return null;
}

function markUnavailable(name, info) {
  unavailable.set(name, info);
}

function isAvailable(name, now = Date.now()) {
  const u = unavailable.get(name);
  if (!u) return true;
  if (now >= u.until) { unavailable.delete(name); return true; }
  return false;
}

/** Why a model is set aside right now ('daily', 'minute'…), or null. */
function unavailableKind(name) {
  return isAvailable(name) ? null : unavailable.get(name).kind;
}

/** The chosen model first (if it can answer), then the provider's other models, best first. */
async function fallbackOrder(name) {
  let list = [];
  try { list = await listModels(providerOf(name)); } catch { /* the chosen model alone */ }
  const others = list.map((m) => m.name).filter((n) => n !== name);
  return [name, ...others].filter((n) => isAvailable(n));
}

/** "reached its free limit for today", in words for the user. */
function unavailableReason(kind) {
  return {
    daily: 'reached its free limit for today',
    minute: 'reached its limit for this minute',
    busy: 'is overloaded right now',
    'not-in-plan': 'isn\'t in your plan',
    gone: 'isn\'t available anymore'
  }[kind] || 'can\'t answer right now';
}

function modelLabel(name) {
  const m = knownModel(name);
  return m ? m.label : modelId(name);
}

module.exports = {
  PROVIDER_IDS,
  providerOf,
  providerName,
  isCloudModel,
  modelId,
  encryptionAvailable,
  hasKey,
  setKey,
  clearKey,
  listModels,
  knownModel,
  recommendedModel,
  status,
  createModel,
  friendlyError,
  classifyError,
  markUnavailable,
  isAvailable,
  unavailableKind,
  fallbackOrder,
  unavailableReason,
  modelLabel,
  canUseGoogleSearch,
  googleTools,
  isGoogleToolsRefusal,
  stopGoogleSearch,
  // for tests
  _internals: {
    PROVIDERS, versionOf, fetchModels, msUntilPacificMidnight,
    setModels: (provider, list) => { models.set(provider, list); },
    resetUnavailable: () => unavailable.clear(),
    setDataDir: (dir) => { dataDirOverride = dir; cachedKeys.clear(); models.clear(); }
  }
};
