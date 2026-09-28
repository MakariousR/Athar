/**
 * Which language the answer must be in, decided in code rather than left to
 * the model: small local models drift into the language of the context they
 * were given (English memories, an English web page) instead of the
 * question's.
 *
 *   replyLanguage(text, history) → the language the user asked for
 *     ("answer in English", "ترجم إلى الفرنسية"), else the language of the
 *     message, else (for "ok", "why?") the language of their previous messages.
 *   matchesLanguage(answer, lang) → is the answer (code, links and product
 *     names aside) actually written in that language?
 */
const { normalizeArabicText } = require('../utils/text-normalizer');

const LANGUAGES = {
  en: { name: 'English', native: 'English', say: 'Reply in English.', names: ['english', 'انجليزي', 'انجليزيه', 'انكليزي', 'انكليزيه'] },
  ar: { name: 'Arabic', native: 'العربية', say: 'أجب باللغة العربية.', names: ['arabic', 'عربي', 'عربيه'] },
  fr: { name: 'French', native: 'français', say: 'Réponds en français.', names: ['french', 'فرنسي', 'فرنسيه'] },
  es: { name: 'Spanish', native: 'español', say: 'Responde en español.', names: ['spanish', 'اسباني', 'اسبانيه'] },
  de: { name: 'German', native: 'Deutsch', say: 'Antworte auf Deutsch.', names: ['german', 'الماني', 'المانيه'] },
  it: { name: 'Italian', native: 'italiano', say: 'Rispondi in italiano.', names: ['italian', 'ايطالي', 'ايطاليه'] },
  pt: { name: 'Portuguese', native: 'português', say: 'Responda em português.', names: ['portuguese', 'برتغالي', 'برتغاليه'] },
  nl: { name: 'Dutch', native: 'Nederlands', say: 'Antwoord in het Nederlands.', names: ['dutch', 'هولندي', 'هولنديه'] },
  tr: { name: 'Turkish', native: 'Türkçe', say: 'Türkçe cevap ver.', names: ['turkish', 'تركي', 'تركيه'] },
  id: { name: 'Indonesian', native: 'Bahasa Indonesia', say: 'Jawab dalam bahasa Indonesia.', names: ['indonesian', 'اندونيسي', 'اندونيسيه'] },
  ru: { name: 'Russian', native: 'русский', say: 'Отвечай по-русски.', names: ['russian', 'روسي', 'روسيه'] },
  fa: { name: 'Persian', native: 'فارسی', say: 'به فارسی پاسخ بده.', names: ['persian', 'farsi', 'فارسي', 'فارسيه'] },
  ur: { name: 'Urdu', native: 'اردو', say: 'اردو میں جواب دیں۔', names: ['urdu', 'اردو', 'اورديه'] },
  he: { name: 'Hebrew', native: 'עברית', say: 'ענה בעברית.', names: ['hebrew', 'عبري', 'عبريه'] },
  hi: { name: 'Hindi', native: 'हिन्दी', say: 'हिंदी में जवाब दें।', names: ['hindi', 'هندي', 'هنديه'] },
  zh: { name: 'Chinese', native: '中文', say: '请用中文回答。', names: ['chinese', 'mandarin', 'صيني', 'صينيه'] },
  ja: { name: 'Japanese', native: '日本語', say: '日本語で答えてください。', names: ['japanese', 'ياباني', 'يابانيه'] },
  ko: { name: 'Korean', native: '한국어', say: '한국어로 답해 주세요.', names: ['korean', 'كوري', 'كوريه'] }
};
for (const [code, lang] of Object.entries(LANGUAGES)) lang.code = code;

// Languages recognised by their alphabet
const SCRIPTS = [
  ['ar', /[ء-ي٠-٩ٱ-ۓ۰-۹]/g],
  ['he', /[֐-׿]/g],
  ['ru', /[Ѐ-ӿ]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['ko', /[가-힯ᄀ-ᇿ]/g],
  ['ja', /[぀-ヿ]/g],
  ['zh', /[一-鿿]/g]
];
const PERSIAN_RE = /[پچژگ]/;   // letters Arabic doesn't use
const URDU_RE = /[ٹڈڑںے]/;

// Latin-alphabet languages: their most common small words, and telltale letters
const COMMON_WORDS = {
  en: 'the is are was and what how why you your my of to in it this that with for do does can i me about tell please which when where',
  fr: 'le la les est sont et que qui quoi comment je tu vous mon ma mes vos nos des une un en pour avec dans pas ce du au sur pourquoi quel quelle quels quelles suis avez',
  es: 'el la los las es y que qué cómo como yo tú mi de una un para con en por está del al pero muy cuál dónde',
  de: 'der die das ist und was wie ich du mein ein eine mit für nicht auf zu den dem sie warum welche wo bitte',
  it: 'il lo la gli è e che cosa come io tu mio di una un per con non sono del della perché quale dove',
  pt: 'o a os as é e que como eu você meu de uma um para com não do da em por quê qual onde',
  nl: 'de het een is en wat hoe ik jij mijn van voor met niet dat op waarom welke waar',
  tr: 've bir bu ne nasıl ben sen benim için ile mi mı değil var çok neden hangi nerede',
  id: 'yang dan di ini itu apa bagaimana saya kamu untuk dengan tidak ada dari mengapa'
};
// One-letter words ("a", "o", "e", "y") are left out: "a" is English as much
// as Portuguese, so they'd make "write a function that reverses a list" Portuguese.
const COMMON = Object.fromEntries(Object.entries(COMMON_WORDS).map(([k, v]) => [k, new Set(v.split(' ').filter((w) => w.length > 1))]));
const LETTER_HINTS = [
  ['es', /[ñ¿¡]/g], ['pt', /[ãõ]/g], ['de', /ß/g], ['tr', /[ığş]/g], ['fr', /[êëœ]|\bc'est\b|\bqu'/g]
];

const QUOTED_RE = /"[^"\n]{1,120}"|“[^”\n]{1,120}”|«[^»\n]{1,120}»/g;

/** Prose only: code, links, e-mail addresses and markdown syntax removed. */
function proseOf(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g, ' ')
    .replace(/[#*_>|~[\]()]/g, ' ');
}

/** The language a text is written in, or null when there's too little to tell. */
function detectLanguage(text) {
  // A quoted title in another language ('my chat "خطة الحديقة"') doesn't
  // change the language of the question — unless the quote is all there is
  const unquoted = proseOf(text).replace(QUOTED_RE, ' ');
  const prose = /\p{L}/u.test(unquoted) ? unquoted : proseOf(text);
  const words = prose.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return null;

  // Another alphabet wins over English product names and code words
  // ("كيف أصلح docker compose error" is Arabic)
  for (const [code, re] of SCRIPTS) {
    const scriptWords = words.filter((w) => (w.match(re) || []).length >= Math.ceil(w.length / 2)).length;
    if (scriptWords >= 2 || scriptWords / words.length >= 0.3 || (scriptWords === 1 && words.length <= 2)) {
      if (code === 'ar') return LANGUAGES[URDU_RE.test(prose) ? 'ur' : PERSIAN_RE.test(prose) ? 'fa' : 'ar'];
      if (code === 'zh' && /[぀-ヿ]/.test(prose)) return LANGUAGES.ja;
      return LANGUAGES[code];
    }
  }

  const latinWords = words.map((w) => w.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '')).filter(Boolean);
  const scores = {};
  for (const [code, set] of Object.entries(COMMON)) scores[code] = latinWords.filter((w) => set.has(w)).length;
  for (const [code, re] of LETTER_HINTS) scores[code] += 2 * (prose.toLowerCase().match(re) || []).length;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = ranked;
  if (top >= 2 && top > second) return LANGUAGES[best];
  if (top >= 1 && second === 0) return LANGUAGES[best];
  // Plain ASCII words with no sign of another language ("write python code to reverse list")
  if (top === 0 && latinWords.length >= 3 && /^[\x00-\x7F]*$/.test(prose)) return LANGUAGES.en;
  return null;
}

// "answer in English", "translate this into French", "in Spanish please",
// "أجب بالإنجليزية", "ترجم إلى الفرنسية", "اشرح بالعربي"
const NAME_TO_CODE = new Map();
for (const lang of Object.values(LANGUAGES)) for (const n of lang.names) NAME_TO_CODE.set(n, lang.code);
const LATIN_NAMES = [...NAME_TO_CODE.keys()].filter((n) => /^[a-z]+$/.test(n)).join('|');
const ARABIC_NAMES = [...NAME_TO_CODE.keys()].filter((n) => !/^[a-z]+$/.test(n)).join('|');
const REQUEST_EN_RE = new RegExp(String.raw`\b(?:answer|reply|respond|write|say|speak|explain|translate|rewrite|summari[sz]e|talk|tell me)\b[^.?!\n]{0,40}?\b(?:in|into|to)\s+(${LATIN_NAMES})\b|\bin\s+(${LATIN_NAMES})\s*(?:please|pls)\b|^\s*(?:in\s+)?(${LATIN_NAMES})\s*(?:please|pls)?\s*[.!]?\s*$`, 'i');
const REQUEST_AR_RE = new RegExp(String.raw`(?:اجب|رد|جاوب|اكتب|ترجم|تكلم|لخص|اشرح|قل|وضح)[^.؟?!\n]{0,40}?(?:ب|الي|ل)\s*(?:اللغه\s*)?ال(${ARABIC_NAMES})(?![ء-ي])|(?:^|\s)بال(${ARABIC_NAMES})\s*[.!؟?]?\s*$|باللغه\s+ال(${ARABIC_NAMES})(?![ء-ي])`);

/** The language the user explicitly asked the answer to be in, if any. */
function requestedLanguage(text) {
  const s = String(text || '');
  const en = s.match(REQUEST_EN_RE);
  const enName = en && (en[1] || en[2] || en[3]);
  if (enName) return LANGUAGES[NAME_TO_CODE.get(enName.toLowerCase())];
  const ar = normalizeArabicText(s).match(REQUEST_AR_RE);
  const arName = ar && (ar[1] || ar[2] || ar[3]);
  if (arName) return LANGUAGES[NAME_TO_CODE.get(arName)];
  return null;
}

/** The language to answer in (see the top of this file), or null if it can't be told. */
function replyLanguage(userText, history = []) {
  const asked = requestedLanguage(userText);
  if (asked) return asked;
  const earlierLanguage = () => {
    const earlier = (history || []).filter((m) => m && m.role === 'user').map((m) => m.text || m.content || '').reverse();
    if (earlier[0] === userText) earlier.shift(); // the history may already end with this message
    for (const text of earlier.slice(0, 4)) {
      const lang = requestedLanguage(text) || detectLanguage(text);
      if (lang) return lang;
    }
    return null;
  };
  const own = detectLanguage(userText);
  // "why?" / "ok" in the middle of an Arabic conversation: keep the conversation's language
  if (own && proseOf(userText).split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < 3) return earlierLanguage() || own;
  return own || earlierLanguage();
}

/**
 * Whether an answer is written in `lang`. Code, links and short answers pass;
 * product names and technical terms in English don't make an Arabic answer fail.
 */
function matchesLanguage(answer, lang) {
  if (!lang) return true;
  // Quoted titles and names ("Using the Weather API") are kept as written
  const prose = proseOf(answer).replace(QUOTED_RE, ' ');
  // Qwen models sometimes slip a Chinese phrase ("主要内容") into another language
  if (!['zh', 'ja', 'ko'].includes(lang.code) && /[一-鿿぀-ヿ]{2,}/.test(prose)) return false;
  const letters = (prose.match(/\p{L}/gu) || []).length;
  if (letters < 40) return true; // mostly code, a number, a name…
  const script = SCRIPTS.find(([code]) => code === (['fa', 'ur'].includes(lang.code) ? 'ar' : lang.code));
  if (script) {
    const inScript = (prose.match(script[1]) || []).length;
    return inScript / letters >= 0.35;
  }
  // Latin-alphabet target: no other alphabet may dominate, and a clearly
  // detected Latin language must be the right one
  const other = SCRIPTS.some(([, re]) => (prose.match(re) || []).length / letters > 0.3);
  if (other) return false;
  const found = detectLanguage(prose);
  return !found || found.code === lang.code || !COMMON[found.code];
}

module.exports = { LANGUAGES, detectLanguage, requestedLanguage, replyLanguage, matchesLanguage };
