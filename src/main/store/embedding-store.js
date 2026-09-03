const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

function getCachePath() {
  const dir = path.join(app.getPath('userData'), 'embeddings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'cache.json');
}

function getThreadsStorePath() {
  const dir = path.join(app.getPath('userData'), 'history');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'threads.json');
}

/**
 * Loads all previously persisted threads (with their embeddings) from disk on app start.
 */
function loadPersistedThreads() {
  const p = getThreadsStorePath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Saves the full active array of embedded threads to disk.
 */
function savePersistedThreads(threads) {
  const p = getThreadsStorePath();
  fs.writeFileSync(p, JSON.stringify(threads), 'utf-8');
}

/**
 * Merges newly imported threads with existing threads.
 * If a thread ID already exists, checks if the incoming thread contains new prompts/messages.
 * If new messages exist, updates the thread's messages & fullText; otherwise keeps existing.
 */
function mergeThreads(existingThreads = [], incomingThreads = []) {
  const map = new Map();
  for (const t of existingThreads) {
    map.set(t.id, { ...t });
  }

  for (const inc of incomingThreads) {
    if (!map.has(inc.id)) {
      map.set(inc.id, inc);
    } else {
      const current = map.get(inc.id);
      const currentCount = current.messages ? current.messages.length : 0;
      const incCount = inc.messages ? inc.messages.length : 0;

      // If incoming thread has more messages or different content, merge/update
      if (incCount > currentCount || inc.fullText !== current.fullText) {
        map.set(inc.id, {
          ...current,
          ...inc,
          // invalidate embedding if content changed so splitByCache can re-embed
          embedding: (inc.fullText === current.fullText) ? current.embedding : undefined
        });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Stable content hash for a thread.
 * We hash title + fullText — content changes = hash changes.
 */
function threadHash(thread) {
  const content = `${thread.id}||${thread.title}||${thread.fullText}`;
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Loads the full embedding cache from disk.
 * Returns a Map of hash -> { embedding, title, cachedAt }
 */
function loadCache() {
  const p = getCachePath();
  if (!fs.existsSync(p)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/**
 * Saves entries back to disk.
 * Merges with existing cache so entries from previous imports are preserved.
 */
function saveCache(entries) {
  const p = getCachePath();
  let existing = {};
  try {
    if (fs.existsSync(p)) existing = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  const merged = { ...existing, ...Object.fromEntries(entries) };
  fs.writeFileSync(p, JSON.stringify(merged), 'utf-8');
}

/**
 * Given a list of parsed threads, splits them into:
 *   cached   — threads whose embeddings are already on disk (attach .embedding directly)
 *   uncached — threads that need to be sent to Ollama
 *
 * Returns { cached, uncached, hashMap }
 * hashMap: thread.id -> hash, used to save new embeddings after they're computed
 */
function splitByCache(threads) {
  const cache   = loadCache();
  const cached   = [];
  const uncached = [];
  const hashMap  = new Map(); // threadId -> hash

  for (const t of threads) {
    const hash = threadHash(t);
    hashMap.set(t.id, hash);

    if (t.embedding) {
      cached.push(t);
    } else if (cache.has(hash)) {
      cached.push({ ...t, embedding: cache.get(hash).embedding });
    } else {
      uncached.push(t);
    }
  }

  return { cached, uncached, hashMap };
}

/**
 * Persists newly-computed embeddings to disk.
 * Called after embedThreads() returns results for the uncached subset.
 *
 * @param {Array}  embeddedThreads  - threads with fresh .embedding from Ollama
 * @param {Map}    hashMap          - threadId -> hash from splitByCache()
 */
function cacheNewEmbeddings(embeddedThreads, hashMap) {
  const entries = new Map();
  for (const t of embeddedThreads) {
    const hash = hashMap.get(t.id);
    if (hash && t.embedding) {
      entries.set(hash, {
        embedding: t.embedding,
        title: t.title,
        cachedAt: Date.now()
      });
    }
  }
  if (entries.size > 0) saveCache(entries);
}

/**
 * Returns basic cache stats for the UI.
 */
function getCacheStats() {
  const cache = loadCache();
  return { totalCached: cache.size };
}

module.exports = {
  threadHash,
  splitByCache,
  cacheNewEmbeddings,
  getCacheStats,
  loadPersistedThreads,
  savePersistedThreads,
  mergeThreads
};
