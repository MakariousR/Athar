/**
 * Pulls time and source hints out of a memory question:
 *   "what did I ask Claude about Postgres last spring?"
 *   → { dateRange: Mar 1–May 31 of last year, sources: ['claude'] }
 *
 * Dates are resolved against `now`. Supports common English and Arabic
 * phrasings; anything not recognised is simply ignored (no filter).
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

/** Most recent completed-or-current season start that is before now ("last spring" = the latest spring that has begun... and ended). */
function lastSeason(season, now) {
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    const r = seasonRange(season, y);
    if (r.to <= now) return r;
  }
  return seasonRange(season, now.getFullYear() - 1);
}

function parseDateRange(q, now) {
  const today = startOfDay(now);
  const y = now.getFullYear();
  let m;

  // ── English ──
  if (/\btoday\b/.test(q)) return { from: today, to: new Date(+today + DAY), label: 'today' };
  if (/\byesterday\b/.test(q)) return { from: new Date(+today - DAY), to: today, label: 'yesterday' };
  if (/\bthis week\b/.test(q)) return { from: new Date(+today - 7 * DAY), to: new Date(+today + DAY), label: 'this week' };
  if (/\blast week\b/.test(q)) return { from: new Date(+today - 14 * DAY), to: new Date(+today - 6 * DAY), label: 'last week' };
  if (/\bthis month\b/.test(q)) return { ...monthRange(y, now.getMonth()), label: 'this month' };
  if (/\blast month\b/.test(q)) return { ...monthRange(y, now.getMonth() - 1), label: 'last month' };
  if (/\bthis year\b/.test(q)) return { ...yearRange(y), label: 'this year' };
  if (/\blast year\b/.test(q)) return { ...yearRange(y - 1), label: 'last year' };
  if (/\b(recently|lately|the last few (days|weeks))\b/.test(q)) return { from: new Date(+today - 30 * DAY), to: new Date(+today + DAY), label: 'recently' };

  if ((m = q.match(/\b(\d{1,2}|a|an|one|two|three|four|five|six)\s+(day|week|month|year)s?\s+ago\b/))) {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[m[1]] || Number(m[1]);
    const unitDays = { day: 1, week: 7, month: 30, year: 365 }[m[2]];
    const center = +today - n * unitDays * DAY;
    const half = Math.max(1, unitDays * 0.5) * DAY;
    return { from: new Date(center - half), to: new Date(center + half + DAY), label: m[0] };
  }

  if ((m = q.match(/\b(last|this|past)\s+(spring|summer|fall|autumn|winter)\b/))) {
    const r = m[1] === 'this' ? seasonRange(m[2], m[2] === 'winter' && now.getMonth() < 2 ? y - 1 : y) : lastSeason(m[2], now);
    return { ...r, label: m[0] };
  }
  if ((m = q.match(/\b(spring|summer|fall|autumn|winter)\s+(?:of\s+)?(20\d{2}|19\d{2})\b/))) {
    return { ...seasonRange(m[1], Number(m[2])), label: m[0] };
  }

  if ((m = q.match(new RegExp(`\\b(?:in\\s+|during\\s+|last\\s+)?${MONTH_RE}\\s+(?:of\\s+)?(20\\d{2}|19\\d{2})\\b`)))) {
    return { ...monthRange(Number(m[2]), monthIndex(m[1])), label: m[0].trim() };
  }
  if ((m = q.match(new RegExp(`\\b(in|during|last|this)\\s+${MONTH_RE}\\b`)))) {
    const mi = monthIndex(m[2]);
    const current = now.getMonth();
    // "in/this March" = the most recent March that has started;
    // "last March"    = the most recent March before the current month.
    const year = m[1] === 'last' ? (mi < current ? y : y - 1) : (mi <= current ? y : y - 1);
    return { ...monthRange(year, mi), label: m[0] };
  }
  if ((m = q.match(/\b(?:in|during|from|back in)\s+(20\d{2}|19\d{2})\b/))) {
    return { ...yearRange(Number(m[1])), label: m[1] };
  }
  // A bare year ("the 2024 election") is often the TOPIC, not when the chat
  // happened — so it only boosts matching dates instead of filtering.
  if ((m = q.match(/\b(20\d{2}|19\d{2})\b/))) {
    return { ...yearRange(Number(m[1])), label: m[1], soft: true };
  }

  // ── Arabic ──
  if (/اليوم/.test(q)) return { from: today, to: new Date(+today + DAY), label: 'اليوم' };
  if (/(امس|أمس|البارحة)/.test(q)) return { from: new Date(+today - DAY), to: today, label: 'أمس' };
  if (/(الاسبوع|الأسبوع) (الماضي|الفائت)/.test(q)) return { from: new Date(+today - 14 * DAY), to: new Date(+today - 6 * DAY), label: 'الأسبوع الماضي' };
  if (/هذا (الاسبوع|الأسبوع)/.test(q)) return { from: new Date(+today - 7 * DAY), to: new Date(+today + DAY), label: 'هذا الأسبوع' };
  if (/الشهر (الماضي|الفائت|السابق)/.test(q)) return { ...monthRange(y, now.getMonth() - 1), label: 'الشهر الماضي' };
  if (/هذا الشهر/.test(q)) return { ...monthRange(y, now.getMonth()), label: 'هذا الشهر' };
  if (/(السنة|العام) (الماضي|الماضية|الفائت|الفائتة|السابق|السابقة)/.test(q)) return { ...yearRange(y - 1), label: 'العام الماضي' };
  if (/(هذه السنة|هذا العام)/.test(q)) return { ...yearRange(y), label: 'هذا العام' };
  if (/(مؤخرا|مؤخراً|في الفترة الاخيرة|في الفترة الأخيرة)/.test(q)) return { from: new Date(+today - 30 * DAY), to: new Date(+today + DAY), label: 'مؤخراً' };
  for (const [name, mi] of Object.entries(AR_MONTHS)) {
    if (q.includes(name)) {
      const yearMatch = q.match(/(20\d{2}|19\d{2})/);
      const year = yearMatch ? Number(yearMatch[1]) : (mi <= now.getMonth() ? y : y - 1);
      return { ...monthRange(year, mi), label: name };
    }
  }
  return null;
}

const SOURCE_PATTERNS = [
  ['chatgpt', /\b(chat\s?gpt|gpt-?[345o]\w*|openai)\b|شات ?جي ?بي ?تي|تشات ?جي ?بي ?تي/],
  ['claude', /\bclaude\b|كلود/],
  ['gemini', /\b(gemini|bard)\b|جيميني|جيمناي|جمناي/],
  ['app', /\b(in this app|here in the app|in chat memory|in-app)\b/]
];

/**
 * @returns {{ dateRange: { from: Date, to: Date, label: string } | null, sources: string[] | null }}
 */
function parseMemoryQuery(query, now = new Date()) {
  const q = String(query || '').toLowerCase();
  const sources = SOURCE_PATTERNS.filter(([, re]) => re.test(q)).map(([name]) => name);
  return { dateRange: parseDateRange(q, now), sources: sources.length ? sources : null };
}

module.exports = { parseMemoryQuery };
