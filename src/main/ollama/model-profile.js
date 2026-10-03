// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the selected model is and what it needs — worked out from Ollama's own
 * description of the model (/api/show), so any model the user switches to is
 * handled without a hard-coded list:
 *
 *   capabilities  tools / vision / thinking, as Ollama reports them
 *   level         'guided' — a small model: the app helps it (checks whether an
 *                 answer needs the web, handles links and questions about the
 *                 user's chats itself); 'light' — a capable model (about 14B
 *                 parameters and up): it decides more on its own. The safety
 *                 nets (placeholders, hedging, wrong language…) apply to both.
 *   numCtx        context window: as large as fits in this computer's memory
 *                 next to the model (max 16K), never more than the model supports
 *
 * Overrides: ATHAR_ASSIST=guided|light, OLLAMA_NUM_CTX=<tokens>.
 */
const os = require('os');

const DEFAULT_CTX = 16384;
const CTX_STEPS = [16384, 8192, 4096];
const STRONG_MODEL_BILLION_PARAMS = 14;
const RESERVED_BYTES = 1.5 * 1024 ** 3; // Windows, the app, the search model (bge-m3)

/** "7.6B" → 7.6, "500M" → 0.5, or from general.parameter_count. */
function parameterBillions(show) {
  const size = show && show.details && show.details.parameter_size;
  const m = String(size || '').match(/([\d.]+)\s*([BMK])/i);
  if (m) return Number(m[1]) * ({ B: 1, M: 1e-3, K: 1e-6 }[m[2].toUpperCase()]);
  const count = show && show.model_info && show.model_info['general.parameter_count'];
  return Number.isFinite(count) ? count / 1e9 : null;
}

/** Architecture facts from model_info ("qwen2.context_length", "qwen2.block_count", …). */
function architecture(show) {
  const info = (show && show.model_info) || {};
  const arch = info['general.architecture'];
  const get = (key) => (arch && Number.isFinite(info[`${arch}.${key}`]) ? info[`${arch}.${key}`] : null);
  return {
    maxContext: get('context_length'),
    layers: get('block_count'),
    kvHeads: get('attention.head_count_kv') || get('attention.head_count'),
    heads: get('attention.head_count'),
    embedding: get('embedding_length'),
    keyLength: get('attention.key_length')
  };
}

/** Memory the model's context cache needs per token (bytes), from its architecture; a size-based guess otherwise. */
function kvBytesPerToken(arch, paramsB) {
  const headDim = arch.keyLength || (arch.embedding && arch.heads ? arch.embedding / arch.heads : null);
  if (arch.layers && arch.kvHeads && headDim) return 2 * arch.layers * arch.kvHeads * headDim * 2; // keys + values, 16-bit
  return (paramsB || 7) * 12 * 1024;
}

/** The largest context step that fits next to the model in this computer's memory. */
function chooseNumCtx({ sizeBytes, kvPerToken, maxContext, totalMemory = os.totalmem(), override = process.env.OLLAMA_NUM_CTX }) {
  if (Number(override) > 0) return Number(override);
  const budget = totalMemory * 0.75 - (sizeBytes || 0) - RESERVED_BYTES;
  for (const ctx of CTX_STEPS) {
    if (maxContext && ctx > maxContext) continue;
    if (!kvPerToken || kvPerToken * ctx <= budget) return ctx;
  }
  return Math.min(CTX_STEPS[CTX_STEPS.length - 1], maxContext || Infinity);
}

function chooseLevel(paramsB, override = process.env.ATHAR_ASSIST) {
  if (override === 'guided' || override === 'light') return override;
  return paramsB !== null && paramsB >= STRONG_MODEL_BILLION_PARAMS ? 'light' : 'guided';
}

/** Builds a profile from Ollama's /api/show answer and the installed size. */
function buildProfile(show, sizeBytes = null, opts = {}) {
  const capabilities = show && Array.isArray(show.capabilities) ? show.capabilities : null;
  const paramsB = parameterBillions(show);
  const arch = architecture(show);
  return {
    capabilities,
    tools: capabilities === null || capabilities.includes('tools'), // unknown (older Ollama): try tools
    vision: Boolean(capabilities && capabilities.includes('vision')),
    thinking: Boolean(capabilities && capabilities.includes('thinking')),
    paramsB,
    level: chooseLevel(paramsB, opts.assistOverride),
    numCtx: chooseNumCtx({ sizeBytes, kvPerToken: kvBytesPerToken(arch, paramsB), maxContext: arch.maxContext, ...opts })
  };
}

// ─── Hiding a thinking model's reasoning ─────────────────────────────────────
// Thinking models (Qwen3, DeepSeek-R1…) may write their reasoning inline as
// <think>…</think> before the answer. It must not show up as the answer.

const OPEN = '<think>';
const CLOSE = '</think>';

/** Reasoning removed from a finished text (also a lone "</think>" whose opening tag was in the prompt). */
function stripThinking(text) {
  let s = String(text || '');
  if (!s.includes('<think') && !s.includes(CLOSE)) return s;
  s = s.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  const lone = s.lastIndexOf(CLOSE);
  if (lone !== -1) s = s.slice(lone + CLOSE.length);
  return s.replace(/^\s+/, '');
}

/** How many characters at the end of `s` could be the start of `tag` (held back until we know). */
function partialTagLength(s, tag) {
  for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (s.endsWith(tag.slice(0, k))) return k;
  return 0;
}

/**
 * Streaming filter: passes answer text through, holds back what's inside
 * <think>…</think>. onThinking() when reasoning starts; onDiscard() when a lone
 * "</think>" shows that everything streamed so far was reasoning.
 */
function createThinkFilter({ onText, onThinking = () => {}, onDiscard = () => {} }) {
  let inside = false;
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      let out = '';
      for (;;) {
        if (inside) {
          const end = pending.indexOf(CLOSE);
          if (end === -1) { pending = pending.slice(pending.length - partialTagLength(pending, CLOSE)); break; }
          pending = pending.slice(end + CLOSE.length).replace(/^\s+/, '');
          inside = false;
          continue;
        }
        const start = pending.indexOf(OPEN);
        const loneEnd = pending.indexOf(CLOSE);
        if (loneEnd !== -1 && (start === -1 || loneEnd < start)) {
          // "…reasoning…</think> answer": the opening tag was part of the prompt
          out = '';
          onDiscard();
          pending = pending.slice(loneEnd + CLOSE.length).replace(/^\s+/, '');
          continue;
        }
        if (start === -1) {
          const keep = Math.max(partialTagLength(pending, OPEN), partialTagLength(pending, CLOSE));
          out += pending.slice(0, pending.length - keep);
          pending = pending.slice(pending.length - keep);
          break;
        }
        out += pending.slice(0, start);
        pending = pending.slice(start + OPEN.length);
        inside = true;
        onThinking();
      }
      if (out) onText(out);
    },
    flush() {
      if (!inside && pending) onText(pending);
      pending = '';
    }
  };
}

module.exports = {
  buildProfile, chooseNumCtx, chooseLevel, parameterBillions, architecture, kvBytesPerToken,
  stripThinking, createThinkFilter, DEFAULT_CTX, STRONG_MODEL_BILLION_PARAMS
};
