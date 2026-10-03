// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Splits a conversation into passages ("chunks") for search.
 *
 * Previously each whole conversation got ONE embedding of its first 2,000
 * characters, so anything later in a long chat was unfindable and a match
 * returned the entire conversation. Chunks are small windows of consecutive
 * messages, so search finds the exact part of a conversation that matters
 * and can cite it (message range).
 *
 * Deterministic: the same thread always yields the same chunks, so chunk
 * keys (content hashes) can be used to reuse embeddings across restarts and
 * re-imports without storing chunk text twice.
 */
const crypto = require('crypto');

const TARGET_CHARS = 1200; // ~300 tokens — small enough to be specific, big enough for context
const MAX_CHARS = 1600;

function roleLabel(role) {
  return role === 'user' ? 'User' : 'Assistant';
}

/** Splits one long message into pieces at paragraph/sentence boundaries. */
function splitLongText(text, maxChars = TARGET_CHARS) {
  const pieces = [];
  let rest = String(text);
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('\n\n', maxChars);
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('\n', maxChars);
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf('. ', maxChars) + 1;
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * @param {{ id, title, messages: [{ role, text, createTime? }], createTime? }} thread
 * @returns {Array<{ threadId, index, msgStart, msgEnd, text, time }>}
 */
function chunkThread(thread) {
  const chunks = [];
  const messages = thread.messages || [];
  let buf = [];
  let bufChars = 0;
  let start = 0;
  let time = null;

  const flush = (endIdx) => {
    if (buf.length === 0) return;
    chunks.push({
      threadId: thread.id,
      index: chunks.length,
      msgStart: start,
      msgEnd: endIdx,
      text: buf.join('\n'),
      time: time || thread.createTime || null
    });
    buf = [];
    bufChars = 0;
    time = null;
  };

  messages.forEach((m, i) => {
    const text = String(m.text || '').trim();
    if (!text) return;
    const line = `${roleLabel(m.role)}: ${text}`;

    if (line.length > MAX_CHARS) {
      // A long message becomes its own chunk(s); earlier buffered messages go first.
      flush(i - 1);
      for (const piece of splitLongText(text)) {
        start = i;
        time = m.createTime || null;
        buf = [`${roleLabel(m.role)}: ${piece}`];
        flush(i);
      }
      start = i + 1;
      return;
    }

    if (buf.length > 0 && bufChars + line.length > TARGET_CHARS) {
      flush(i - 1);
      start = i;
    }
    if (buf.length === 0) {
      start = i;
      time = m.createTime || null;
    }
    buf.push(line);
    bufChars += line.length + 1;
  });
  flush(messages.length - 1);
  return chunks;
}

/** Text that gets embedded: title gives the passage its conversation context. */
function embeddingText(thread, chunk) {
  return `${thread.title || 'Conversation'}\n${chunk.text}`;
}

/** Content-addressed key: same text + same embedding model → same key → reuse the stored vector. */
function chunkKey(modelId, text) {
  return crypto.createHash('sha1').update(`${modelId}\u0000${text}`).digest('hex').slice(0, 24);
}

module.exports = { chunkThread, embeddingText, chunkKey, splitLongText, TARGET_CHARS };
