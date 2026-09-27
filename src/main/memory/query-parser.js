/**
 * Pulls time and source hints out of a memory question:
 *   "what did I ask Claude about Postgres last spring?"
 *   → { dateRange: Mar 1–Jun 1 of the latest finished spring, sources: ['claude'],
 *       text: 'what did I ask about Postgres?' }
 *
 * `text` is the question with the recognised hint phrases removed, so words
 * like "Claude" or "last year" (which never appear in the conversations
 * themselves) don't dilute the search. Dates resolve against `now`. Common
 * English and Arabic phrasings; anything unrecognised is simply not a filter.
 */

const DAY = 86400000;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const AR_MONTHS = {
  'يناير': 0, 'كانون الثاني': 0, 'فبراير': 1, 'شباط': 1, 'مارس': 2, 'اذار': 2, 'أذار': 2, 'آذار': 2, 'ابريل': 3, 'أبريل': 3, 'نيسان': 3,
  'مايو': 4, 'ايار': 4, 'أيار': 4, 'يونيو': 5, 'حزيران': 5, 'يوليو': 6, 'تموز': 6, 'اغسطس': 7, 'أغسطس': 7, 'آب': 7,
  'سبتمبر': 8, 'ايلول': 8, 'أيلول': 8, 'اكتوبر': 9, 'أكتوبر': 9, 'تشرين الاول': 9, 'تشرين الأول': 9,
  'نوفمبر': 10, 'تشرين الثاني': 10, 'ديسمبر': 11, 'كانون الاول': 11, 'كانون الأول': 11
};

function monthIndex(word) {
  const w = word.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w));
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthRange = (y, m) => ({ from: new Date(y, m, 1), to: new Date(y, m + 1, 1) });
const yearRange = (y) => ({ from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) });

/** Northern-hemisphere meteorological seasons. */
function seasonRange(season, year) {
  switch (season) {
    case 'spring': return { from: new Date(year, 2, 1), to: new Date(year, 5, 1) };
    case 'summer': return { from: new Date(year, 5, 1), to: new Date(year, 8, 1) };
    case 'fall': case 'autumn': return { from: new Date(year, 8, 1), to: new Date(year, 11, 1) };
    case 'winter': return { from: new Date(year, 11, 1), to: new Date(year + 1, 2, 1) };
    default: return null;
  }
}

/** "last spring" = the most recent spring that has already ended. */
function lastSeason(season, now) {
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    const r = seasonRange(season, y);
    if (r.to <= now) return r;
  }
  return seasonRange(season, now.getFullYear() - 1);
}

/** Returns { from, to, label, match, soft? } or null. `match` is the exact phrase found in `q`. */
function parseDateRange(q, now) {
  const today = startOfDay(now);
  const y = now.getFullYear();
  const PRE = '(?:(?:in|during|from|over|on|back in)\\s+)?'; // optional preposition, removed with the phrase
  let m;
  const hit = (re) => (m = q.match(re));

  // ── English ──
  if (hit(new RegExp(`\\b${PRE}today\\b`))) return { from: today, to: new Date(+today + DAY), label: 'today', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}yesterday\\b`))) return { from: new Date(+today - DAY), to: today, label: 'yesterday', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}this week\\b`))) return { from: new Date(+today - 7 * DAY), to: new Date(+today + DAY), label: 'this week', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}last week\\b`))) return { from: new Date(+today - 14 * DAY), to: new Date(+today - 6 * DAY), label: 'last week', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}this month\\b`))) return { ...monthRange(y, now.getMonth()), label: 'this month', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}last month\\b`))) return { ...monthRange(y, now.getMonth() - 1), label: 'last month', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}this year\\b`))) return { ...yearRange(y), label: 'this year', match: m[0] };
  if (hit(new RegExp(`\\b${PRE}last year\\b`))) return { ...yearRange(y - 1), label: 'last year', match: m[0] };
  if (hit(/\b(recently|lately|(?:in |over )?the (?:last|past) few (?:days|weeks))\b/)) {
    return { from: new Date(+today - 30 * DAY), to: new Date(+today + DAY), label: 'recently', match: m[0] };
  }

  if (hit(/\b(\d{1,2}|a|an|one|two|three|four|five|six)\s+(day|week|month|year)s?\s+ago\b/)) {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[m[1]] || Number(m[1]);
    const unitDays = { day: 1, week: 7, month: 30, year: 365 }[m[2]];
    const center = +today - n * unitDays * DAY;
    const half = Math.max(1, unitDays * 0.5) * DAY;
    return { from: new Date(center - half), to: new Date(center + half + DAY), label: m[0], match: m[0] };
  }

  if (hit(new RegExp(`\\b${PRE}(last|this|past)\\s+(spring|summer|fall|autumn|winter)\\b`))) {
    const r = m[1] === 'this' ? seasonRange(m[2], m[2] === 'winter' && now.getMonth() < 2 ? y - 1 : y) : lastSeason(m[2], now);
    return { ...r, label: `${m[1]} ${m[2]}`, match: m[0] };
  }
  if (hit(new RegExp(`\\b${PRE}(spring|summer|fall|autumn|winter)\\s+(?:of\\s+)?(20\\d{2}|19\\d{2})\\b`))) {
    return { ...seasonRange(m[1], Number(m[2])), label: `${m[1]} ${m[2]}`, match: m[0] };
  }

  if (hit(new RegExp(`\\b${PRE}(?:last\\s+)?${MONTH_RE}\\s+(?:of\\s+)?(20\\d{2}|19\\d{2})\\b`))) {
    return { ...monthRange(Number(m[2]), monthIndex(m[1])), label: `${m[1]} ${m[2]}`, match: m[0] };
  }
  // A bare month needs a preposition: "may" alone is usually the verb.
  if (hit(new RegExp(`\\b(in|during|last|this|back in)\\s+${MONTH_RE}\\b`))) {
    const mi = monthIndex(m[2]);
    const current = now.getMonth();
    // "in/this March" = the most recent March that has started;
    // "last March"    = the most recent March before the current month.
    const year = m[1] === 'last' ? (mi < current ? y : y - 1) : (mi <= current ? y : y - 1);
    return { ...monthRange(year, mi), label: `${MONTHS[mi]} ${year}`, match: m[0] };
  }
  if (hit(/\b(?:in|during|from|back in)\s+(20\d{2}|19\d{2})\b/)) {
    return { ...yearRange(Number(m[1])), label: m[1], match: m[0] };
  }
  // A bare year ("the 2024 election") is often the TOPIC, not when the chat
  // happened — it only boosts matching dates and stays in the search text.
  if (hit(/\b(20\d{2}|19\d{2})\b/)) {
    return { ...yearRange(Number(m[1])), label: m[1], soft: true, match: null };
  }

  // ── Arabic ──
  const AR_PRE = '(?:(?:في|خلال|من)\\s+)?';
  if (hit(new RegExp(`${AR_PRE}اليوم`))) return { from: today, to: new Date(+today + DAY), label: 'اليوم', match: m[0] };
  if (hit(/(امس|أمس|البارحة)/)) return { from: new Date(+today - DAY), to: today, label: 'أمس', match: m[0] };
  if (hit(new RegExp(`${AR_PRE}(الاسبوع|الأسبوع) (الماضي|الفائت)`))) return { from: new Date(+today - 14 * DAY), to: new Date(+today - 6 * DAY), label: 'الأسبوع الماضي', match: m[0] };
  if (hit(new RegExp(`${AR_PRE}هذا (الاسبوع|الأسبوع)`))) return { from: new Date(+today - 7 * DAY), to: new Date(+today + DAY), label: 'هذا الأسبوع', match: m[0] };
  if (hit(new RegExp(`${AR_PRE}الشهر (الماضي|الفائت|السابق)`))) return { ...monthRange(y, now.getMonth() - 1), label: 'الشهر الماضي', match: m[0] };
  if (hit(new RegExp(`${AR_PRE}هذا الشهر`))) return { ...monthRange(y, now.getMonth()), label: 'هذا الشهر', match: m[0] };
  if (hit(new RegExp(`${AR_PRE}(السنة|العام) (الماضي|الماضية|الفائت|الفائتة|السابق|السابقة)`))) return { ...yearRange(y - 1), label: 'العام الماضي', match: m[0] };
  if (hit(new RegExp(`${AR_PRE}(هذه السنة|هذا العام)`))) return { ...yearRange(y), label: 'هذا العام', match: m[0] };
  if (hit(/(مؤخرا|مؤخراً|في الفترة الاخيرة|في الفترة الأخيرة)/)) return { from: new Date(+today - 30 * DAY), to: new Date(+today + DAY), label: 'مؤخراً', match: m[0] };
  for (const [name, mi] of Object.entries(AR_MONTHS)) {
    const re = new RegExp(`${AR_PRE}(?:شهر\\s+)?${name}(?:\\s+(20\\d{2}|19\\d{2}))?`);
    if (hit(re)) {
      const year = m[1] ? Number(m[1]) : (mi <= now.getMonth() ? y : y - 1);
      return { ...monthRange(year, mi), label: `${name} ${year}`, match: m[0] };
    }
  }
  return null;
}

const SRC_PRE = '(?:(?:in|on|from|with|using|via)\\s+)?';
const SOURCE_PATTERNS = [
  ['chatgpt', new RegExp(`\\b${SRC_PRE}(?:chat\\s?gpt|gpt-?[345o]\\w*|openai)\\b|(?:(?:في|مع|من)\\s+)?(?:شات|تشات) ?جي ?بي ?تي`, 'g')],
  ['claude', new RegExp(`\\b${SRC_PRE}claude\\b|(?:(?:في|مع|من)\\s+)?كلود`, 'g')],
  ['gemini', new RegExp(`\\b${SRC_PRE}(?:gemini|bard)\\b|(?:(?:في|مع|من)\\s+)?(?:جيميني|جيمناي|جمناي)`, 'g')],
  ['app', /\b(?:in this app|here in the app|in chat memory|in athar|in-app)\b/g]
];

function tidy(text) {
  return text
    .replace(/\s+([?.!,،؟])/g, '$1')
    .replace(/\b(in|on|from|with|during|about)\s*([?.!]|$)/gi, '$2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * @returns {{ dateRange: object|null, sources: string[]|null, text: string }}
 */
function parseMemoryQuery(query, now = new Date()) {
  const original = String(query || '');
  const q = original.toLowerCase();
  let text = original;

  const sources = [];
  for (const [name, re] of SOURCE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(q)) {
      sources.push(name);
      re.lastIndex = 0;
      text = text.replace(new RegExp(re.source, 'gi'), ' ');
    }
  }

  const dateRange = parseDateRange(q, now);
  if (dateRange && dateRange.match) {
    const idx = text.toLowerCase().indexOf(dateRange.match);
    if (idx >= 0) text = `${text.slice(0, idx)} ${text.slice(idx + dateRange.match.length)}`;
  }

  return { dateRange, sources: sources.length ? sources : null, text: tidy(text) };
}

module.exports = { parseMemoryQuery };
