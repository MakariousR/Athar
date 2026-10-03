// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Portable memory profile: a short, user-reviewed summary of who the user is,
 * distilled from their own messages across ChatGPT, Claude, Gemini and this
 * app — usable inside this app and exportable as custom instructions for any
 * other assistant ("carry your memory between AIs").
 *
 * Built for a small local model:
 *   1. extraction — batches of the user's OWN messages (facts about the user
 *      live there; assistant replies are mostly general knowledge) → strict
 *      "TAG: fact" lines, a format 7B models follow reliably
 *   2. grounding  — in code: facts whose words don't occur in the messages
 *      they came from are dropped (invented specifics, guessed styles, filler)
 *   3. merging    — in code: de-duplicate, count how many conversations
 *      support each fact and when it was last seen, rank
 *   4. assembly   — in code, from the surviving facts only. A model "writing"
 *      pass was tried and removed: a 7B model re-invented content (whole
 *      sections with no supporting facts) after the grounding check.
 * The user reviews and edits the result before it's used or exported.
 */
const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('../utils/fs-utils');
const { tokenize } = require('./bm25');

const CATEGORIES = {
  ABOUT: 'About me',
  PROJECT: 'Projects',
  TECH: 'Tools & tech',
  PREFERENCE: 'How I like answers',
  GOAL: 'Goals & interests'
};
const CATEGORIES_AR = {
  ABOUT: 'عنّي',
  PROJECT: 'مشاريعي',
  TECH: 'الأدوات والتقنيات',
  PREFERENCE: 'كيف أفضّل الإجابات',
  GOAL: 'أهدافي واهتماماتي'
};
const headingsFor = (language) => (language === 'Arabic' ? CATEGORIES_AR : CATEGORIES);
const PREFERENCE_HEADINGS = new Set([CATEGORIES.PREFERENCE, CATEGORIES_AR.PREFERENCE]);

const BATCH_CHARS = 6000;
const MAX_FACTS_PER_SECTION = 6;
const PER_CONVERSATION_CHARS = 1400;
const PER_MESSAGE_CHARS = 500;
const PROFILE_MAX_CHARS = 3000;       // injected into chats — keep it small
const CHATGPT_FIELD_LIMIT = 1500;     // ChatGPT custom-instruction field size

class ProfileStore {
  constructor(dir) {
    this.file = path.join(dir, 'profile.json');
  }

  get() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { markdown: '', enabled: false, generatedAt: null, conversationsUsed: 0, edited: false };
    }
  }

  save(patch) {
    const next = { ...this.get(), ...patch, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    atomicWrite(this.file, JSON.stringify(next, null, 2));
    return next;
  }
}

/** Most recent conversations → compact "your messages" excerpts. */
function collectMaterial(threads, maxConversations) {
  return [...threads]
    .filter((t) => t.messages.some((m) => m.role === 'user'))
    .sort((a, b) => (b.updateTime || b.createTime || 0) - (a.updateTime || a.createTime || 0))
    .slice(0, maxConversations)
    .map((t) => {
      let text = '';
      for (const m of t.messages) {
        if (m.role !== 'user') continue;
        const msg = m.text.replace(/\s+/g, ' ').trim().slice(0, PER_MESSAGE_CHARS);
        if (!msg) continue;
        if (text.length + msg.length > PER_CONVERSATION_CHARS) break;
        text += `- ${msg}\n`;
      }
      const date = t.updateTime || t.createTime;
      return { id: t.id, title: t.title, date: date ? new Date(date * 1000).toISOString().slice(0, 10) : '', time: date || 0, text };
    })
    .filter((c) => c.text);
}

function makeBatches(material) {
  const batches = [];
  let cur = [];
  let size = 0;
  for (const c of material) {
    const block = `### "${c.title}" (${c.date})\n${c.text}`;
    if (cur.length && size + block.length > BATCH_CHARS) { batches.push(cur); cur = []; size = 0; }
    cur.push({ ...c, block });
    size += block.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Decides the profile's language from the user's own writing. */
function detectLanguage(material) {
  const sample = material.map((c) => c.text).join(' ').slice(0, 20000);
  const arabic = (sample.match(/[؀-ۿ]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  return arabic > latin * 0.5 ? 'Arabic' : 'English';
}

// Small models follow an example far better than a list of rules, and pay
// most attention to what comes last — so: messages first, then an example,
// then the instructions. No "output NONE" escape hatch: given one, a 7B model
// takes it even when the messages clearly reveal projects, tools and goals.
function extractionPrompt(batch, language) {
  return `MESSAGES that one person (the user) wrote to AI assistants, grouped by conversation title and date:

${batch.map((c) => c.block).join('\n')}

EXAMPLE of the output format (for a different person):
ABOUT: Works as a nurse and is studying for a master's degree
PROJECT: Writing a mobile app to track hospital shift swaps
TECH: Uses Flutter and Firebase
PREFERENCE: Wants step-by-step answers with short code snippets
GOAL: Learning Spanish for a move to Madrid
GOAL: Interested in home gardening

TASK: From the MESSAGES above, write 3 to 12 lines of facts about THIS user, in exactly the format of the example.
Use these tags: ABOUT (job, studies, where they live, languages), PROJECT (what they are building or working on),
TECH (tools, programming languages, services they use), PREFERENCE (how they like answers), GOAL (goals, plans, hobbies, interests).
Only write what the messages show about the user. Each line under 20 words. Write the facts in ${language}.
Write a PREFERENCE line ONLY if the user explicitly asked for a style (e.g. "keep it short", "answer in Arabic", "explain like I'm new") — never guess one.
Output only the lines.`;
}

/** Tolerant parser: accepts "- ABOUT: x", "**PROJECT**: x", "Tech - x"… */
function parseFacts(text) {
  const facts = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^[\s>*\-•\d.)]+/, '').replace(/\*\*/g, '').trim();
    const m = line.match(/^(ABOUT|PROJECTS?|TECH|TOOLS?|PREFERENCES?|GOALS?|INTERESTS?)\s*[:\-–]\s*(.+)$/i);
    if (!m) continue;
    let tag = m[1].toUpperCase().replace(/S$/, '');
    if (tag === 'TOOL') tag = 'TECH';
    if (tag === 'INTEREST') tag = 'GOAL';
    const fact = m[2].replace(/\s+/g, ' ').replace(/[.。]+$/, '').trim();
    if (CATEGORIES[tag] && fact.length >= 4 && fact.length <= 240 && !/^none$/i.test(fact)) facts.push({ tag, text: fact });
  }
  return facts;
}

// ─── Cheap grounding checks (a 7B model still invents details sometimes) ────
const FILLER_RE = /\b(not (mentioned|specified|stated|clear)|no (specific|particular|clear)|none|unknown|n\/a)\b|لا يوجد|غير (مذكور|محدد|واضح)|لم يذكر/i;
// Words people use when they ASK for an answer style. A PREFERENCE fact needs one of these in their messages.
const STYLE_CUE_RE = /\b(short|shorter|brief|briefly|concise|detailed|in detail|step[- ]by[- ]step|examples?|bullet|format|table|simple|simply|explain like|beginner|tl;?dr|in (arabic|english)|language)\b|مختصر|باختصار|اختصار|بالتفصيل|تفصيل|خطوة بخطوة|أمثلة|امثلة|مثال|بالعربي|بالعربية|بالإنجليزي|ببساطة|نقاط/i;

const stem = (t) => t.slice(0, 5); // crude but language-agnostic: "examples"≈"example", "learning"≈"learn"

// Verbs every fact is phrased with ("Uses …", "Is learning …", "يتعلم …") — not evidence either way.
const SCAFFOLD = new Set([
  'uses', 'use', 'using', 'used', 'works', 'work', 'working', 'likes', 'like', 'loves', 'wants', 'want', 'wanted',
  'prefers', 'prefer', 'interested', 'interest', 'learning', 'learn', 'studying', 'studies', 'study', 'building',
  'build', 'builds', 'planning', 'plan', 'plans', 'writing', 'writes', 'making', 'makes', 'trying', 'tries', 'user',
  'يستخدم', 'يعمل', 'يحب', 'يرغب', 'يفضل', 'يريد', 'مهتم', 'يتعلم', 'يدرس', 'يبني', 'يخطط', 'يكتب'
]);

/**
 * Keeps a fact only if MORE than half of its content words occur in the
 * messages it came from. Catches invented specifics ("studies programming in
 * Egypt" when Egypt is never mentioned), filler ("no project mentioned") and
 * guessed answer styles. It can't catch plausible-sounding inferences — the
 * user reviews the profile for those.
 */
function isGrounded(fact, sourceText) {
  if (FILLER_RE.test(fact.text)) return false;
  if (fact.tag === 'PREFERENCE' && !STYLE_CUE_RE.test(sourceText)) return false;
  const sourceStems = new Set(tokenize(sourceText).filter((t) => t.length >= 3).map(stem));
  const factStems = tokenize(fact.text).filter((t) => t.length >= 3 && !SCAFFOLD.has(t)).map(stem);
  if (factStems.length === 0) return false;
  const supported = factStems.filter((s) => sourceStems.has(s)).length;
  return supported / factStems.length > 0.5;
}

function similarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// When the same fact was filed under two headings, keep the more specific one.
const TAG_PRIORITY = { PROJECT: 0, TECH: 1, GOAL: 2, PREFERENCE: 3, ABOUT: 4 };

/** Merges near-duplicate facts; each keeps a support count and the latest date it was seen. */
function mergeFacts(entries) {
  const merged = [];
  for (const e of entries) {
    const dup = merged.find((m) => m.tag === e.tag && similarity(m.text, e.text) >= 0.5);
    if (dup) {
      dup.count += 1;
      if (e.time > dup.time) { dup.time = e.time; dup.text = e.text; } // prefer the most recent wording
    } else {
      merged.push({ ...e, count: 1 });
    }
  }
  // Same fact under different headings ("Building a bakery order system" as ABOUT and PROJECT)
  const result = [];
  for (const f of merged.sort((a, b) => TAG_PRIORITY[a.tag] - TAG_PRIORITY[b.tag])) {
    const dup = result.find((r) => similarity(r.text, f.text) >= 0.7);
    if (dup) { dup.count += f.count; dup.time = Math.max(dup.time, f.time); }
    else result.push(f);
  }
  return result.sort((a, b) => b.count - a.count || b.time - a.time);
}

/** The profile, assembled from the ranked, grounded facts (best-supported first under each heading). */
function assembleProfile(facts, language = 'English') {
  const sections = [];
  for (const [tag, heading] of Object.entries(headingsFor(language))) {
    const list = facts.filter((f) => f.tag === tag).slice(0, MAX_FACTS_PER_SECTION);
    if (list.length) sections.push(`## ${heading}\n${list.map((f) => `- ${f.text}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

/**
 * @param {object} opts
 * @param {object[]} opts.threads          all memory threads (imported + app)
 * @param {(prompt: string, o: object) => Promise<string>} opts.complete
 * @param {number}  [opts.maxConversations=80]
 * @param {(p: {phase, done, total}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
async function buildProfile({ threads, complete, maxConversations = 80, onProgress = () => {}, signal }) {
  const material = collectMaterial(threads, maxConversations);
  if (material.length === 0) throw new Error('There are no conversations with your messages to learn from yet.');
  const language = detectLanguage(material);
  const batches = makeBatches(material);

  const entries = [];
  for (let i = 0; i < batches.length; i++) {
    if (signal && signal.aborted) throw new Error('Cancelled');
    onProgress({ phase: 'reading', done: i, total: batches.length });
    const batch = batches[i];
    let out = '';
    try {
      out = await complete(extractionPrompt(batch, language), { temperature: 0.1, maxTokens: 500, signal });
    } catch (err) {
      if (signal && signal.aborted) throw new Error('Cancelled');
      continue; // one failed batch shouldn't sink the whole profile
    }
    const latest = Math.max(...batch.map((c) => c.time));
    const sourceText = batch.map((c) => `${c.title}\n${c.text}`).join('\n');
    for (const f of parseFacts(out)) {
      if (isGrounded(f, sourceText)) entries.push({ ...f, time: latest });
    }
  }
  onProgress({ phase: 'reading', done: batches.length, total: batches.length });

  const facts = mergeFacts(entries);
  if (facts.length === 0) throw new Error('Could not find lasting facts about you in these conversations.');

  const markdown = assembleProfile(facts, language);
  return { markdown, language, conversationsUsed: material.length, factsFound: facts.length };
}

// ─── Using & exporting the profile ───────────────────────────────────────────

function splitSections(markdown) {
  const sections = {};
  let current = null;
  for (const line of String(markdown || '').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { current = h[1]; sections[current] = []; continue; }
    if (current && line.trim()) sections[current].push(line.trim());
  }
  return sections;
}

/** Joins lines up to `limit` characters without cutting a bullet in half. */
function fitLines(lines, limit) {
  const out = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > limit) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

/**
 * ChatGPT's custom instructions have two fields (1,500 characters each):
 * "what should ChatGPT know about you" and "how should it respond".
 */
function toChatGptInstructions(markdown) {
  const sections = splitSections(markdown);
  const aboutLines = [];
  for (const [heading, lines] of Object.entries(sections)) {
    if (PREFERENCE_HEADINGS.has(heading)) continue;
    aboutLines.push(`${heading}:`, ...lines);
  }
  const prefLines = Object.entries(sections).filter(([h]) => PREFERENCE_HEADINGS.has(h)).flatMap(([, lines]) => lines);
  return {
    aboutYou: fitLines(aboutLines, CHATGPT_FIELD_LIMIT),
    howToRespond: fitLines(prefLines, CHATGPT_FIELD_LIMIT)
  };
}

/** Block added to the system prompt when the profile is enabled. */
function profileContext(markdown) {
  const text = String(markdown || '').trim();
  if (!text) return '';
  return `<user_profile>\nWhat you know about the user (a summary they reviewed, built from their past conversations). ` +
    `Use it to personalise answers; don't recite it back unless asked. If the user says something different now, believe the user.\n\n` +
    `${text.slice(0, PROFILE_MAX_CHARS)}\n</user_profile>`;
}

module.exports = {
  ProfileStore,
  buildProfile,
  toChatGptInstructions,
  profileContext,
  // exported for tests
  _internals: { collectMaterial, makeBatches, parseFacts, mergeFacts, assembleProfile, detectLanguage, isGrounded, CATEGORIES }
};
