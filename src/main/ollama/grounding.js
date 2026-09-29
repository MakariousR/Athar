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

/** Are these words really in the research? (Exactly, or nearly: small spelling differences.) */
function quoteInResearch(quote, researchText) {
  const q = norm(quote);
  if (q.split(' ').length < 2) return false;
  const r = norm(researchText);
  if (r.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length >= 2);
  const have = new Set(r.split(' '));
  return words.length >= 3 && words.filter((w) => have.has(w)).length / words.length >= 0.8;
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

function evidencePrompt(statements, researchText) {
  return `RESEARCH (web search results):
"""
${String(researchText).slice(0, 7000)}
"""

Below are numbered statements from an answer. For EACH statement, find the words in the RESEARCH that prove it, and write one line:
N. "<copy the exact words from the RESEARCH, 3 to 15 words>"
or, if nothing in the RESEARCH says it:
N. NONE
Do not rephrase — copy the research's own words, character for character. Statements that are only advice or opinion: write N. ADVICE

STATEMENTS:
${statements.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

module.exports = { answerStatements, parseEvidence, quoteInResearch, unsupportedStatements, evidencePrompt, ABSENCE_RE };
