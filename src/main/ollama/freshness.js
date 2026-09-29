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
  ['deepseek-r1', { label: '2024', labelAr: '2024', year: 2024 }],
  ['gpt-oss', { label: 'June 2024', labelAr: 'يونيو 2024', year: 2024 }],
  ['mistral-small', { label: '2024', labelAr: '2024', year: 2024 }],
  ['mistral', { label: '2023', labelAr: '2023', year: 2023 }]
];

function modelKnowledgeCutoff(modelName) {
  const name = String(modelName || '').toLowerCase();
  const hit = MODEL_CUTOFFS.find(([prefix]) => name.startsWith(prefix));
  return hit ? hit[1] : { label: null, labelAr: null, year: null };
}

// Things that change over time. Deliberately about the WORLD, not the user.
// Each word is narrowed to its "about the world now" sense: not "electric
// current", "current directory", "stock a pantry", "population standard
// deviation", "z-scores" or "release the lock".
const TIME_SENSITIVE_EN = new RegExp(String.raw`\b(` + [
  'latest', 'newest', 'most recent',
  String.raw`(?<!(electric(al)?|alternating|direct|ocean|air|eddy) )current(?! (working )?(directory|dir|path|folder|file|user|thread|line|index|element|node|item|row|state|value|context|density|flow|limit|source|page|selection|position|frame|scope|branch|commit|process|window|tab|locale|schema|time zone|timezone)\b)(ly)?`,
  'right now', 'nowadays', 'as of (today|now)', `today'?s`, 'tonight', 'this (week|month|year)', 'recent(ly)?(?! used)', 'upcoming',
  'so far', 'anymore', 'still (the|a|an|in|at|alive|open|available|running|free)', 'news', 'headlines?',
  'pric(e|es|ing)(?! (elasticity|discrimination|ceiling|floor|theory|mechanism)s?\\b)', 'costs? now',
  'stock (price|market|quote|value)s?', 'stocks (today|now|to buy)', 'share price', 'market cap', 'exchange rate',
  'interest rates?', 'inflation', 'weather', 'forecast', '(live|final|match|game|latest) scores?', 'score of the (match|game)',
  'standings', 'election', 'polls', 'opinion poll',
  'who (is|are) (the )?(current |new )?(president|prime minister|ceo|leader|king|champion|owner)',
  'net worth', 'richest', 'population (of|in)',
  '(is|was|be|been|get|got|gets|just|newly|recently) released', 'release date', 'new release', 'new version', 'latest version',
  '(is|was|been|just|recently) (announced|launched)', String.raw`when (does|did|will|is|was) [\w .-]{1,40} (release|released|launch|launched|come out|came out)`
].join('|') + String.raw`)\b`, 'i');
const TIME_SENSITIVE_AR = /الآن|الان|حالياً|حاليا|اليوم|أحدث|احدث|آخر (إصدار|اصدار|الأخبار|الاخبار|نسخة|تحديث)|الأخبار|الاخبار|سعر|أسعار|اسعار|الطقس|نتيجة|نتائج|مباراة|انتخابات|من هو رئيس|من هو الرئيس|الرئيس الحالي|صافي ثروة|ثروة|عدد سكان|إصدار|اصدار|هذا العام|هذه السنة|هذا الشهر|هذا الأسبوع|مؤخراً|مؤخرا/;

// Questions about the user's OWN past, attached files or project are answered
// from memory/files — never by searching the web.
// Narrow on purpose: a false match switches the web off for the question.
// "the last time Egypt qualified", "my GPU memory", "my family history" and
// "تحدثت الصحف" are about the world, not the user's chats.
const PERSONAL_RE = /\b(did (i|we|you)|have (i|we)|i (asked|said|told|mentioned|decided|wrote)|we (decided|discussed|talked)|you (told|advised|suggested|recommended|said to) me|(did|what did) (chatgpt|claude|gemini|it) (say|suggest|advise|recommend|tell)|my (last|previous|past|earlier|old) (chat|conversation|question)|(my|our) (\w+ ){0,2}(chats?|conversations?)|(my|our) (\w+ )?(chat|conversation|message|ai|claude|chatgpt|gemini) history|(my|our|your) memories|(in|from) (my|your|the app's) memory|what('s| is) in (my|your) memory|last time (i|we|you)|remember when (i|we|you)|in (my|our) (chat|conversation|history|memory))\b|سألت|ناقشنا|ناقشت معك|تحدثنا|تحدثت معك|قلنا|قلت لك|قلت لي|نصحتني|اقترحت علي|أخبرتني|اخبرتني|محادثتي|محادثاتي|دردشتي|ذاكرتي|في الذاكرة|(آخر|اخر) مرة (سألت|سالت|سألتك|سالتك|تحدثنا|تكلمنا|قلت|ناقشنا|كلمتك)/i;

// Programming questions: "current directory", "filter year = 2025", "stock
// list" — only a strong time word ("latest version", "deprecated") makes them current.
const CODE_CONTEXT_RE = /```|`[^`\n]+`|\b(python|javascript|typescript|java|c\+\+|c#|golang|rust|sql|pandas|numpy|regex|dataframe|json|csv|bash|powershell|npm|pip|git|variable|array|compile|syntax|code|script)\b|[=!<>]=|\w\(\)/i;
const STRONG_TIME_RE = /\b(latest|newest|most recent|right now|today'?s?|news|release date|new version|latest version|still (supported|maintained)|deprecated|end of life)\b|أحدث|احدث|آخر إصدار|اخر اصدار|آخر نسخة|اخر نسخة/i;

function isPersonalMemoryQuestion(text) {
  return PERSONAL_RE.test(String(text || ''));
}

/**
 * @returns {{ needed: boolean, reason: string|null }}
 */
// "my latest chat", "what did I ask Claude recently", "آخر محادثة": time words
// about the user's own chats, not about the world
const OWN_CHAT_TIME_RE = /\b(latest|last|recent|previous|most recent|newest|earlier|prior)\s+(\w+\s+)?(chats?|conversations?|convos?|threads?|messages?|sessions?|questions?)\b|\b(recently|lately)\b|(اخر|آخر|احدث|أحدث)\s+(محادث|دردش|رسال|سؤال)\S*/gi;

function needsFreshInfo(userText, { cutoffYear = null, now = new Date(), hasDocuments = false, isProjectQuestion = false, includePersonal = false } = {}) {
  let text = String(userText || '');
  if (includePersonal) text = text.replace(OWN_CHAT_TIME_RE, ' ');
  // includePersonal: also look inside questions about the user's own chats
  // ("in my trading chats, what lot size did I use, and what's the gold price today?")
  if (!text.trim() || (!includePersonal && isPersonalMemoryQuestion(text)) || hasDocuments || isProjectQuestion) return { needed: false, reason: null };
  if (CODE_CONTEXT_RE.test(text)) {
    return STRONG_TIME_RE.test(text)
      ? { needed: true, reason: 'asks about something that changes over time' }
      : { needed: false, reason: null };
  }

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
const DISCLAIMER_RE = /training data|as of my|knowledge cut-?off|information is (only )?(as of|up to|current as of)|as of (around |about )?(late |early |mid[- ])?(\w+ )?(19|20)\d{2}|may (be out of date|be outdated|have changed)|no internet (connection|access)|without (an )?internet|(i am|i'm|currently|you are|you're|we are) offline|بيانات تدريبي|حتى تاريخ|قد لا تكون محدّثة|قد لا تكون محدثة|قد تكون تغيرت|قد تكون تغيّرت|غير متصل|لا يوجد اتصال|تدريبي/i;

function hasTrainingDisclaimer(answer) {
  return matchesEither(DISCLAIMER_RE, String(answer || ''));
}

// The answer tells the user to turn on the Search button ("turn on **Search**",
// "the Search button", "فعّل زر Search") — not just any sentence starting with "Search".
const SEARCH_BUTTON_RE = /\b([Tt]urn(ing)? on|[Ee]nabl(e|ing)|[Ss]witch(ing)? on|[Cc]lick(ing)?|[Pp]ress(ing)?|[Aa]ctivat(e|ing))\s+(the\s+)?[*"“'`]*Search\b|\bSearch[*"”'`]*\s+(button|toggle|option|switch)|(زر|خيار|تفعيل|فعّل|فعل|شغّل|شغل)\s*[*"“'`]*\s*Search\b/;

function mentionsSearchButton(answer) {
  return SEARCH_BUTTON_RE.test(String(answer || ''));
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
 * Whether to search the web BEFORE the model answers. Athar goes online only
 * when the user turned on "Search" in the message box. A model with tools is
 * told to search itself; for one without tools the app searches every
 * question first (`always`). Otherwise only time-sensitive questions
 * ("latest…", prices, news) that nothing local covers.
 * @returns {{ search: boolean, reason: 'always'|'fresh'|null }}
 */
function shouldSearchFirst(text, { fresh, searchOn = false, always = false, hasLocalContext = false, hasDocuments = false, isProjectQuestion = false } = {}) {
  const t = String(text || '').trim();
  // always: every question (a model without tools, with Search on — it can't search itself)
  if (always && searchOn && t && !isSmallTalk(t) && !isPersonalMemoryQuestion(t) && !hasDocuments && !isProjectQuestion) {
    return { search: true, reason: 'always' };
  }
  if (!searchOn || !t || !(fresh && fresh.needed) || isSmallTalk(t) || isPersonalMemoryQuestion(t) ||
      hasLocalContext || hasDocuments || isProjectQuestion) {
    return { search: false, reason: null };
  }
  return { search: true, reason: 'fresh' };
}

// The user explicitly asks for a web search: "search the web for…", "look it
// up", "google it", "check online", "ابحث عن…", "دور على…", "من الإنترنت".
// Mid-conversation the request is often short and follows a word or two
// ("ok search it", "no, search again", "I told you to search").
// Not: "find the bug on line 12", "look on the bright side", "data travels on
// the internet", "Search algorithms: …", "how does web search work".
const EXPLICIT_WEB_EN = new RegExp([
  String.raw`\b(search|look|google|browse|check|find)\b[^.?!\n]{0,20}\b(online|the web|the internet|google)\b`,
  String.raw`^\s*((ok(ay)?|so|now|then|and|but|no|yes|yeah|just|well|please|pls)\b[,.!]?\s+){0,3}(can you\s+|could you\s+|would you\s+)?(search|google|look (it |this |that |them )?up|browse)\b` +
    String.raw`(?!\s+(algorithms?|engines?|bar|box|results?|functions?|quer(y|ies)|trees?|space|index(es)?|features?|terms?|console|params?|parameters|history|operators?|api|methods?|in|with|and|is|are|was)\b)(?![:-])`,
  String.raw`\b(look (it|this|that|them) up|google (it|this|that)|search (for |about )?(it|this|that|them)|search again|search first)\b`,
  String.raw`\b(told|asked) you to (search|google|look (it |this |that )?up|browse|check (online|the web|the internet))\b`,
  String.raw`\b(use|check|try|search) the (web|internet|net)\b|\b(do|run|make) a (quick )?(web|google|online) search\b`
].join('|'), 'i');
// Matched against normalized text (ا for أ/إ/آ, ه for ة, ي for ى). "دور" alone
// is also "role" and "دوري" is "league", "جوجل" alone is just the company.
const EXPLICIT_WEB_AR = new RegExp([
  String.raw`(^|\s)(ابحث|ابحثي|ابحثوا|فتش|فتشي|ابحثلي|دورلي)(\s|$|[؟?.!،,])`,
  String.raw`(^|\s)(دور|دوري)\s+(لي\s+)?(علي|عن)\S*`,
  String.raw`(ابحث|دور|فتش|شوف|اعرف|تحقق|تاكد|جيب|هات|اجلب|احضر)\S*\s+(\S+\s+){0,5}(علي|في|من)\s+(ال)?(انترنت|نت|ويب)`,
  String.raw`(استخدم|استعمل)\s+(ال)?(انترنت|نت|بحث)`,
  String.raw`(ابحث|دور|فتش|شوف)\S*\s+(\S+\s+){0,3}(في|علي|ب)\s*(جوجل|قوقل|غوغل)`
].join('|'));
// …but "search my chats / memory for X" is a memory search, not the web
const OWN_SEARCH_RE = /\b(search|look|find)\b[^.?!\n]{0,25}\b(my|our)\s+(\w+\s+)?(chats?|conversations?|memory|memories|history|files?|notes?)\b|(ابحث|دور|فتش)\S*\s+(في\s+)?(محادثاتي|ذاكرتي|الذاكره|ملفاتي)/i;

/** Did the user ask to search the web (as opposed to leaving it to the app)? */
function asksForWebSearch(text) {
  const t = String(text || '');
  const norm = normalizeArabicText(t);
  if (OWN_SEARCH_RE.test(t) || OWN_SEARCH_RE.test(norm)) return false;
  return EXPLICIT_WEB_EN.test(t) || EXPLICIT_WEB_AR.test(norm);
}

const SEARCH_VERB_RE = /\b(search|look|find|google|check|browse)\b/i;

/** The subject to search for, without "search the web for", "ابحث عن"… */
function stripSearchCommand(text) {
  const out = String(text || '')
    // Greetings in front of the question: "hi, which is better…", "مرحبا، ما هو…"
    .replace(/^\s*(hi|hello|hey|good (morning|evening))\b[\s,.!]*/i, '')
    .replace(/^\s*(مرحبا|اهلا|أهلا|السلام عليكم|صباح الخير|مساء الخير)[\s،,.!]*/, '')
    .replace(/^\s*((ok(ay)?|so|now|then|and|but|no|yes|yeah|just|well|please|pls)\b[,.!]?\s+){0,3}(can you\s+|could you\s+|would you\s+)?(search|google|browse|look up|look for|find)(\s+(the\s+)?(web|internet|online|google))?(\s+(for|about|on))?\s+/i, '')
    .replace(/\s*,?\s*(and\s+)?(please\s+)?(search|look|check)\s+(it|this|that)?\s*(up\s+)?(on(line)?|the web|the internet)?\s*[.!?]*$/i, '')
    // Only a trailing "…on the web" / "online" of a search command: "best online
    // courses" and "how does data travel on the internet?" keep their words
    .replace(/\s*\b(on|from) the (web|internet)\s*([.!?]*)$/i, (m, _on, _web, end) => (SEARCH_VERB_RE.test(text) ? end : m))
    .replace(/\s+online\s*([.!?]*)$/i, (m, end) => (SEARCH_VERB_RE.test(text) ? end : m))
    .replace(/^\s*(ابحث|ابحثي|دور|فتش)(\s*لي)?(\s+(في|على)\s+(ال)?(انترنت|إنترنت|نت|ويب))?(\s+(عن|على))?\s+/, '')
    .replace(/\s*(من|على|في)\s+(ال)?(انترنت|إنترنت|نت|ويب)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out || String(text || '').trim();
}

/**
 * A placeholder the model wrote instead of a fact it doesn't have:
 * "[gold_price]", "[current date]", "[السعر]". (Not citations like [M1] and
 * not Markdown links.)
 */
const PLACEHOLDER_RE = /\[(?!M\d+\])[^\]\n]{0,25}(price|date|value|amount|number|rate|figure|name|year|time|سعر|السعر|تاريخ|التاريخ|قيمة|القيمة|رقم)[^\]\n]{0,25}\](?!\()/i;

function hasPlaceholder(text) {
  const prose = String(text || '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  return PLACEHOLDER_RE.test(prose);
}

// Words that say nothing about what is being searched for
const QUERY_STOPWORDS = new Set(('the and for with from that this these those which what who whom whose when where why how are was were ' +
  'is be been have has had not but you your our their them they its it can could would should will does did about into than then ' +
  'there here any some more most best better good also only just very okay please tell show give search find look online web ' +
  'internet google hi hello hey thanks one ones other others them each all both either offers offer ' +
  'في من على عن الى إلى هل ما ماذا هذا هذه ذلك تلك التي الذي او أو ثم كل بعض اي أي مع انا أنت هو هي لي ابحث افضل أفضل احسن أحسن').split(/\s+/));

function subjectWords(text) {
  const words = normalizeArabicText(String(text || '').toLowerCase()).split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length >= 3 && !QUERY_STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Is a web search query still about what the user asked? It must share at
 * least one subject word (a name, a topic) with the message and the last turns:
 * "w3schools arabic" for "harmash or w3schools?" does, "web development
 * resources" doesn't.
 */
function sharesSubject(query, reference) {
  const ref = subjectWords(reference);
  if (ref.size === 0) return true; // nothing to judge by
  for (const w of subjectWords(query)) {
    if (ref.has(w)) return true;
    // "w3schools.com" vs "w3schools", "harmash" vs "harmash's"
    for (const r of ref) if (w.length >= 5 && r.length >= 5 && (w.startsWith(r) || r.startsWith(w))) return true;
  }
  return false;
}

module.exports = {
  sharesSubject,
  modelKnowledgeCutoff,
  needsFreshInfo,
  shouldSearchFirst,
  asksForWebSearch,
  stripSearchCommand,
  hasPlaceholder,
  isSmallTalk,
  isPersonalMemoryQuestion,
  looksUncertainOrDated,
  hasTrainingDisclaimer,
  mentionsSearchButton,
  offlineNote,
  offlineInstruction,
  isArabic
};
