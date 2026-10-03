// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
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
  // technical documentation (not github.com itself: anyone can publish a repository there)
  'developer.mozilla.org', 'docs.python.org', 'nodejs.org', 'docs.github.com',
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

// Second-level labels under a country code: "bbc.co.uk", "youm7.com.eg", "moh.gov.eg"
const COUNTRY_SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'go', 'or', 'ne', 'gob', 'mil', 'nic', 'sch']);
// Hosting platforms where each subdomain belongs to someone different
const SHARED_HOSTS = ['github.io', 'blogspot.com', 'wordpress.com', 'substack.com', 'medium.com', 'tumblr.com',
  'netlify.app', 'vercel.app', 'pages.dev', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'wixsite.com', 'weebly.com'];

/**
 * The site a host belongs to: "edition.cnn.com" and "money.cnn.com" are both
 * "cnn.com", so they count as one source, not two that happen to agree.
 */
function siteOf(domain) {
  if (!domain) return domain;
  const labels = String(domain).toLowerCase().split('.');
  if (labels.length <= 2 || /^[\d.]+$/.test(domain) || domain.includes(':')) return domain;
  const shared = SHARED_HOSTS.find((h) => domain === h || domain.endsWith(`.${h}`));
  if (shared) return labels.slice(-(shared.split('.').length + 1)).join('.');
  const n = labels[labels.length - 1].length === 2 && COUNTRY_SLD.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join('.');
}

// Parameters that only track where a click came from; the same page with or without them is one page
const TRACKING_PARAM_RE = /^(utm(_\w+)?|fbclid|gclid|dclid|msclkid|mc_\w+|ref|ref_src|ref_url|src|source|ocid|cmpid|igshid|spm|_ga)$/i;

/** One key per page: scheme, "www.", fragment, tracking parameters and trailing slash don't matter. */
function urlKey(url) {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM_RE.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${query}`;
  } catch {
    return String(url).replace(/#.*$/, '').replace(/\/+$/, '');
  }
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
 * site. Each returned item gets `domain`, `site` and `trust` fields.
 */
function rankByTrust(items, { perDomain = 2, limit = Infinity } = {}) {
  const seenUrls = new Set();
  const annotated = [];
  items.forEach((item, rank) => {
    if (!item || !item.url) return;
    const key = urlKey(item.url);
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    const domain = getDomain(item.url);
    annotated.push({ ...item, rank, domain, site: siteOf(domain), trust: sourceTrust(item.url, item.title) });
  });

  annotated.sort((a, b) => (TRUST_ORDER[a.trust] - TRUST_ORDER[b.trust]) || (a.rank - b.rank));

  // The cap is per site, so one site's subdomains can't fill the list
  const perSiteCount = new Map();
  const out = [];
  for (const item of annotated) {
    const n = perSiteCount.get(item.site) || 0;
    if (n >= perDomain) continue;
    perSiteCount.set(item.site, n + 1);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { sourceTrust, rankByTrust, getDomain, siteOf, urlKey, TRUST_ORDER };
