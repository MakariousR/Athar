'use strict';

// Gemini models, with the user's own API key (Google AI Studio).
//
// Optional: Athar answers with a local model by default. With a key, Gemini
// models appear in the model list as "gemini/<model id>". The question, the
// conversation, the memory excerpts found for it and attached-file excerpts
// then go to Google (memory indexing and search stay on this computer).
//
// The key is stored encrypted with the operating system (Electron safeStorage)
// and never goes back to the window. Which models a key may use (the free
// tier) isn't in the API's model list, so every text model is offered, the
// newest stable "Flash" one is suggested, and a model the plan doesn't include
// fails with a plain message instead of a raw error.

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PREFIX = 'gemini/';
const KEY_FILE = 'gemini-key.bin';

// Not chat models: speech, audio, live, images/video, embeddings, special purpose
const NOT_CHAT_RE = /(tts|audio|live|image|imagen|veo|embedding|embed|aqa|robotics|computer-use|lyria|learnlm|deep-research|thinking-exp|-exp-\d)/i;

let electron = null;
function getElectron() {
  if (electron === null) {
    try { electron = require('electron'); } catch { electron = {}; }
  }
  return electron;
}

let dataDirOverride = null; // tests
function keyPath() {
  const dir = dataDirOverride || getElectron().app.getPath('userData');
  return path.join(dir, KEY_FILE);
}

function isCloudModel(name) {
  return String(name || '').startsWith(PREFIX);
}

/** "gemini/gemini-2.5-flash" → "gemini-2.5-flash" */
function modelId(name) {
  return String(name || '').slice(PREFIX.length);
}

// ─── The key ─────────────────────────────────────────────────────────────────

function encryptionAvailable() {
  const { safeStorage } = getElectron();
  try { return Boolean(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
}

function saveKey(key) {
  if (!encryptionAvailable()) throw new Error('This computer can\'t store the key securely (system encryption is unavailable).');
  const file = keyPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, getElectron().safeStorage.encryptString(String(key).trim()));
}

let cachedKey; // undefined: not read yet
function getKey() {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = null;
  try {
    const file = keyPath();
    if (fs.existsSync(file) && encryptionAvailable()) cachedKey = getElectron().safeStorage.decryptString(fs.readFileSync(file)) || null;
  } catch { cachedKey = null; }
  return cachedKey;
}

function hasKey() {
  return Boolean(getKey());
}

function clearKey() {
  cachedKey = null;
  models = null;
  try { fs.rmSync(keyPath(), { force: true }); } catch { /* already gone */ }
}

// ─── Models ──────────────────────────────────────────────────────────────────

/** The Gemini API's version of a model id as numbers, for sorting newest first ("gemini-2.5-flash" → [2, 5]). */
function versionOf(id) {
  const m = /-(\d+)(?:\.(\d+))?/.exec(id);
  return m ? [Number(m[1]), Number(m[2] || 0)] : [0, 0];
}

/**
 * The text models in the API's list, best first: stable before preview,
 * newer before older, Flash before Pro (Flash is on the free tier) before Lite.
 */
function chatModels(apiModels) {
  const out = [];
  for (const m of apiModels || []) {
    const id = String(m.name || '').replace(/^models\//, '');
    const methods = m.supportedGenerationMethods || [];
    if (!/^(gemini|gemma)-/.test(id) || NOT_CHAT_RE.test(id) || !methods.includes('generateContent')) continue;
    out.push({
      name: `${PREFIX}${id}`,
      id,
      label: m.displayName || id,
      contextTokens: m.inputTokenLimit || null,
      tools: !/^gemma-/.test(id), // Gemma models on the Gemini API don't do function calling
      vision: true,
      preview: /preview|exp/i.test(id)
    });
  }
  const tier = (id) => (/flash-lite/.test(id) ? 2 : /flash/.test(id) ? 0 : /pro/.test(id) ? 1 : 3);
  const family = (id) => (/^gemma-/.test(id) ? 1 : 0); // Gemma (smaller, open models) after Gemini, whatever its version number
  return out.sort((a, b) => {
    const [va, vb] = [versionOf(a.id), versionOf(b.id)];
    return (a.preview - b.preview) || (family(a.id) - family(b.id)) || (vb[0] - va[0]) || (vb[1] - va[1]) ||
      (tier(a.id) - tier(b.id)) || a.id.localeCompare(b.id);
  });
}

/** The model to suggest: the newest stable Flash model, else the first. */
function recommendedModel(list) {
  const pick = (list || []).find((m) => /flash/.test(m.id) && !/lite/.test(m.id) && !m.preview) || (list || [])[0];
  return pick ? pick.name : null;
}

let models = null; // the last list, for the model picker and capabilities

/** Lists the key's text models from the Gemini API. Throws a friendly error. */
async function fetchModels(key = getKey(), { fetchImpl = fetch } = {}) {
  if (!key) throw new Error('No Gemini API key is set.');
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  } catch {
    throw new Error('Couldn\'t reach Google — check your internet connection.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError({ status: res.status, message: (body.error && body.error.message) || '' }));
  return chatModels(body.models);
}

/** Checks a new key against the API, then saves it. Returns its models. */
async function setKey(key, opts = {}) {
  const trimmed = String(key || '').trim();
  if (!/^[\w-]{20,}$/.test(trimmed)) throw new Error('That doesn\'t look like a Gemini API key. Copy it from Google AI Studio (aistudio.google.com/apikey).');
  const list = await fetchModels(trimmed, opts);
  if (list.length === 0) throw new Error('This key works, but no text models are available for it.');
  saveKey(trimmed);
  cachedKey = trimmed;
  models = list;
  return list;
}

/** The current models (fetched once per app session). */
async function listModels() {
  if (!hasKey()) return [];
  if (!models) models = await fetchModels();
  return models;
}

function knownModel(name) {
  return (models || []).find((m) => m.name === name) || null;
}

// ─── Using a model ───────────────────────────────────────────────────────────

/** The AI SDK model for "gemini/<id>". */
function createModel(name) {
  const key = getKey();
  if (!key) throw new Error('No Gemini API key is set. Add one in Settings, or choose a local model.');
  const { createGoogleGenerativeAI } = require('@ai-sdk/google');
  return createGoogleGenerativeAI({ apiKey: key })(modelId(name));
}

/**
 * Google's errors in plain words. 429 is both "too many requests" and "this
 * model isn't in your plan" (the free tier's limit for it is 0).
 */
function friendlyError(err, name = null) {
  const status = err && (err.status || err.statusCode);
  const message = String((err && (err.message || err.responseBody)) || '');
  const which = name ? `${modelId(name)} ` : 'This model ';
  if (/^No Gemini API key is set/.test(message)) return message;
  if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(message) || status === 401) {
    return 'The Gemini API key isn\'t valid. Copy it again from aistudio.google.com/apikey and paste the whole key.';
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) {
    if (/limit:\s*0\b|free_tier|FreeTier/i.test(message)) {
      return `${which}isn't available on your free Gemini plan. Choose a Flash model in Settings.`;
    }
    return 'You\'ve reached your Gemini usage limit for now. Wait a minute and try again, or choose another model.';
  }
  if (status === 403 || /PERMISSION_DENIED|not available in your (country|region)|location is not supported/i.test(message)) {
    return 'Google refused the request: the Gemini API may not be available for this key or in your region.';
  }
  if (status === 404 || /is not found|not supported for generateContent/i.test(message)) {
    return `${which}isn't available anymore. Choose another Gemini model in Settings.`;
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return 'Couldn\'t reach Google — check your internet connection, or choose a local model.';
  }
  return `Gemini reported an error: ${message.slice(0, 200) || `HTTP ${status}`}`;
}

// ─── When a model can't answer: another Gemini model takes over ──────────────
// A model that reached its free limit (per day or per minute), isn't in the
// key's plan, or was retired is set aside — for the day, a minute, or this
// session — and the next one in the list (best first) answers instead. Once a
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
 * reset), 'minute' (Google's "retry in Ns", else a minute). null: an error
 * every model would hit too (bad key, no internet, region).
 */
function classifyError(err, now = new Date()) {
  const status = err && (err.status || err.statusCode);
  const message = String((err && (err.message || err.responseBody)) || '');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message)) {
    if (/limit:\s*0\b/.test(message)) return { kind: 'not-in-plan', until: Infinity };
    if (/PerDay/i.test(message)) return { kind: 'daily', until: now.getTime() + msUntilPacificMidnight(now) };
    const retry = /retry in ([\d.]+)\s*s/i.exec(message) || /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
    return { kind: 'minute', until: now.getTime() + (retry ? Math.ceil(Number(retry[1])) : 60) * 1000 };
  }
  if (status === 404 || /is not found|not supported for generateContent|no longer available|has been deprecated/i.test(message)) {
    return { kind: 'gone', until: Infinity };
  }
  return null;
}

function markUnavailable(name, info) {
  unavailable.set(name, info);
}

/** Why a model is set aside right now ('daily', 'minute'…), or null. */
function unavailableKind(name) {
  return isAvailable(name) ? null : unavailable.get(name).kind;
}

function isAvailable(name, now = Date.now()) {
  const u = unavailable.get(name);
  if (!u) return true;
  if (now >= u.until) { unavailable.delete(name); return true; }
  return false;
}

/** The chosen model first (if it can answer), then the other Gemini models, best first. */
async function fallbackOrder(name) {
  let list = [];
  try { list = await listModels(); } catch { /* the chosen model alone */ }
  const others = list.map((m) => m.name).filter((n) => n !== name);
  return [name, ...others].filter((n) => isAvailable(n));
}

/** "reached its free limit for today", in words for the user. */
function unavailableReason(kind) {
  return {
    daily: 'reached its free limit for today',
    minute: 'reached its limit for this minute',
    'not-in-plan': 'isn\'t in your free plan',
    gone: 'isn\'t available anymore'
  }[kind] || 'can\'t answer right now';
}

function modelLabel(name) {
  const m = knownModel(name);
  return m ? m.label : modelId(name);
}

module.exports = {
  PREFIX,
  classifyError,
  markUnavailable,
  isAvailable,
  unavailableKind,
  fallbackOrder,
  unavailableReason,
  modelLabel,
  isCloudModel,
  modelId,
  encryptionAvailable,
  hasKey,
  setKey,
  clearKey,
  listModels,
  knownModel,
  recommendedModel,
  createModel,
  friendlyError,
  // for tests
  _internals: {
    chatModels, versionOf, fetchModels, msUntilPacificMidnight,
    setModels: (list) => { models = list; },
    resetUnavailable: () => unavailable.clear(),
    setDataDir: (dir) => { dataDirOverride = dir; cachedKey = undefined; models = null; }
  }
};
