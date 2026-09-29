'use strict';

// Where did each earlier reply in this chat come from?
//
// Earlier replies go back to the model as plain assistant turns, and a small
// model treats "what I said before" as settled fact: a guess from old
// training data, or a claim the source check flagged, gets repeated in every
// later answer — even over new web results. So each request carries a short
// note that says which earlier replies were checked against the web (and
// when) and which were never checked. Worked out from the "thought process"
// steps saved with each reply, so it also works for chats saved before this.

// Status texts from generate() / the web tools that mean web results were used
const WEB_STEP_RE = /^(Searching web for|Using results from a search|Fetching page:|Answer checks out against the sources|Answer corrected to match the sources|Searching the web)/i;
// …and that some of what the reply says was NOT found in them
const UNVERIFIED_STEP_RE = /may not be fully verified/i;
const UNVERIFIED_TEXT_RE = /Not fully verified against the sources/i;

const MAX_REPLIES_NOTED = 4;

/**
 * @returns {'web'|'web-partly-unverified'|'unchecked'|'stopped'}
 *   web: based on web results that the source check found; unchecked: written
 *   from the model's own knowledge (or the chat), never compared with any source.
 */
function replyProvenance(message) {
  const steps = Array.isArray(message && message.steps) ? message.steps : [];
  const text = String((message && message.text) || '');
  if (message && message.stopped) return 'stopped';
  const usedWeb = steps.some((s) => WEB_STEP_RE.test(String(s).trim()));
  if (usedWeb && (steps.some((s) => UNVERIFIED_STEP_RE.test(s)) || UNVERIFIED_TEXT_RE.test(text))) return 'web-partly-unverified';
  return usedWeb ? 'web' : 'unchecked';
}

/** "earlier today", "yesterday", "5 days ago", or '' without a timestamp. */
function howLongAgo(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return '';
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(timestamp).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** The first words of a reply, to say which one is meant (Markdown and line breaks removed). */
function openingWords(text, max = 70) {
  const t = String(text || '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/[#*_`>|[\]]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
}

const DESCRIBE = {
  web: (ago) => `based on web results found ${ago || 'then'}; still, facts that change (prices, news, who holds a role) may have changed since`,
  'web-partly-unverified': (ago) => `based on web results found ${ago || 'then'}, but some of its claims were NOT found in those results`,
  unchecked: () => 'written from your own training knowledge, never checked against any source — it may be wrong or out of date',
  stopped: () => 'cut off by the user before it was finished'
};

/**
 * The note for this request, or '' when the chat has no earlier replies.
 * @param {object[]} history  the chat's messages (the last one may be the new user message)
 * @param {number} window     how many recent messages the model is sent
 */
function earlierRepliesNote(history, { window = 12, now = Date.now() } = {}) {
  const recent = (history || []).slice(-window).filter((m) => m && m.role === 'assistant' && String(m.text || '').trim());
  if (recent.length === 0) return '';
  const lines = recent.slice(-MAX_REPLIES_NOTED).map((m) => {
    const kind = replyProvenance(m);
    return `- "${openingWords(m.text)}" — ${DESCRIBE[kind](howLongAgo(m.timestamp, now))}.`;
  });
  return `<earlier_replies_in_this_chat>\n` +
    `Your earlier replies in this conversation are NOT sources. They are claims you made, and they can be wrong:\n` +
    `${lines.join('\n')}\n` +
    `Don't repeat a fact from them as confirmed just because you said it before. If the web results, the attached files or ` +
    `what the user says about themselves contradict an earlier reply, the earlier reply was wrong: say so in one short sentence and give the correct information.\n` +
    `</earlier_replies_in_this_chat>`;
}

// The note alone was not enough for a 7B model (it corrected 2 of 5 planted
// mistakes, 0 without it). What worked (5 of 5, correct replies still used as
// before): a marker on the unchecked reply itself, where the model reads it,
// plus a "check first" line right after the new question.
const UNCHECKED_MARKER = '[unchecked earlier reply — may contain mistakes]';
const CHECK_FIRST_LINE = '[Before answering: is every fact in your earlier replies above actually correct? ' +
  'If one is wrong, start your answer by correcting it, then answer using the correct fact.]';
// Like the reply-language line, said in Arabic too: an Arabic question with only English instructions next to it is followed less
const CHECK_FIRST_LINE_AR = '[قبل أن تجيب: هل كل معلومة في ردودك السابقة أعلاه صحيحة فعلاً؟ ' +
  'إذا كانت إحداها خاطئة فابدأ إجابتك بتصحيحها، ثم أجب بناءً على المعلومة الصحيحة.]';

/** The "check first" line, in Arabic as well when the reply is in Arabic. */
function checkFirstLine(replyLangCode) {
  return replyLangCode === 'ar' ? `${CHECK_FIRST_LINE}\n${CHECK_FIRST_LINE_AR}` : CHECK_FIRST_LINE;
}

const isUnchecked = (message) => {
  const kind = replyProvenance(message);
  return kind === 'unchecked' || kind === 'web-partly-unverified';
};

/** An earlier reply as the model is sent it: marked when it was never (fully) checked. */
function markEarlierReply(message) {
  const text = String((message && message.text) || '');
  return isUnchecked(message) && text.trim() ? `${UNCHECKED_MARKER}\n${text}` : text;
}

/** Whether any earlier reply the model is sent was never (fully) checked. */
function hasUncheckedReplies(history, { window = 12 } = {}) {
  return (history || []).slice(-window).some((m) => m && m.role === 'assistant' && String(m.text || '').trim() && isUnchecked(m));
}

/** The model may copy the marker into its answer: take it out. */
function stripMarker(text) {
  return String(text || '').replace(/^\s*\[unchecked earlier reply[^\]\n]*\]\s*/i, '');
}

// "I apologize for the oversight." at the start of a chat's FIRST reply: there
// is nothing earlier to apologize for — the model is reacting to the app's own
// retry notes (a tool call it printed as text, Search being off).
const OPENING_APOLOGY_RE = /^\s*(I apologi[sz]e|(I'm |I am )?sorry|My apologies)\b[^.!?\n]{0,60}\b(oversight|confusion|mistake|error|misunderstanding|inconvenience)\b[^.!?\n]*[.!?]\s*(Let me clarify[^.!?\n:]*[.:]\s*)?/i;
const OPENING_APOLOGY_AR_RE = /^\s*(أعتذر|اعتذر|عذرا|عذرًا|آسف|اسف)[^.!؟\n]{0,60}(الخطأ|السهو|اللبس|الالتباس)[^.!؟\n]*[.!؟]\s*/;

function stripUnpromptedApology(text, history) {
  const earlierReply = (history || []).some((m) => m && m.role === 'assistant' && String(m.text || '').trim());
  if (earlierReply) return text;
  const out = String(text || '').replace(OPENING_APOLOGY_RE, '').replace(OPENING_APOLOGY_AR_RE, '');
  return out.trim() ? out.charAt(0).toUpperCase() + out.slice(1) : text;
}

module.exports = {
  stripUnpromptedApology,
  replyProvenance, earlierRepliesNote, howLongAgo, openingWords,
  markEarlierReply, hasUncheckedReplies, stripMarker, checkFirstLine, UNCHECKED_MARKER, CHECK_FIRST_LINE
};
