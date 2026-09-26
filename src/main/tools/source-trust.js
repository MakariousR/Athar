/**
 * Source trust ranking for web research.
 *
 * Search engines rank by relevance/SEO, not reliability, and small local
 * models tend to repeat the FIRST figure they read. So research pages are
 * re-ordered (trusted sources first) and labelled, and no single site may
 * contribute more than a couple of pages — otherwise one site can look like
 * "several sources agree".
 *
 * This only re-orders and labels; nothing is dropped for being low-trust.
 */

// Established news agencies, reference works, official/statistical bodies,
// and primary technical documentation.
const TRUSTED_DOMAINS = [
  // reference
  'wikipedia.org', 'britannica.com', 'wikidata.org',
  // news agencies & major outlets
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'npr.org', 'pbs.org',
  'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com',
  'theguardian.com', 'cnbc.com', 'cnn.com', 'bloomberg.com', 'forbes.com',
  'aljazeera.com', 'aljazeera.net', 'france24.com', 'dw.com', 'axios.com',
  'politico.com', 'theverge.com', 'arstechnica.com', 'techcrunch.com',
  // science & data
  'nature.com', 'science.org', 'nih.gov', 'who.int', 'un.org', 'worldbank.org',
  'imf.org', 'oecd.org', 'ourworldindata.org', 'statista.com', 'arxiv.org',
  // markets & filings
  'sec.gov', 'nasdaq.com', 'nyse.com', 'marketwatch.com', 'finance.yahoo.com',
  // technical documentation
  'developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'github.com',
  'stackoverflow.com', 'learn.microsoft.com', 'developer.apple.com', 'python.org',
  'npmjs.com', 'pypi.org', 'rust-lang.org', 'go.dev', 'kernel.org'
];

// Official institutional suffixes (government, education, international orgs).
const TRUSTED_SUFFIXES = [/\.gov(\.[a-z]{2})?$/, /\.edu(\.[a-z]{2})?$/, /\.ac\.[a-z]{2}$/, /\.int$/, /\.mil$/];

// Signals of pages built to attract clicks rather than inform: live
// "trackers"/counters, stock-tip and signal sites, coupon/affiliate pages.
const LOW_TRUST_TITLE = new RegExp([
  String.raw`\b(live|real[- ]?time)[\s-]+(net\s*worth[\s-]+)?(tracker|counters?|ticker)\b`,   // "Live Real-Time Counter", "live-counters/…"
  String.raw`\bnet[\s-]*worth\b.{0,60}\b(tracker|counter|updated every (minute|second))\b`,   // "Net Worth | Live, Updated Every Minute | … Tracker"
  String.raw`\bnet[\s-]*worth[\s-]+(live|in[\s-]+real[\s-]?time)\b`,
  String.raw`\bstock[\s-]+picks?\b`, String.raw`\btrade[\s-]+alerts?\b`, String.raw`\bcoupon`, String.raw`\bpromo[\s-]+code\b`
].join('|'), 'i');
// Matched against the END of the site's main label ("purepowerpicks.com"),
// so ordinary names that merely contain these letters ("alphabet.com") don't hit.
const LOW_TRUST_DOMAIN = /(picks|signals|coupons?|promocodes?|casino|betting)\.[a-z.]+$/i;

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
}

function matchesDomain(domain, entry) {
  return domain === entry || domain.endsWith(`.${entry}`);
}

/** Returns 'trusted' | 'normal' | 'low'. */
function sourceTrust(url, title = '') {
  const domain = getDomain(url);
  if (!domain) return 'low';
  if (TRUSTED_DOMAINS.some((d) => matchesDomain(domain, d))) return 'trusted';
  if (TRUSTED_SUFFIXES.some((re) => re.test(domain))) return 'trusted';
  if (LOW_TRUST_DOMAIN.test(domain) || LOW_TRUST_TITLE.test(title || '') || LOW_TRUST_TITLE.test(url)) return 'low';
  return 'normal';
}

const TRUST_ORDER = { trusted: 0, normal: 1, low: 2 };

/**
 * Orders search results by trust (stable: keeps the engine's order within a
 * tier), removes duplicate URLs, and keeps at most `perDomain` results per
 * site. Each returned item gets `domain` and `trust` fields.
 */
function rankByTrust(items, { perDomain = 2, limit = Infinity } = {}) {
  const seenUrls = new Set();
  const annotated = [];
  items.forEach((item, rank) => {
    if (!item || !item.url) return;
    const key = item.url.replace(/[#?].*$/, '').replace(/\/+$/, '');
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    annotated.push({ ...item, rank, domain: getDomain(item.url), trust: sourceTrust(item.url, item.title) });
  });

  annotated.sort((a, b) => (TRUST_ORDER[a.trust] - TRUST_ORDER[b.trust]) || (a.rank - b.rank));

  const perDomainCount = new Map();
  const out = [];
  for (const item of annotated) {
    const n = perDomainCount.get(item.domain) || 0;
    if (n >= perDomain) continue;
    perDomainCount.set(item.domain, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { sourceTrust, rankByTrust, getDomain, TRUST_ORDER };
