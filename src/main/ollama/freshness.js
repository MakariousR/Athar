/**
 * "Is this answer likely out of date?" — decided in code, because a small
 * local model is bad at noticing that its own knowledge stops at its training
 * cutoff (it answers "current" questions confidently from old data).
 *
 *  - needsFreshInfo(): the question asks about something that changes over
 *    time (latest/current/price/news/who is the CEO…, or a year after the
 *    model's cutoff) → search the web BEFORE answering, if online.
 *  - looksUncertainOrDated(): the model's answer says it doesn't know, or
 *    that its info is "as of my last update" → search and answer again, if online.
 *  - offlineNote(): no internet → the answer is explicitly labelled as being
 *    as of the model's training data.
 */

// Approximate knowledge cutoffs (from the models' own documentation). Only
// used to phrase "as of around …" and to spot questions about later years.
// Matched by name prefix, most specific first.
const { normalizeArabicText } = require('../utils/text-normalizer');

const MODEL_CUTOFFS = [
  ['qwen2.5', { label: 'late 2023', labelAr: 'أواخر 2023', year: 2023 }],
  ['qwen3', { label: '2024', labelAr: '2024', year: 2024 }],
  ['llama3.3', { label: 'December 2023', labelAr: 'ديسمبر 2023', year: 2023 }],
  ['llama3.2', { label: 'December 2023', labelAr: 'ديسمبر 2023', year: 2023 }],
  ['llama3.1', { label: 'December 2023', labelAr: 'ديسمبر 2023', year: 2023 }],
  ['gemma3', { label: 'August 2024', labelAr: 'أغسطس 2024', year: 2024 }],
  ['phi4', { label: 'June 2024', labelAr: 'يونيو 2024', year: 2024 }],
  ['mistral', { label: '2023', labelAr: '2023', year: 2023 }]
];

function modelKnowledgeCutoff(modelName) {
  const name = String(modelName || '').toLowerCase();
  const hit = MODEL_CUTOFFS.find(([prefix]) => name.startsWith(prefix));
  return hit ? hit[1] : { label: null, labelAr: null, year: null };
}

// Things that change over time. Deliberately about the WORLD, not the user.
const TIME_SENSITIVE_EN = /\b(latest|newest|most recent|current(ly)?|right now|nowadays|as of (today|now)|today'?s|tonight|this (week|month|year)|recent(ly)?|upcoming|so far|anymore|still (the|a|an|in|at|alive|open|available|running|free)|news|headlines?|price|prices|pricing|costs? now|stock|shares|market cap|exchange rate|interest rates?|inflation|weather|forecast|scores?|standings|election|polls?|who (is|are) (the )?(current |new )?(president|prime minister|ceo|leader|king|champion|owner)|net worth|richest|population|released?|release date|new version|latest version|version of|announced?|launch(ed)?)\b/i;
const TIME_SENSITIVE_AR = /الآن|الان|حالياً|حاليا|اليوم|أحدث|احدث|آخر (إصدار|اصدار|الأخبار|الاخبار|نسخة|تحديث)|الأخبار|الاخبار|سعر|أسعار|اسعار|الطقس|نتيجة|نتائج|مباراة|انتخابات|من هو رئيس|من هو الرئيس|الرئيس الحالي|صافي ثروة|ثروة|عدد سكان|إصدار|اصدار|هذا العام|هذه السنة|هذا الشهر|هذا الأسبوع|مؤخراً|مؤخرا/;

// Questions about the user's OWN past, attached files or project are answered
// from memory/files — never by searching the web.
const PERSONAL_RE = /\b(did (i|we|you)|have (i|we)|i (asked|said|told|mentioned|decided|wrote)|we (decided|discussed|talked)|you (told|advised|suggested|recommended|said to) me|(did|what did) (chatgpt|claude|gemini|it) (say|suggest|advise|recommend|tell)|my (last|previous|past|earlier|old) (chat|conversation|question)|(my|our) (chats?|conversations?|history)|last time|remember when|in (my|our) (chat|conversation|history|memory))\b|سألت|ناقشنا|ناقشت|تحدثنا|تحدثت|قلنا|قلت لك|قلت لي|نصحتني|اقترحت علي|أخبرتني|اخبرتني|محادثتي|محادثاتي|دردشتي|آخر مرة|اخر مرة/i;

function isPersonalMemoryQuestion(text) {
  return PERSONAL_RE.test(String(text || ''));
}

/**
 * @returns {{ needed: boolean, reason: string|null }}
 */
function needsFreshInfo(userText, { cutoffYear = null, now = new Date(), hasDocuments = false, isProjectQuestion = false } = {}) {
  const text = String(userText || '');
  if (!text.trim() || isPersonalMemoryQuestion(text) || hasDocuments || isProjectQuestion) return { needed: false, reason: null };

  // A year after the model's cutoff (or last year / this year when the cutoff is unknown)
  const threshold = cutoffYear || now.getFullYear() - 1;
  const years = (text.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  if (years.some((y) => y > threshold && y <= now.getFullYear() + 1)) {
    return { needed: true, reason: 'asks about a time after the model\'s training data' };
  }
  // An explicit OLD year is a history question: generic cues ("won", "price") don't make it current.
  const onlyOldYears = years.length > 0 && years.every((y) => y <= threshold);
  if (onlyOldYears && !/\b(latest|newest|current(ly)?|right now|today|still)\b|الآن|حالياً|حاليا|أحدث/i.test(text)) {
    return { needed: false, reason: null };
  }
  // "Is X still …?" asks whether something is still true now (a bare "still" is too common to count).
  // …but not about the user's own things ("why does my code still fail?").
  const stillQuestion = /\b(is|are|was|were|does|do|did|has|have)\b[^?.!]{1,40}\bstill\b/i.test(text) &&
    !/\b(my|our|this|these|your|mine)\b/i.test(text);
  if (stillQuestion || TIME_SENSITIVE_EN.test(text) || TIME_SENSITIVE_AR.test(text)) {
    return { needed: true, reason: 'asks about something that changes over time' };
  }
  return { needed: false, reason: null };
}

// The model admitting it doesn't know, or hedging with its training date.
const UNCERTAIN_EN = /\b(i (do not|don't|cannot|can't) (have|access|provide) (access to )?(any )?(real[- ]time|current|up[- ]to[- ]date|live|recent|the latest|up-to-the-minute) (information|data|updates|news|prices)|as of my (last|latest|most recent) (knowledge )?(update|training)|as of my (knowledge|training) (cut-?off|date)|my (knowledge|training data|information) (cut-?off|only goes|is (only )?(current|up to date|limited)|may be (out of date|outdated))|(i('m| am) not|i am not) (aware of|sure (about|of|what|who|whether))|i (do not|don't) know|i (do not|don't) have (any )?(specific |detailed )?information|i (cannot|can't|am unable to) (browse|access|search) the (internet|web)|(please )?(check|refer to|consult|visit) (the )?(official|latest|recent|current|reliable) (sources?|website|news|updates)|beyond my (knowledge|training)|after my (knowledge|training) cut-?off)\b/i;
const UNCERTAIN_AR = /لا أملك معلومات|لا املك معلومات|ليس لدي معلومات|ليست لدي معلومات|لا تتوفر لدي|لا أعرف|لا اعرف|لست متأكد|لست متاكد|حتى تاريخ (آخر )?(تحديث|تدريب)|حسب آخر تحديث|حتى آخر تحديث|لا يمكنني (الوصول إلى|تصفح) (الإنترنت|الانترنت)|معرفتي (محدودة|تنتهي|تتوقف)|يرجى (التحقق|مراجعة) (من )?(المصادر|المواقع) الرسمية/;

/** Tests the raw text AND its normalised form, so Arabic spelling variants (إتصال / اتصال) match too. */
function matchesEither(re, text) {
  return re.test(text) || re.test(normalizeArabicText(text));
}

function looksUncertainOrDated(answer) {
  const text = String(answer || '');
  return UNCERTAIN_EN.test(text) || matchesEither(UNCERTAIN_AR, text);
}

// The answer already says its information may be dated ("as of my last update",
// "my information is as of around late 2023", "may have changed since"…).
const DISCLAIMER_RE = /training data|as of my|knowledge cut-?off|information is (only )?(as of|up to|current as of)|as of (around |about )?(late |early |mid[- ])?(w+ )?(19|20)d{2}|may (be out of date|be outdated|have changed)|no internet|offline|بيانات تدريبي|حتى تاريخ|قد لا تكون محدّثة|قد لا تكون محدثة|قد تكون تغيرت|قد تكون تغيّرت|غير متصل|لا يوجد اتصال|تدريبي/i;

function hasTrainingDisclaimer(answer) {
  return matchesEither(DISCLAIMER_RE, String(answer || ''));
}

function isArabic(text) {
  const s = String(text || '');
  const arabic = (s.match(/[؀-ۿ]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return arabic > 0 && arabic >= latin;
}

/**
 * The note shown when current information couldn't be fetched.
 * @param {'offline'|'search-failed'|'disabled'} why  'disabled': the user has web search (the Search button) turned off
 */
function offlineNote({ why = 'offline', cutoffLabel = null, cutoffLabelAr = null, arabic = false } = {}) {
  if (arabic) {
    const label = cutoffLabelAr || cutoffLabel;
    const when = label ? `حتى حوالي ${label}` : 'حتى تاريخ تدريبي';
    if (why === 'disabled') {
      return `ملاحظة: البحث في الإنترنت متوقف، لذا هذه الإجابة مبنية على بيانات تدريبي (${when}) وقد لا تكون محدّثة. فعّل زر "Search" في مربع الرسالة لأبحث عنها في الإنترنت.`;
    }
    return why === 'offline'
      ? `ملاحظة: لا يوجد اتصال بالإنترنت الآن، لذا هذه الإجابة مبنية على بيانات تدريبي (${when}) وقد لا تكون محدّثة.`
      : `ملاحظة: تعذّر الحصول على نتائج من الإنترنت الآن، لذا هذه الإجابة مبنية على بيانات تدريبي (${when}) وقد لا تكون محدّثة.`;
  }
  const when = cutoffLabel ? `up to around ${cutoffLabel}` : 'up to my training date';
  if (why === 'disabled') {
    return `Note: web search is off, so this is based on my training data (${when}) and may be out of date. Turn on **Search** in the message box to let me look it up online.`;
  }
  return why === 'offline'
    ? `Note: there's no internet connection right now, so this is based on my training data (${when}) and may be out of date.`
    : `Note: I couldn't get web results just now, so this is based on my training data (${when}) and may be out of date.`;
}

/**
 * Instruction for the model when it must answer without the web.
 */
function offlineInstruction({ why = 'offline', cutoffLabel = null }) {
  const when = cutoffLabel ? `around ${cutoffLabel}` : 'your training date';
  const reason = why === 'disabled'
    ? 'The user has web search turned OFF (the "Search" button in the message box)'
    : why === 'offline' ? 'There is NO internet connection right now' : 'Web search failed just now';
  return `[${reason}, so no current information is available. ` +
    `Answer from your training knowledge and say clearly, in the user's language, that your information is as of ${when} and may have changed since. ` +
    `Never invent a current figure (price, score, rate…) or write a placeholder like "[price]": if you don't know it, say so` +
    (why === 'disabled' ? '; they can turn on Search to let you look it up online.]' : '.]');
}

// Greetings, thanks, "ok": never worth a web search, even with "Search" turned on
const SMALL_TALK_RE = /^(hi|hello|hey|hiya|howdy|sup|yo|good (morning|afternoon|evening|night)|thanks?|thank you|thx|ty|ok|okay|cool|great|nice|perfect|bye|goodbye|see you|مرحبا|أهلا|اهلا|السلام عليكم|صباح الخير|مساء الخير|شكرا|شكراً|تمام|حسنا|مع السلامة)(\s+(a lot|so much|very much|again|you|man|bro|جزيلا|جزيلاً))*[\s.!?,،؟]*$/i;

function isSmallTalk(text) {
  return SMALL_TALK_RE.test(String(text || '').trim());
}

/**
 * Whether to search the web before the model answers. Athar goes online only
 * when the user turned on "Search" in the message box; then every question is
 * searched first, except small talk and questions about their own chats,
 * attached files or the project folder.
 *   reason 'fresh'  — and the answer may be out of date (see needsFreshInfo)
 *   reason 'always' — any other question
 * @returns {{ search: boolean, reason: 'fresh'|'always'|null }}
 */
function shouldSearchFirst(text, { fresh, searchOn = false, hasDocuments = false, isProjectQuestion = false } = {}) {
  const t = String(text || '').trim();
  if (!searchOn || !t || isSmallTalk(t) || isPersonalMemoryQuestion(t) || hasDocuments || isProjectQuestion) {
    return { search: false, reason: null };
  }
  return { search: true, reason: fresh && fresh.needed ? 'fresh' : 'always' };
}

module.exports = {
  modelKnowledgeCutoff,
  needsFreshInfo,
  shouldSearchFirst,
  isSmallTalk,
  isPersonalMemoryQuestion,
  looksUncertainOrDated,
  hasTrainingDisclaimer,
  offlineNote,
  offlineInstruction,
  isArabic
};
