const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Storage layout
 * ──────────────
 *   <userData>/chats/sessions.json                      sessions + messages + resource METADATA only
 *   <userData>/chats/resources/<sessionId>/<resId>.json { pages: [...] }            (heavy content)
 *   <userData>/chats/resources/<sessionId>/<resId>.emb.json  chunk embeddings cache (optional)
 *
 * Keeping page text out of sessions.json means every message append no longer
 * re-serialises every attached document, and anything that scans sessions
 * (e.g. the embedding pipeline) sees small metadata objects instead of whole PDFs.
 */

function getChatsDir() {
  const dir = path.join(app.getPath('userData'), 'chats');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath() {
  return path.join(getChatsDir(), 'sessions.json');
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getResourceDir(sessionId, create = false) {
  const dir = path.join(getChatsDir(), 'resources', safeId(sessionId));
  if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resourceContentPath(sessionId, resId, create = false) {
  return path.join(getResourceDir(sessionId, create), `${safeId(resId)}.json`);
}

function resourceEmbeddingPath(sessionId, resId, create = false) {
  return path.join(getResourceDir(sessionId, create), `${safeId(resId)}.emb.json`);
}

/** Write via temp file + rename so a crash mid-write can't corrupt the store. */
function atomicWrite(filePath, data) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    fs.writeFileSync(filePath, data, 'utf-8'); // last resort
  }
}

// ─── Resource content (per-file) ─────────────────────────────────────────────

function writeResourceContent(sessionId, resId, pages) {
  atomicWrite(resourceContentPath(sessionId, resId, true), JSON.stringify({ pages }));
}

/** Returns { pages: [{ page, text, lineStart?, lineEnd? }] } or null if missing. */
function getResourceContent(sessionId, resId) {
  const p = resourceContentPath(sessionId, resId);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return data && Array.isArray(data.pages) ? data : null;
  } catch {
    return null;
  }
}

function getResourceEmbeddings(sessionId, resId) {
  const p = resourceEmbeddingPath(sessionId, resId);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function setResourceEmbeddings(sessionId, resId, data) {
  try { atomicWrite(resourceEmbeddingPath(sessionId, resId, true), JSON.stringify(data)); } catch {}
}

function removeResourceFiles(sessionId, resId) {
  for (const p of [resourceContentPath(sessionId, resId), resourceEmbeddingPath(sessionId, resId)]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * One-time migration: older versions stored full `pages`/`text` inline on
 * each session resource. Move that content into per-file storage.
 */
function migrateLegacyResources(sessions) {
  let changed = false;
  for (const s of sessions) {
    if (!Array.isArray(s.resources)) { s.resources = []; continue; }
    for (const r of s.resources) {
      if (!Array.isArray(r.pages) && typeof r.text !== 'string') continue;
      const pages = Array.isArray(r.pages) && r.pages.length > 0
        ? r.pages
        : [{ page: 1, text: r.text || '' }];
      try {
        writeResourceContent(s.id, r.id, pages);
      } catch { continue; } // keep inline data if we couldn't write it out
      r.hash = r.hash || sha1(pages.map((p) => p.text).join('\n'));
      r.charCount = r.charCount || pages.reduce((n, p) => n + (p.text || '').length, 0);
      r.pageCount = r.pageCount || pages.length;
      delete r.pages;
      delete r.text;
      changed = true;
    }
  }
  return changed;
}

function loadSessions() {
  const p = getStorePath();
  if (!fs.existsSync(p)) return [];
  let sessions;
  try {
    sessions = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
  if (!Array.isArray(sessions)) return [];
  if (migrateLegacyResources(sessions)) saveSessions(sessions);
  return sessions;
}

function saveSessions(sessions) {
  atomicWrite(getStorePath(), JSON.stringify(sessions));
}

function createSession(title = 'New chat') {
  const sessions = loadSessions();
  const session = {
    id: `s_${Date.now()}`,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [], // { role: 'user'|'assistant', text, timestamp, images?, documents? }
    resources: [] // METADATA only: { id, name, ext, size, pageCount, lineCount, charCount, hash, outline, ... }
  };
  sessions.unshift(session);
  saveSessions(sessions);
  return session;
}

function getSession(id) {
  const s = loadSessions().find((session) => session.id === id) || null;
  if (s && !s.resources) s.resources = [];
  return s;
}

// ─── Session resources ───────────────────────────────────────────────────────

function sha1(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}

function uniqueName(existingNames, name) {
  const lower = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * Registers `docData` on an IN-MEMORY session object (does not save
 * sessions.json — the caller does that exactly once). Content goes to its own
 * file. Returns { resource, reused }.
 *
 *  - identical content (same hash) → reuses the existing resource
 *  - same file name but different content → stored side by side as "name (2).ext"
 *    instead of silently clobbering the other file
 */
function upsertResource(session, docData) {
  if (!session.resources) session.resources = [];

  const pages = Array.isArray(docData.pages) && docData.pages.length > 0
    ? docData.pages
    : [{ page: 1, text: docData.text || '' }];
  const fullText = pages.map((p) => p.text || '').join('\n');
  const hash = docData.hash || sha1(fullText);

  const existing = session.resources.find((r) => r.hash === hash);
  if (existing) return { resource: existing, reused: true };

  const baseName = docData.name || 'untitled';
  const name = uniqueName(session.resources.map((r) => r.name), baseName);

  const resource = {
    id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    ext: docData.ext || path.extname(name).toLowerCase(),
    size: docData.size || 0,
    pageCount: docData.pageCount || pages.length,
    lineCount: docData.lineCount || 0,
    charCount: docData.charCount || fullText.length,
    hash,
    outline: Array.isArray(docData.outline) ? docData.outline : [],
    truncated: Boolean(docData.truncated),
    noText: Boolean(docData.noText),
    createdAt: Date.now()
  };

  writeResourceContent(session.id, resource.id, pages);
  session.resources.push(resource);
  session.updatedAt = Date.now();
  return { resource, reused: false };
}

/** Public: register a parsed document on a session and persist. Returns { resource, reused }. */
function addSessionResource(sessionId, docData) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const result = upsertResource(session, docData);
  saveSessions(sessions);
  return result;
}

/** Metadata list (no page content). */
function getSessionResources(sessionId) {
  const session = getSession(sessionId);
  if (!session) return [];
  return session.resources || [];
}

function removeSessionResource(sessionId, idOrName) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session || !session.resources) return false;

  const key = String(idOrName).toLowerCase();
  const removed = session.resources.filter((r) => r.id === idOrName || r.name.toLowerCase() === key);
  session.resources = session.resources.filter((r) => !removed.includes(r));
  removed.forEach((r) => removeResourceFiles(sessionId, r.id));
  saveSessions(sessions);
  return removed.length > 0;
}

// ─── Messages ────────────────────────────────────────────────────────────────

function appendMessage(sessionId, role, text, images = [], documents = []) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  if (!session.resources) session.resources = [];

  const message = { role, text, timestamp: Date.now() };
  if (images && images.length > 0) {
    message.images = images;
  }
  if (documents && documents.length > 0) {
    message.documents = documents.map((d) => {
      let ref = d;
      // Legacy path: caller passed a fully-parsed document. Register it on the
      // SAME in-memory session we're about to save, so the single save below
      // can't overwrite it (the old code saved a second, stale copy).
      if (d.pages || d.text) {
        ref = upsertResource(session, d).resource;
      }
      return {
        id: ref.id,
        name: ref.name,
        ext: ref.ext,
        size: ref.size,
        pageCount: ref.pageCount,
        lineCount: ref.lineCount,
        charCount: ref.charCount
      };
    });
  }
  session.messages.push(message);
  session.updatedAt = Date.now();

  // Auto-title the session from the first user message if still default
  if (role === 'user' && session.title === 'New chat' && session.messages.length === 1) {
    const titleBase = text || (documents && documents[0] ? documents[0].name : 'Uploaded document');
    session.title = titleBase.slice(0, 40) + (titleBase.length > 40 ? '…' : '');
  }

  saveSessions(sessions);
  return message;
}

function deleteSession(id) {
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);
  try { fs.rmSync(getResourceDir(id), { recursive: true, force: true }); } catch {}
}

function renameSession(id, title) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.title = title;
    saveSessions(sessions);
  }
}

module.exports = {
  loadSessions,
  createSession,
  getSession,
  addSessionResource,
  getSessionResources,
  getResourceContent,
  getResourceEmbeddings,
  setResourceEmbeddings,
  removeSessionResource,
  appendMessage,
  deleteSession,
  renameSession
};