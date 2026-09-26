/**
 * Deterministic helpers that make web research easier for a small local model:
 *
 *  - selectRelevant(): instead of the FIRST N characters of a page (often
 *    navigation, intros or history), keep the page's opening plus the
 *    paragraphs that actually mention the query, in document order.
 *  - extractFigures() / formatFiguresSection(): pull the key number each
 *    source gives (money, counts, percentages) into a short per-source table
 *    and say plainly whether the sources agree. A 7B model reading 15K chars
 *    of raw pages tends to repeat the first number it sees; a table like
 *    "forbes.com: $929B · celebritynetworth.com: $975B · (low-trust) tracker:
 *    $1.03T — sources DISAGREE" lets it answer with a range and attribution.
 *
 * Pure string processing — no model calls, no network.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were',
  'be', 'it', 'its', 'this', 'that', 'with', 'as', 'by', 'from', 'what', 'which', 'who', 'how',
  'do', 'does', 'did', 'about', 'much', 'many', 'current', 'currently', 'now', 'today', 'latest',
  'tell', 'me', 'please', 'give', 'find', 'search', 'show', 'whats', 'what\'s'
]);

function queryTerms(query) {
  return [...new Set(
    (String(query || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  )];
}

function countTermHits(textLower, terms) {
  let hits = 0;
  for (const t of terms) if (textLower.includes(t)) hits++;
  return hits;
}

/** Page opening + the most query-relevant paragraphs, in original order, within maxChars. */
function selectRelevant(fullText, query, maxChars = 2200) {
  const text = String(fullText || '').trim();
  if (text.length <= maxChars) return text;

  const terms = queryTerms(query);
  const paras = text.split(/\n{2,}|\n(?=[-|#])/).map((p) => p.trim()).filter(Boolean);
  if (terms.length === 0 || paras.length <= 1) return `${text.slice(0, maxChars)}…`;

  const scored = paras.map((p, i) => ({ i, p, score: countTermHits(p.toLowerCase(), terms) }));
  const keep = new Set();
  let used = 0;

  // Always keep the opening paragraph (usually the page's own summary).
  const opening = scored[0];
  const openingText = opening.p.length > 500 ? `${opening.p.slice(0, 500)}…` : opening.p;
  keep.add(0);
  used += openingText.length;

  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (s.score === 0) break;
    if (keep.has(s.i)) continue;
    const piece = s.p.length > 900 ? `${s.p.slice(0, 900)}…` : s.p;
    if (used + piece.length + 2 > maxChars) continue;
    keep.add(s.i);
    used += piece.length + 2;
  }

  const out = [];
  let last = -1;
  for (const s of scored) {
    if (!keep.has(s.i)) continue;
    if (last !== -1 && s.i !== last + 1) out.push('[…]');
    out.push(s.i === 0 ? openingText : (s.p.length > 900 ? `${s.p.slice(0, 900)}…` : s.p));
    last = s.i;
  }
  return out.join('\n\n');
}

// ─── Figures ────────────────────────────────────────────────────────────────

const QUANTITATIVE_QUERY = /\b(how\s+(much|many|big|old|tall|long|far|rich)|net\s*worth|worth|price|prices|cost|costs|salary|revenue|income|profit|valuation|market\s*cap|population|gdp|budget|rate|rates|percent|percentage|inflation|interest|number\s+of|amount|total|size|score|rank|ranking|funding|raised|sales|earnings|debt|wealth)\b|%|[ك]م\s|سعر|ثروة|قيمة|عدد|نسبة/i;

function isQuantitativeQuery(query) {
  return QUANTITATIVE_QUERY.test(String(query || ''));
}

const SCALE = {
  thousand: 1e3, k: 1e3,
  million: 1e6, mn: 1e6, m: 1e6,
  billion: 1e9, bn: 1e9, b: 1e9,
  trillion: 1e12, tn: 1e12, t: 1e12
};

// $929B · $1.03 trillion · US$ 5.2 billion · €12,500 · 1.5 million · 42%
const AMOUNT_RE = /(US\$|\$|€|£|¥)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(trillion|billion|million|thousand|tn|bn|mn|[TBMK])\b)?|(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(trillion|billion|million)\b|(\d+(?:\.\d+)?)\s?%/gi;

// Words that make an amount a CHANGE ("a $111 billion drop", "up $1000 million
// today", "gained $20B") rather than the level being asked about.
const CHANGE_BEFORE_RE = /\b(up|down|by|gain(ed|s)?|los(t|s|es|ing)|drop(ped|s)?|fell|fall(s|ing)?|rose|rise[sn]?|jump(ed|s)?|surge[ds]?|plunge[ds]?|add(ed|s)?|wiped( out)?|shed|boost(ed)?|increase[ds]?( of)?|decrease[ds]?( of)?|decline[ds]?( of)?|swing( of)?)\s*(about|around|nearly|almost|roughly|some|more than|over)?\s*$/i;
const CHANGE_AFTER_RE = /^\s*(drop|loss|decline|gain|increase|decrease|jump|surge|plunge|swing|slump|hit|boost|rise|fall|wipeout)\b|^\s*(higher|lower|more|less) than\b/i;

function isChangeAmount(sentence, index, length) {
  const before = sentence.slice(Math.max(0, index - 40), index);
  const after = sentence.slice(index + length, index + length + 25);
  return CHANGE_BEFORE_RE.test(before) || CHANGE_AFTER_RE.test(after);
}

function parseAmounts(sentence) {
  const out = [];
  for (const m of sentence.matchAll(AMOUNT_RE)) {
    if (isChangeAmount(sentence, m.index, m[0].length)) continue;
    let currency = null, num, scaleWord, kind;
    if (m[1]) { currency = m[1] === 'US$' ? '$' : m[1]; num = m[2]; scaleWord = m[3]; kind = 'money'; }
    else if (m[4]) { num = m[4]; scaleWord = m[5]; kind = 'count'; }
    else { num = m[6]; kind = 'percent'; }
    const base = Number(String(num).replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    // Bare "$2" or "$5" amounts are almost never the headline figure.
    if (kind === 'money' && !scaleWord && base < 1000) continue;
    const scale = scaleWord ? (SCALE[scaleWord.toLowerCase()] || 1) : 1;
    out.push({ raw: m[0].trim(), value: base * scale, currency, kind });
  }
  return out;
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RE = new RegExp(
  `\\b((?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\b`, 'i'
);
const RECENCY_RE = /\b(as of|today|currently|current|now|live|real[- ]?time|latest|this (week|month|year))\b/i;

const DATE_RE_GLOBAL = new RegExp(DATE_RE.source, 'gi');

/** The date a figure is "as of": the one after "as of" if present, otherwise the latest date in the sentence. */
function pickDate(sentence) {
  const asOf = sentence.match(new RegExp(`as of\\s+(?:the\\s+)?${DATE_RE.source.replace(/^\\b/, '')}`, 'i'));
  if (asOf) return asOf[1];
  let bestDate = null;
  let bestTime = -Infinity;
  for (const m of sentence.matchAll(DATE_RE_GLOBAL)) {
    const t = Date.parse(m[1].replace(/(\d)(st|nd|rd|th)\b/, '$1'));
    const time = Number.isFinite(t) ? t : 0;
    if (time >= bestTime) { bestTime = time; bestDate = m[1]; }
  }
  return bestDate;
}

/**
 * "Elon Musk's Net Worth Is Now $750 Billion Thanks To A Delaware Court Ruling"
 * — Title Case with no sentence ending is almost always a link/headline to a
 * different (often older) article, not the page's own current figure.
 */
function looksLikeHeadline(sentence) {
  if (/[.!?]["')\]]?$/.test(sentence.trim())) return false;
  const words = sentence.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && w.length > 3);
  if (words.length < 5) return false;
  const capitalized = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / words.length >= 0.7;
}

function splitSentences(text) {
  return String(text || '')
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z؀-ۿ"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 600);
}

/**
 * The single most relevant figure a page gives for the query, or null.
 * Prefers sentences that mention the query's own words, sound current
 * ("as of", "currently", this year) and aren't history-table rows.
 */
function preferredKind(query) {
  const q = String(query || '');
  if (/%|percent|percentage|\brate\b|نسبة/i.test(q)) return 'percent';
  if (/\bpopulation\b|how many|number of|عدد/i.test(q)) return 'count';
  return 'money';
}

function extractFigure(page, query, now = new Date()) {
  const terms = queryTerms(query);
  const year = now.getFullYear();
  const kind = preferredKind(query);
  let best = null;

  for (const sentence of splitSentences(page.fullText || page.text)) {
    const amounts = parseAmounts(sentence).filter((a) => a.kind === kind);
    if (amounts.length === 0) continue;
    const lower = sentence.toLowerCase();
    const hits = countTermHits(lower, terms);
    if (terms.length > 0 && hits === 0) continue;

    let score = hits * 2;
    if (RECENCY_RE.test(sentence)) score += 2;
    const years = (sentence.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    if (years.includes(year)) score += 1;
    if (years.length > 0 && Math.max(...years) < year) score -= 3;     // clearly historical
    if (/^\|/.test(sentence) || /\|.*\|/.test(sentence)) score -= 1;   // table row (often a history table)
    if (amounts.length > 3) score -= 1;                                // list of many numbers: less likely the headline
    if (looksLikeHeadline(sentence)) score -= 3;                       // link to another (often older) article

    if (!best || score > best.score) {
      best = { score, amount: amounts[0], sentence, date: pickDate(sentence) };
    }
  }
  if (!best || best.score < 2) return null;
  return best;
}

/** 3 significant figures: 929B, 1.25B, 1.03T, 42.5% — enough to keep close figures distinguishable. */
function formatValue(v) {
  const abs = Math.abs(v);
  const sig = (n) => String(Number(n.toPrecision(3)));
  if (abs >= 1e12) return `${sig(v / 1e12)}T`;
  if (abs >= 1e9) return `${sig(v / 1e9)}B`;
  if (abs >= 1e6) return `${sig(v / 1e6)}M`;
  return sig(v);
}

function shortQuote(s, n = 170) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Builds the "KEY FIGURES" block from research pages (already ordered most
 * trusted first). Returns '' when the query isn't about a quantity or fewer
 * than one page gives a usable figure.
 */
function formatFiguresSection(query, pages, now = new Date()) {
  if (!isQuantitativeQuery(query)) return '';

  const rows = [];
  const seen = new Set();
  for (const page of pages) {
    const fig = extractFigure(page, query, now);
    if (!fig) continue;
    // The same site repeating the same sentence (e.g. a page and its search
    // snippet, or two pages sharing an intro) is one source, not two.
    const key = `${page.domain}|${fig.amount.value}|${fig.sentence.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ page, fig });
  }
  if (rows.length === 0) return '';

  const lines = rows.map(({ page, fig }) => {
    const label = page.trust === 'trusted' ? ' [trusted source]' : page.trust === 'low' ? ' [low-trust source]' : '';
    const when = fig.date ? ` (says: ${fig.date})` : page.updated ? ` (page updated ${page.updated})` : '';
    return `- ${page.domain || page.url}${label}: ${fig.amount.raw}${when} — "${shortQuote(fig.sentence)}"`;
  });

  // Agreement check across sources that give the same kind/currency of figure.
  const kind = rows[0].fig.amount.kind;
  const currency = rows[0].fig.amount.currency;
  const comparable = rows.filter(({ fig }) => fig.amount.kind === kind && fig.amount.currency === currency);
  let verdict = '';
  if (comparable.length >= 2) {
    const values = comparable.map(({ fig }) => fig.amount.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const prefix = kind === 'money' ? (currency || '') : '';
    const suffix = kind === 'percent' ? '%' : '';
    const fmt = (v) => `${prefix}${formatValue(v)}${suffix}`;
    const spread = min > 0 ? max / min : Infinity;

    if (spread <= 1.03) {
      verdict = `✓ These sources agree (about ${fmt((min + max) / 2)}).`;
    } else {
      // Never average across sources of different quality — that hides exactly
      // the spread the user needs to see. Report the range instead.
      verdict = spread > 1.15
        ? `⚠️ These sources DISAGREE (from ${fmt(min)} to ${fmt(max)}). Do NOT present one number as certain: ` +
          `give the range, say which source says what, and lean on [trusted source] entries and the most recent dates.`
        : `These sources differ somewhat (${fmt(min)} to ${fmt(max)}). Give the range or the most trusted, most recent figure, and name its source.`;
      const trustedValues = comparable.filter(({ page }) => page.trust === 'trusted').map(({ fig }) => fig.amount.value);
      if (trustedValues.length > 0 && trustedValues.length < comparable.length) {
        const tMin = Math.min(...trustedValues);
        const tMax = Math.max(...trustedValues);
        verdict += `\nTrusted sources alone say ${fmt(tMin)}${tMax / tMin > 1.001 ? ` to ${fmt(tMax)}` : ''}` +
          ` — lead with this, then mention the other estimates.`;
      }
    }
  } else if (rows.length === 1) {
    verdict = 'Only ONE source gives a figure — say so, and name that source.';
  }

  return [
    `KEY FIGURES FOUND (extracted automatically from each source; most trusted first):`,
    ...lines,
    verdict,
    `Always keep the date each source gives for its figure; never relabel it with today's date.`
  ].filter(Boolean).join('\n');
}

module.exports = {
  queryTerms,
  selectRelevant,
  isQuantitativeQuery,
  parseAmounts,
  extractFigure,
  formatFiguresSection
};
