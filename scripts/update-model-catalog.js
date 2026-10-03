// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rebuilds src/renderer/model-catalog.js: every chat model in the Ollama
 * library, in every size, with what it needs to run in Athar.
 *
 *   node scripts/update-model-catalog.js
 *
 * Everything comes from Ollama's own data, not guesses:
 *   ollama.com/library             families, descriptions, sizes, capabilities
 *   registry manifests             exact download size of each size (tag)
 *   the model file's GGUF header   architecture: layers, attention heads, context length
 *   the chat template              tool calling ({{ .Tools }})
 *
 * Requirements follow the rules Athar itself uses (src/main/ollama/model-profile.js):
 * the chat context is 16K tokens when the computer's memory allows it (4K at least),
 * Athar keeps 1.5 GB for Windows, itself and the search model, and the model
 * plus its context may use up to 75% of the computer's memory.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'renderer', 'model-catalog.js');
const LIBRARY = 'https://ollama.com/library?sort=popular';
const REG = 'https://registry.ollama.ai/v2/library';
const GiB = 1024 ** 3;

const CTX_FULL = 16384;
const CTX_MIN = 4096;
const RESERVED = 1.5 * GiB;   // model-profile.js RESERVED_BYTES
const MEMORY_SHARE = 0.75;    // model-profile.js: totalMemory * 0.75

// Not chat assistants: safety classifiers, OCR, extraction, SQL, translation- or function-call-only models
const NOT_CHAT = new Set(['llama-guard3', 'shieldgemma', 'granite3-guardian', 'granite4.1-guardian', 'gpt-oss-safeguard',
  'bespoke-minicheck', 'deepseek-ocr', 'glm-ocr', 'nuextract', 'reader-lm', 'duckdb-nsql', 'sqlcoder', 'translategemma', 'functiongemma']);

// Written for Athar; other models use the first sentence of Ollama's description
const CURATED = {
  'qwen3:0.6b': 'Tiny model for very old or low-memory PCs. Thinks before answering; limited knowledge.',
  'gemma3:1b': 'Google lightweight model. Fast, low resource use; basic answers.',
  'qwen2.5:1.5b': 'Good balance of speed and multilingual understanding for small PCs.',
  'deepseek-r1:1.5b': 'Small reasoning model: thinks step by step before answering (slower replies).',
  'llama3.2:1b': 'Meta lightweight model. Quick summaries and simple chat.',
  'qwen3:1.7b': 'Small Qwen 3: tools, multilingual, can think before answering.',
  'qwen3-vl:2b': 'Smallest Qwen 3 vision model: reads images and screenshots.',
  'qwen2.5:3b': 'Multilingual reasoning, tool calling and history search on modest hardware.',
  'llama3.2:3b': 'Meta efficient model. Good instruction following and writing.',
  'phi4-mini': 'Microsoft compact model. Strong at math and logic.',
  'qwen3:4b': 'Capable small model: tools, 100+ languages, thinks before hard answers.',
  'qwen2.5vl:3b': 'Compact vision model: understands images and screenshots.',
  'qwen3-vl:4b': 'Qwen 3 vision model: images, screenshots and documents.',
  'gemma3:4b': 'Google model with vision and 140+ languages. Reads images and screenshots.',
  'mistral': 'Classic 7B model. Solid writing and code.',
  'deepseek-r1:7b': 'Reasoning model: thinks step by step (slower, strong at math and logic).',
  'qwen2.5:7b': 'Strong all-round 7B: multilingual (incl. Arabic) with reliable tool calling.',
  'qwen2.5-coder:7b': 'Code-focused 7B with reliable tool calling for project folder and Git questions.',
  'llama3.1:8b': 'Meta 8B model. Good reasoning and longer tasks.',
  'deepseek-r1:8b': 'Reasoning model on a Qwen 3 base: thinks step by step (slower, stronger on hard problems).',
  'qwen3:8b': 'Newer Qwen generation: tools, 100+ languages, thinks before hard answers. A strong all-rounder.',
  'qwen2.5vl:7b': 'Stronger vision model: image understanding and document reading.',
  'qwen3-vl:8b': 'Qwen 3 vision model: images, charts and documents with better reasoning.',
  'llama3.2-vision:11b': 'Meta vision model. Image understanding and document reading.',
  'gemma3:12b': 'Powerful multimodal model. Reasoning, coding and visual document analysis.',
  'deepseek-r1:14b': 'Stronger reasoning model: thinks step by step.',
  'qwen2.5:14b': 'Higher-tier reasoning and long documents.',
  'qwen2.5-coder:14b': 'Stronger coding model with tool calling.',
  'phi4': 'Microsoft 14B model for logic and math.',
  'qwen3:14b': 'Capable Qwen 3: tools, multilingual, thinks before hard answers. Strong enough to search the web.',
  'gpt-oss:20b': 'OpenAI open-weight reasoning model with tools.',
  'mistral-small3.2:24b': 'Strong multilingual model with vision and tools.',
  'gemma3:27b': 'Google flagship open model with vision.',
  'qwen3:30b': 'Mixture-of-experts: runs faster than its size suggests, but needs memory for all of it.',
  'qwen3-coder:30b': 'Qwen 3 coding model with tools.',
  'qwen3:32b': 'Top Qwen 3 dense model.',
  'llama3.3:70b': 'Enterprise-grade 70B model.',
  'qwen2.5:72b': 'Top-of-the-line 72B model.'
};

// ── ollama.com/library ──────────────────────────────────────────────────────
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function parseLibrary(html) {
  const out = [];
  for (const part of html.split('<a href="/library/').slice(1)) {
    if (!part.slice(0, 200).includes('class="group w-full space-y-5"')) continue;
    const name = part.slice(0, part.indexOf('"'));
    const end = part.indexOf('</a>');
    const block = part.slice(0, end > 0 ? end : 6000);
    const desc = decode(((block.match(/<p class="max-w-lg[^"]*">([\s\S]*?)<\/p>/) || [])[1] || '').replace(/\s+/g, ' ').trim());
    const caps = [...block.matchAll(/bg-indigo-50[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    const sizes = [...block.matchAll(/bg-\[#ddf4ff\][^>]*>([^<]+)</g)].map((m) => m[1].trim());
    const pulls = (block.match(/<span[^>]*>([\d.]+[KMB]?)<\/span>\s*<span class="hidden sm:flex">&nbsp;Pulls/) || [])[1] || '0';
    out.push({ name, desc, caps, sizes, pulls: parseFloat(pulls) * ({ K: 1e3, M: 1e6, B: 1e9 }[pulls.slice(-1)] || 1) });
  }
  return out;
}

async function get(url, opts = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, { ...opts, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    } catch (err) {
      if (i >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ── The GGUF header (key/values only), read from the first megabytes of the file ──
function readGguf(buf) {
  let o = 0;
  const need = (n) => { if (o + n > buf.length) throw new RangeError('more'); };
  const SIZES = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const READ = {
    0: (p) => buf.readUInt8(p), 1: (p) => buf.readInt8(p), 2: (p) => buf.readUInt16LE(p), 3: (p) => buf.readInt16LE(p),
    4: (p) => buf.readUInt32LE(p), 5: (p) => buf.readInt32LE(p), 6: (p) => buf.readFloatLE(p), 7: (p) => buf.readUInt8(p),
    10: (p) => Number(buf.readBigUInt64LE(p)), 11: (p) => Number(buf.readBigInt64LE(p)), 12: (p) => buf.readDoubleLE(p)
  };
  const scalar = (t) => { need(SIZES[t]); const v = READ[t](o); o += SIZES[t]; return v; };
  const u64 = () => scalar(10);
  const str = () => { const n = u64(); need(n); const s = buf.toString('utf8', o, o + n); o += n; return s; };
  const kv = {};
  if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'GGUF') return { kv, gguf: false };
  try {
    o = 4; scalar(4); u64();
    const count = u64();
    for (let i = 0; i < count; i++) {
      const key = str();
      const t = scalar(4);
      if (t === 8) kv[key] = str();
      else if (t === 9) {
        const it = scalar(4);
        const n = u64();
        if (it === 8) { for (let j = 0; j < n; j++) str(); kv[key] = null; }
        else if (n <= 4096) { const a = []; for (let j = 0; j < n; j++) a.push(scalar(it)); kv[key] = a; }
        else { need(n * SIZES[it]); o += n * SIZES[it]; kv[key] = null; }
      } else kv[key] = scalar(t);
    }
    return { kv, gguf: true, complete: true };
  } catch (err) {
    if (err instanceof RangeError) return { kv, gguf: true, complete: false };
    throw err;
  }
}

async function ggufHeader(repo, digest) {
  for (const mb of [2, 16, 64]) {
    const res = await get(`${REG}/${repo}/blobs/${digest}`, { headers: { Range: `bytes=0-${mb * 1024 * 1024 - 1}` } });
    if (!res.ok) throw new Error(`model file: HTTP ${res.status}`);
    const { kv, gguf, complete } = readGguf(Buffer.from(await res.arrayBuffer()));
    if (!gguf) return {};
    const arch = kv['general.architecture'];
    if (complete || (arch && kv[`${arch}.block_count`] !== undefined && Object.keys(kv).some((k) => k.startsWith('tokenizer.')))) return kv;
  }
  throw new Error('model header too large');
}

/** Context cache per token (16-bit keys + values), counting only the layers that have attention — as model-profile.js does. */
function kvPerToken(kv) {
  const arch = kv['general.architecture'];
  const g = (k) => kv[`${arch}.${k}`];
  const layers = g('block_count');
  const heads = g('attention.head_count');
  const kvHeads = g('attention.head_count_kv') ?? heads;
  const headsN = Array.isArray(heads) ? Math.max(...heads) : heads;
  const kDim = g('attention.key_length') || (g('embedding_length') && headsN ? g('embedding_length') / headsN : null);
  const vDim = g('attention.value_length') || kDim;
  if (!layers || kvHeads === undefined || !kDim) return null;
  const lora = g('attention.kv_lora_rank'); // DeepSeek V2/V3: one compressed cache per layer
  if (lora) return layers * (lora + (g('rope.dimension_count') || 64)) * 2;
  const totalKvHeads = Array.isArray(kvHeads) ? kvHeads.reduce((a, b) => a + b, 0) : kvHeads * layers;
  return totalKvHeads * (kDim + vDim) * 2;
}

async function manifest(repo, tag) {
  const res = await get(`${REG}/${repo}/manifests/${tag}`, { headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  return res.json();
}

const layer = (man, type) => (man.layers || []).find((l) => l.mediaType === `application/vnd.ollama.image.${type}`);

async function describeTag(fam, tag) {
  const man = await manifest(fam.name, tag);
  if (!man) return { skip: 'no such size' };
  const model = layer(man, 'model');
  if (!model) return { skip: 'cloud only, nothing to download' };
  const projector = layer(man, 'projector');
  const tmpl = layer(man, 'template');
  const config = await (await get(`${REG}/${fam.name}/blobs/${man.config.digest}`)).json().catch(() => ({}));
  const template = tmpl ? await (await get(`${REG}/${fam.name}/blobs/${tmpl.digest}`)).text() : '';
  const kv = await ggufHeader(fam.name, model.digest);
  const arch = kv['general.architecture'];
  return {
    tag,
    modelDigest: model.digest,
    weights: model.size + (projector ? projector.size : 0),
    download: man.layers.reduce((n, l) => n + l.size, 0),
    params: config.model_type || null,
    quant: config.file_type || null,
    maxContext: (arch && kv[`${arch}.context_length`]) || null,
    kvPerToken: arch ? kvPerToken(kv) : null,
    experts: arch && kv[`${arch}.expert_count`] ? [kv[`${arch}.expert_used_count`], kv[`${arch}.expert_count`]] : null,
    tools: template ? /\.Tools\b/.test(template) : fam.caps.includes('tools'),
    thinking: fam.caps.includes('thinking') || /\.Think(ing)?\b|<think>/.test(template),
    vision: Boolean(projector) || Object.keys(kv).some((k) => /\.vision\.|^clip\./.test(k)) || (!arch && fam.caps.includes('vision'))
  };
}

// ── Names ───────────────────────────────────────────────────────────────────
const BRANDS = {
  qwen: 'Qwen', qwq: 'QwQ', llama: 'Llama', gemma: 'Gemma', codegemma: 'CodeGemma', medgemma: 'MedGemma', deepseek: 'DeepSeek', gpt: 'GPT', oss: 'OSS',
  phi: 'Phi', mistral: 'Mistral', mixtral: 'Mixtral', ministral: 'Ministral', mathstral: 'Mathstral', codestral: 'Codestral', devstral: 'Devstral',
  magistral: 'Magistral', glm: 'GLM', granite: 'Granite', olmo: 'OLMo', lfm: 'LFM', smollm: 'SmolLM', minicpm: 'MiniCPM', llava: 'LLaVA',
  exaone: 'EXAONE', vl: 'VL', moe: 'MoE', hermes: 'Hermes', openhermes: 'OpenHermes', nemotron: 'Nemotron', internlm: 'InternLM', yi: 'Yi',
  codellama: 'Code Llama', starcoder: 'StarCoder', wizardlm: 'WizardLM', wizardcoder: 'WizardCoder', tinyllama: 'TinyLlama', aya: 'Aya',
  cogito: 'Cogito', falcon: 'Falcon', solar: 'Solar', openchat: 'OpenChat', dolphin: 'Dolphin', moondream: 'Moondream', bakllava: 'BakLLaVA',
  command: 'Command', r7b: 'R7B', minimax: 'MiniMax', kimi: 'Kimi', tulu: 'Tülu', openthinker: 'OpenThinker', deepcoder: 'DeepCoder',
  deepscaler: 'DeepScaleR', codeqwen: 'CodeQwen', sailor: 'Sailor', stablelm: 'StableLM', vicuna: 'Vicuna', zephyr: 'Zephyr', orca: 'Orca'
};
function prettyFamily(name) {
  return name.split('-').map((part) => {
    if (BRANDS[part]) return BRANDS[part];
    const m = part.match(/^([a-z]+)([\d.]+)([a-z]*)$/);
    if (m) {
      const brand = BRANDS[m[1]] || m[1][0].toUpperCase() + m[1].slice(1);
      // "qwen2.5vl" → "Qwen 2.5 VL", "gemma3n" → "Gemma 3n"
      const tail = !m[3] ? '' : BRANDS[m[3]] ? ` ${BRANDS[m[3]]}` : m[3].length === 1 ? m[3] : ` ${m[3].toUpperCase()}`;
      return m[1].length === 1 ? `${brand.toUpperCase()}${m[2]}${tail}` : `${brand} ${m[2]}${tail}`;
    }
    if (/^[a-z]?\d/.test(part)) return part.toUpperCase();
    return part[0].toUpperCase() + part.slice(1);
  }).join(' ');
}
const prettySize = (tag, params) => (tag === 'latest' ? (params || '').replace(/(\.\d)\d+/, '$1') : tag.toUpperCase());

function shortDesc(text) {
  const first = (text.match(/^.*?[.!?](\s|$)/) || [text])[0].trim();
  return first.length > 170 ? `${first.slice(0, 167).replace(/\s+\S*$/, '')}…` : first;
}

// ── Requirements ────────────────────────────────────────────────────────────
const gib = (bytes) => Math.ceil((bytes / GiB) * 10) / 10;
function requirements(t) {
  const kv = t.kvPerToken || 0;
  const full = Math.min(CTX_FULL, t.maxContext || CTX_FULL);
  const min = Math.min(CTX_MIN, t.maxContext || CTX_MIN);
  return {
    ctx: full,
    // Graphics memory to run all of it on the graphics card, with the full context (+ working buffers)
    vram: gib(t.weights * 1.05 + kv * full + 0.5 * GiB),
    // Computer memory (RAM) without a capable graphics card: Athar's own rule
    ram: gib((t.weights + RESERVED + kv * full) / MEMORY_SHARE),
    ramMin: gib((t.weights + RESERVED + kv * min) / MEMORY_SHARE)
  };
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

(async () => {
  const html = await (await get(LIBRARY)).text();
  const families = parseLibrary(html).filter((f) => !f.caps.includes('embedding') && !NOT_CHAT.has(f.name));
  if (families.length < 100) throw new Error(`only ${families.length} families found — has ollama.com changed?`);
  const skipped = [];
  let done = 0;
  const jobs = families.flatMap((f) => (f.sizes.length ? f.sizes : ['latest']).map((tag) => ({ f, tag })));
  const rows = await pool(jobs, 10, async ({ f, tag }) => {
    try {
      const t = await describeTag(f, tag);
      if (++done % 50 === 0) console.log(`${done}/${jobs.length}`);
      if (t.skip) { skipped.push(`${f.name}:${tag} (${t.skip})`); return null; }
      return { f, t };
    } catch (err) {
      skipped.push(`${f.name}:${tag} (error: ${err.message})`);
      return null;
    }
  });
  // Which size "family" alone (= :latest) gets, so "mistral" and "mistral:7b" are one entry
  const latest = await pool(families, 10, async (f) => {
    try { const m = await manifest(f.name, 'latest'); return m && layer(m, 'model') ? layer(m, 'model').digest : null; } catch { return null; }
  });
  const latestOf = new Map(families.map((f, i) => [f.name, latest[i]]));

  const entries = rows.filter(Boolean).map(({ f, t }) => {
    const isLatest = t.tag === 'latest' || latestOf.get(f.name) === t.modelDigest;
    const name = t.tag === 'latest' ? f.name : `${f.name}:${t.tag}`;
    const desc = CURATED[name] || (isLatest && CURATED[f.name]) || shortDesc(f.desc);
    return {
      name,
      ...(isLatest && t.tag !== 'latest' ? { aliases: [f.name] } : {}),
      family: f.name,
      label: `${prettyFamily(f.name)} · ${prettySize(t.tag, t.params)}`,
      params: t.params,
      quant: t.quant,
      ...(t.experts ? { experts: t.experts } : {}),
      sizeBytes: t.download,
      ...requirements(t),
      maxContext: t.maxContext,
      tools: t.tools,
      vision: t.vision,
      thinking: t.thinking,
      popularity: f.pulls,
      desc
    };
  }).sort((a, b) => a.sizeBytes - b.sizeBytes || a.name.localeCompare(b.name));

  const lines = entries.map((e) => `  ${JSON.stringify(e)}`);
  fs.writeFileSync(OUT, `// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated by scripts/update-model-catalog.js on ${new Date().toISOString().slice(0, 10)} — don't edit by hand.
// Every chat model in the Ollama library, in every size (${entries.length} in all), smallest first.
//   sizeBytes   download size
//   vram        GB of graphics memory to run it all on the graphics card, with a ${CTX_FULL / 1024}K context
//   ram         GB of computer memory to run it without a capable graphics card (${CTX_FULL / 1024}K context)
//   ramMin      the least computer memory it runs with (${CTX_MIN / 1024}K context)
//   ctx         the context Athar gives it; maxContext what the model supports
// eslint-disable-next-line no-unused-vars
const MODEL_CATALOG = [
${lines.join(',\n')}
];
`);
  console.log(`${entries.length} models written to ${path.relative(process.cwd(), OUT)}`);
  if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
})().catch((err) => { console.error(err); process.exit(1); });
