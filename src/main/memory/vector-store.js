// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Content-addressed store of chunk embeddings.
 *
 *   vectors.json  { model, dim, keys: [chunkKey, ...] }   (row order of vectors.bin)
 *   vectors.bin   rows of `dim` signed bytes (int8)
 *
 * Vectors are L2-normalised and quantised to int8 (value × 127), so a dot
 * product of two rows ÷ 127² ≈ cosine similarity. That is ~10× smaller than
 * the old JSON float cache — 1 KB per 1024-dim chunk — and fast to scan.
 *
 * Keys are hashes of (model + exact embedded text): unchanged text is never
 * re-embedded, and save() drops vectors whose text no longer exists, so the
 * store can't grow without bound the way the old whole-thread cache did.
 */
const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('../utils/fs-utils');

class VectorStore {
  constructor(dir, model) {
    this.dir = dir;
    this.model = model;
    this.dim = 0;
    this.rows = new Map(); // key → Int8Array
    this.dirty = false;
  }

  get metaPath() { return path.join(this.dir, 'vectors.json'); }
  get binPath() { return path.join(this.dir, 'vectors.bin'); }

  load() {
    this.rows.clear();
    try {
      const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
      if (meta.model !== this.model || !meta.dim) return; // different embedding model → start over
      const buf = fs.readFileSync(this.binPath);
      if (buf.length !== meta.keys.length * meta.dim) return; // incomplete write → start over
      this.dim = meta.dim;
      const all = new Int8Array(buf.buffer, buf.byteOffset, buf.length);
      meta.keys.forEach((key, i) => this.rows.set(key, all.subarray(i * meta.dim, (i + 1) * meta.dim)));
    } catch {
      // missing or unreadable → empty store; everything will be (re)embedded
    }
  }

  has(key) { return this.rows.has(key); }
  get(key) { return this.rows.get(key) || null; }
  get size() { return this.rows.size; }

  /** Stores a float embedding (any scale) as a normalised int8 row. */
  set(key, embedding) {
    const vec = quantize(embedding);
    if (!vec) return;
    if (!this.dim) this.dim = vec.length;
    if (vec.length !== this.dim) return;
    this.rows.set(key, vec);
    this.dirty = true;
  }

  /** Writes to disk, keeping only `liveKeys` (if given). */
  save(liveKeys = null) {
    if (liveKeys) {
      for (const key of [...this.rows.keys()]) {
        if (!liveKeys.has(key)) { this.rows.delete(key); this.dirty = true; }
      }
    }
    if (!this.dirty) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const keys = [...this.rows.keys()];
    const bin = Buffer.alloc(keys.length * this.dim);
    keys.forEach((key, i) => bin.set(new Uint8Array(this.rows.get(key).buffer, this.rows.get(key).byteOffset, this.dim), i * this.dim));
    // Binary first, then the index that describes it: a crash in between
    // leaves a size mismatch, which load() detects (and then re-embeds).
    atomicWrite(this.binPath, bin);
    atomicWrite(this.metaPath, JSON.stringify({ model: this.model, dim: this.dim, keys }));
    this.dirty = false;
  }
}

function quantize(embedding) {
  if (!embedding || !embedding.length) return null;
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  if (!norm) return null;
  const out = new Int8Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round((embedding[i] / norm) * 127)));
  }
  return out;
}

/** Cosine similarity between two quantised rows (≈ exact cosine of the originals). */
function cosineInt8(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot / (127 * 127);
}

module.exports = { VectorStore, quantize, cosineInt8 };
