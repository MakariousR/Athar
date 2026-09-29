'use strict';

// Is an answer made from web results actually backed by them?
//
// Asked "is this supported?", a small model says yes to everything. Asked to
// COPY the words from the results that prove each statement, it writes NONE
// when there are none — and a quote it made up is caught here, by checking
// that the words really are in the results. See checkAnswerGrounding in
// ollama-client.js.

const { normalizeArabicText } = require('../utils/text-normalizer');
const { sharesSubject } = require('./freshness');

const MAX_STATEMENTS = 12;

// "The results don't mention…", "لم تذكر النتائج…": saying what the sources
// lack can't be quoted from them
const ABSENCE_RE = /\b(results?|sources?|search(es)?|pages?)\b[^.\n]{0,30}\b(don'?t|do not|didn'?t|did not|doesn'?t|does not|couldn'?t|could not|no)\b|\b(no|not) (information|mention|details?|data)\b|\b(i )?(couldn'?t|could not|can'?t|cannot) (find|confirm|verify)\b|لم (تذكر|تظهر|تشر|أجد|اجد|يذكر)|لا (تذكر|توجد معلومات|يوجد ذكر)/i;

/** The answer's statements, numbered for the check (code, headings and short bits left out). */
function answerStatements(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .split(/\n+|(?<=[.!?؟])\s+/)
    .map((s) => s.replace(/^\s*(#+|[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim())
    .filter((s) => s.length >= 25 && !/[:：]$/.test(s) && !ABSENCE_RE.test(s))
    .slice(0, MAX_STATEMENTS);
}

/**
 * The checker's reply, one line per statement: `N. "quote"`, `N. NONE` or
 * `N. ADVICE`. Statements without a line are left out (not judged).
 * @returns {Map<number, {kind: 'quote'|'none'|'advice', quote?: string}>}
 */
function parseEvidence(reply) {
  const out = new Map();
  for (const line of String(reply || '').split('\n')) {
    const m = line.match(/^\s*\**\s*(\d+)\s*[.):-]\s*(.*)$/);
    if (!m) continue;
    const n = Number(m[1]);
    const rest = m[2].trim();
    if (/^\**\s*none\b/i.test(rest)) out.set(n, { kind: 'none' });
    else if (/^\**\s*advice\b/i.test(rest)) out.set(n, { kind: 'advice' });
    else {
      // The words inside the first quotes; a translation after it "(…)" is ignored
      const q = rest.match(/^["“«']([^"”»]+)["”»']/) || rest.match(/^(.+?)(\s*\(.*\))?$/);
      out.set(n, { kind: 'quote', quote: (q ? q[1] : rest).trim() });
    }
  }
  return out;
}

const norm = (t) => normalizeArabicText(String(t || '').toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Are these words really in the research? Exactly, or nearly (small spelling
 * differences) — and then close together: the words of a made-up quote are
 * usually all SOMEWHERE in 15,000 characters of research.
 */
function quoteInResearch(quote, researchText) {
  const q = norm(quote);
  if (q.split(' ').length < 2) return false;
  const r = norm(researchText);
  if (r.includes(q)) return true;
  const want = new Set(q.split(' ').filter((w) => w.length >= 2));
  if (want.size < 3) return false;
  const need = Math.ceil(want.size * 0.8);
  const span = want.size * 2 + 4; // research words a near-exact quote may spread over
  const tokens = r.split(' ');
  const counts = new Map();
  let distinct = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (want.has(t)) {
      const c = (counts.get(t) || 0) + 1;
      counts.set(t, c);
      if (c === 1) distinct++;
    }
    if (i >= span) {
      const old = tokens[i - span];
      if (want.has(old)) {
        const c = counts.get(old) - 1;
        counts.set(old, c);
        if (c === 0) distinct--;
      }
    }
    if (distinct >= need) return true;
  }
  return false;
}

/**
 * The part of the research the checker sees. One search is ~15,000
 * characters, more than a small model's context allows next to the
 * statements, and cutting it at the start hides the later sources: facts from
 * them came back NONE and correct statements were "corrected" away. Instead,
 * each statement gets the research paragraphs that share the most words with
 * it (in turn, so every statement is covered), in their original order, with
 * their source header.
 */
function researchForCheck(researchText, statements, maxChars = 7000) {
  const text = String(researchText || '');
  if (text.length <= maxChars) return text;

  const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 3));
  const paras = text.split(/\n{2,}|\n(?=--- \[|\| |- |### )/).map((p) => p.trim()).filter(Boolean);
  // The source each paragraph belongs to ("--- [3] Title (site) ---" + "URL: …")
  let header = null;
  const items = paras.map((p, i) => {
    if (/^--- \[\d+\]/.test(p)) header = p.split('\n').slice(0, 2).join('\n');
    return { i, p, header, words: words(p) };
  });

  const scoresFor = (s) => {
    const sw = words(s);
    return items
      .map((it) => ({ it, score: [...sw].filter((w) => it.words.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.it.i - b.it.i)
      .map((x) => x.it);
  };
  const ranked = statements.map(scoresFor);

  const keep = new Set();
  let used = 0;
  // A paragraph costs its (capped) length, plus its source header the first time that source appears
  const cost = (it) => Math.min(it.p.length, 1201) + 2 +
    (it.header && !items.some((o) => keep.has(o.i) && o.header === it.header) ? it.header.length + 2 : 0);
  for (let round = 0; round < 6; round++) {
    let added = false;
    for (const list of ranked) {
      const next = list.find((it) => !keep.has(it.i));
      if (!next) continue;
      const c = cost(next);
      if (used + c > maxChars) continue;
      keep.add(next.i);
      used += c;
      added = true;
    }
    if (!added) break;
  }

  const out = [];
  let lastHeader = null;
  for (const it of items) {
    if (!keep.has(it.i)) continue;
    if (it.header && it.header !== lastHeader && it.p !== it.header && !it.p.startsWith(it.header)) out.push(it.header);
    lastHeader = it.header;
    out.push(it.p.length > 1200 ? `${it.p.slice(0, 1200)}…` : it.p);
  }
  return out.length ? out.join('\n\n') : text.slice(0, maxChars);
}

/**
 * The statements the research doesn't back: no quote, or a quote that isn't
 * in it. Only statements about what the user asked (sharing a subject word
 * with the question) count — a general explanation around them is left alone.
 */
function unsupportedStatements(statements, evidence, researchText, userText) {
  const flagged = [];
  statements.forEach((s, i) => {
    const e = evidence.get(i + 1);
    if (!e || e.kind === 'advice') return;
    if (e.kind === 'quote' && quoteInResearch(e.quote, researchText)) return;
    if (userText && !sharesSubject(s, userText)) return;
    flagged.push(s);
  });
  return flagged;
}

function evidencePrompt(statements, researchText, maxChars = 7000) {
  return `RESEARCH (web search results):
"""
${researchForCheck(researchText, statements, maxChars)}
"""

Below are numbered statements from an answer. For EACH statement, find the words in the RESEARCH that prove it, and write one line:
N. "<copy the exact words from the RESEARCH, 3 to 15 words>"
or, if nothing in the RESEARCH says it:
N. NONE
Do not rephrase — copy the research's own words, character for character. Statements that are only advice or opinion: write N. ADVICE

STATEMENTS:
${statements.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

module.exports = { answerStatements, parseEvidence, quoteInResearch, unsupportedStatements, evidencePrompt, researchForCheck, ABSENCE_RE };
