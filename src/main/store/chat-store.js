// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { atomicWrite } = require('../utils/fs-utils');

/**
 * Storage layout
 * ──────────────
 *   <userData>/chats/sessions.json                      sessions + messages + resource METADATA only
 *   <userData>/chats/resources/<sessionId>/<resId>.json { pages: [...] }            (heavy content)
 *   <userData>/chats/resources/<sessionId>/<resId>.emb.json  chunk embeddings cache (optional)
 *   <userData>/chats/images/<sessionId>/<sha1>.img      attached image bytes; messages hold "ref:<sha1>"
 *
 * Keeping page text and image data out of sessions.json means every message
 * append no longer re-serialises every attached document and image, and
 * anything that scans sessions (e.g. the embedding pipeline) sees small
 * metadata objects instead of whole PDFs and megabytes of base64.
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

// ─── Message images (per-file) ───────────────────────────────────────────────

const IMAGE_REF_PREFIX = 'ref:';

function getImageDir(sessionId, create = false) {
  const dir = path.join(getChatsDir(), 'images', safeId(sessionId));
  if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Accepts raw base64 or a data: URL; returns just the base64 payload. */
function toBase64Payload(image) {
  const s = String(image || '');
  const comma = s.startsWith('data:') ? s.indexOf(',') : -1;
  return (comma >= 0 ? s.slice(comma + 1) : s).trim();
}

/** Saves one image to disk (deduplicated by content) and returns its "ref:<sha1>" reference. */
function storeImage(sessionId, image) {
  if (typeof image === 'string' && image.startsWith(IMAGE_REF_PREFIX)) return image;
  const b64 = toBase64Payload(image);
  if (!b64) return null;
  const id = crypto.createHash('sha1').update(b64).digest('hex');
  const file = path.join(getImageDir(sessionId, true), `${id}.img`);
  if (!fs.existsSync(file)) atomicWrite(file, Buffer.from(b64, 'base64'));
  return `${IMAGE_REF_PREFIX}${id}`;
}

/** "ref:<sha1>" → base64 string (the format the renderer and Ollama expect), or null if missing. */
function loadImage(sessionId, ref) {
  if (typeof ref !== 'string') return null;
  if (!ref.startsWith(IMAGE_REF_PREFIX)) return ref; // not migrated yet: already base64
  const id = ref.slice(IMAGE_REF_PREFIX.length).replace(/[^a-f0-9]/gi, '');
  try {
    return fs.readFileSync(path.join(getImageDir(sessionId), `${id}.img`)).toString('base64');
  } catch {
    return null;
  }
}

/**
 * Returns a copy of the session whose message images are real base64 data
 * instead of "ref:" references. Only needed where images are actually used
 * (showing the chat, sending history to the model) — everything else works
 * with the lightweight references.
 */
function withImageData(session) {
  if (!session) return session;
  return {
    ...session,
    messages: (session.messages || []).map((m) => (
      m.images && m.images.length > 0
        ? { ...m, images: m.images.map((ref) => loadImage(session.id, ref)).filter(Boolean) }
        : m
    ))
  };
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

/**
 * One-time migration: older versions stored every attached image as base64
 * inside sessions.json. Move each into its own file and keep a reference.
 */
function migrateLegacyImages(sessions) {
  let changed = false;
  for (const s of sessions) {
    for (const m of s.messages || []) {
      if (!Array.isArray(m.images) || m.images.every((img) => typeof img === 'string' && img.startsWith(IMAGE_REF_PREFIX))) continue;
      try {
        m.images = m.images.map((img) => storeImage(s.id, img)).filter(Boolean);
        changed = true;
      } catch { /* keep inline data if it couldn't be written out */ }
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
  const migratedResources = migrateLegacyResources(sessions);
  const migratedImages = migrateLegacyImages(sessions);
  if (migratedResources || migratedImages) saveSessions(sessions);
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

/**
 * @param {object} [options]
 * @param {boolean} [options.withImages=false] resolve image references into
 *   base64 data (for display and for the model). Off by default: most callers
 *   only need text/metadata, and loading images costs a disk read each.
 */
function getSession(id, { withImages = false } = {}) {
  const s = loadSessions().find((session) => session.id === id) || null;
  if (s && !s.resources) s.resources = [];
  return withImages ? withImageData(s) : s;
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

/**
 * @param {object} [extra]
 * @param {object[]} [extra.sources] memory passages offered for this answer (shown as chips)
 */
function appendMessage(sessionId, role, text, images = [], documents = [], extra = {}) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  if (!session.resources) session.resources = [];

  const message = { role, text, timestamp: Date.now() };
  if (images && images.length > 0) {
    message.images = images.map((img) => storeImage(sessionId, img)).filter(Boolean);
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
  if (Array.isArray(extra.sources) && extra.sources.length > 0) message.sources = extra.sources;
  // The "Thought process" steps shown while answering, so they're still there when the chat is reopened
  if (Array.isArray(extra.steps) && extra.steps.length > 0) {
    message.steps = extra.steps.filter((t) => typeof t === 'string' && t.trim()).slice(0, 80).map((t) => t.slice(0, 400));
  }
  if (extra.stopped) message.stopped = true;
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
  try { fs.rmSync(getImageDir(id), { recursive: true, force: true }); } catch {}
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