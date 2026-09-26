const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');
const trust = require(path.join(ROOT, 'src/main/tools/source-trust'));
const figs = require(path.join(ROOT, 'src/main/tools/research-figures'));
const web = require(path.join(ROOT, 'src/main/tools/web-search'));
const { parseDdgHtml, parseDdgLite, resolveDdgHref, extractPageDate } = web._internals;
const NOW = new Date('2026-09-26T12:00:00Z');
test('trust tiers', () => {
    assert.strictEqual(trust.sourceTrust('https://www.forbes.com/profile/elon-musk/'), 'trusted');
    assert.strictEqual(trust.sourceTrust('https://en.wikipedia.org/wiki/X'), 'trusted');
    assert.strictEqual(trust.sourceTrust('https://www.census.gov/x'), 'trusted');
    assert.strictEqual(trust.sourceTrust('https://mit.edu/x'), 'trusted');
    assert.strictEqual(trust.sourceTrust('https://purepowerpicks.com/elon-musk-net-worth-tracker/'), 'low');
    assert.strictEqual(trust.sourceTrust('https://x.org/a', 'Elon Musk Net Worth in Real-Time'), 'low');
    assert.strictEqual(trust.sourceTrust('https://abc.xyz/', 'Live Real-Time Counter'), 'low');
    assert.strictEqual(trust.sourceTrust('https://elonmusktrillionaire.com/x', 'Elon Musk Net Worth | Live, Updated Every Minute | Elon Musk Trillionaire Tracker'), 'low');
    assert.strictEqual(trust.sourceTrust('https://statspanda.com/live-counters/elon-musk-wealth-counter', 'x'), 'low');
    assert.strictEqual(trust.sourceTrust('https://www.investopedia.com/x', 'The 10 Richest People in the World'), 'normal');
    assert.strictEqual(trust.sourceTrust('https://alphabet.com/'), 'normal', 'alphabet must not match "bet"');
    assert.strictEqual(trust.sourceTrust('https://notforbes.com/'), 'normal', 'suffix match must respect label boundary');
});

test('rankByTrust orders trusted first, caps per domain, dedupes', () => {
    const items = [
      { url: 'https://purepowerpicks.com/a', title: 'Tracker' },
      { url: 'https://purepowerpicks.com/b', title: 'x' },
      { url: 'https://purepowerpicks.com/c', title: 'x' },
      { url: 'https://celebritynetworth.com/a', title: 'x' },
      { url: 'https://www.forbes.com/profile/x/', title: 'x' },
      { url: 'https://www.forbes.com/profile/x/?utm=1', title: 'dup' }
    ];
    const r = trust.rankByTrust(items, { perDomain: 2 });
    assert.deepStrictEqual(r.map((i) => i.domain), ['forbes.com', 'celebritynetworth.com', 'purepowerpicks.com', 'purepowerpicks.com']);
});

// ── figures ──
test('quantitative query detection', () => {
    assert(figs.isQuantitativeQuery('Elon Musk net worth'));
    assert(figs.isQuantitativeQuery('how much does an iPhone 17 cost'));
    assert(figs.isQuantitativeQuery('ما هي ثروة إيلون ماسك'));
    assert(!figs.isQuantitativeQuery('who is the president of France'));
});

test('parseAmounts', () => {
    const a = figs.parseAmounts('He is worth $929B, up from $1.03 trillion and US$ 942 billion; 12% of 1.5 million, costs $5.');
    const raw = a.map((x) => x.raw);
    assert(raw.includes('$929B') && raw.includes('$1.03 trillion') && raw.includes('US$ 942 billion'), raw.join(','));
    assert(!raw.includes('$5'), 'bare small $ amounts are ignored');
    assert.strictEqual(a.find((x) => x.raw === '$929B').value, 929e9);
    assert.strictEqual(a.find((x) => x.raw === '$1.03 trillion').value, 1.03e12);
});

test('change amounts are not treated as levels', () => {
    const raw = (s) => figs.parseAmounts(s).map((a) => a.raw);
    assert.deepStrictEqual(raw('Shares were removed from the net worth calculation, resulting in a $111 billion drop.'), []);
    assert.deepStrictEqual(raw('Elon Musk $1.2 Trillion UP $1000 MILLION TODAY'), ['$1.2 Trillion']);
    assert.deepStrictEqual(raw('He gained $20 billion on Monday, bringing his net worth to $950 billion.'), ['$950 billion']);
    assert.deepStrictEqual(raw('His fortune fell by about $40 billion to $900 billion.'), ['$900 billion']);
    assert.deepStrictEqual(raw('Musk has a net worth of $929B.'), ['$929B']);
});

test('headline ignored in favour of statement; as-of date picked', () => {
    const page = {
      fullText: "Elon Musk's Net Worth Is Now $750 Billion Thanks To A Delaware Court Ruling\n\n" +
        'Elon Musk briefly became a trillionaire in June 2026; as of September 21, 2026, his net worth is $975 billion.'
    };
    const f = figs.extractFigure(page, 'Elon Musk net worth', NOW);
    assert.strictEqual(f.amount.raw, '$975 billion');
    assert.strictEqual(f.date, 'September 21, 2026');
});

test('historical figures lose to current ones', () => {
    const page = { fullText: 'In 2021 Elon Musk net worth reached $300 billion.\n\nElon Musk has a current net worth of $929B.' };
    assert.strictEqual(figs.extractFigure(page, 'Elon Musk net worth', NOW).amount.raw, '$929B');
});

test('figures section: agreement (within 3%)', () => {
    const pages = [
      { domain: 'a.com', fullText: 'The Eiffel Tower renovation will cost €1.2 billion in total.' },
      { domain: 'b.com', fullText: 'Total cost of the Eiffel Tower renovation: €1.21 billion.' }
    ];
    const s = figs.formatFiguresSection('Eiffel Tower renovation cost', pages, NOW);
    assert(/sources agree/.test(s), s);
});

test('figures section: small difference shows exact range', () => {
    const pages = [
      { domain: 'a.com', fullText: 'The Eiffel Tower renovation will cost €1.2 billion in total.' },
      { domain: 'b.com', fullText: 'Total cost of the Eiffel Tower renovation: €1.25 billion.' }
    ];
    const s = figs.formatFiguresSection('Eiffel Tower renovation cost', pages, NOW);
    assert(/differ somewhat \(€1\.2B to €1\.25B\)/.test(s), s);
});

test('no figures section for non-numeric question', () => {
    assert.strictEqual(figs.formatFiguresSection('who founded SpaceX', [{ fullText: 'SpaceX raised $1 billion.' }], NOW), '');
});

test('selectRelevant keeps opening + relevant paragraphs within budget', () => {
    const paras = ['Intro about the person.'];
    for (let i = 0; i < 60; i++) paras.push(`Filler paragraph ${i} about unrelated topics like cars and rockets. `.repeat(3));
    paras.push('His net worth is $929B according to Forbes.');
    const out = figs.selectRelevant(paras.join('\n\n'), 'net worth', 800);
    assert(out.startsWith('Intro about the person.'), out.slice(0, 80));
    assert(out.includes('$929B'), 'relevant paragraph must be kept');
    assert(out.length <= 900, `too long: ${out.length}`);
});

// ── DDG parsing ──
test('resolveDdgHref', () => {
    assert.strictEqual(resolveDdgHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.forbes.com%2Fprofile%2Felon-musk%2F&amp;rut=abc'), 'https://www.forbes.com/profile/elon-musk/');
    assert.strictEqual(resolveDdgHref('https://duckduckgo.com/y.js?ad_domain=x&u3=foo'), '');
    assert.strictEqual(resolveDdgHref('https://example.com/page'), 'https://example.com/page');
});

test('parseDdgHtml skips ads, reads organic results', () => {
    const html = `
      <div class="result results_links results_links_deep result--ad"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
      <div class="result results_links results_links_deep web-result "><div class="links_main">
        <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FElon_Musk&amp;rut=1">Elon <b>Musk</b> - Wikipedia</a></h2>
        <a class="result__snippet" href="x">Elon Musk is a businessman.</a></div></div>`;
    const r = parseDdgHtml(html);
    assert.strictEqual(r.length, 1, JSON.stringify(r));
    assert.strictEqual(r[0].url, 'https://en.wikipedia.org/wiki/Elon_Musk');
    assert.strictEqual(r[0].title, 'Elon Musk - Wikipedia');
    assert.strictEqual(r[0].snippet, 'Elon Musk is a businessman.');
});

test('parseDdgLite', () => {
    const html = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.forbes.com%2Fx" class='result-link'>Forbes X</a></td></tr>
      <tr><td class='result-snippet'>Snippet <b>one</b></td></tr></table>`;
    const r = parseDdgLite(html);
    assert.deepStrictEqual(r, [{ title: 'Forbes X', url: 'https://www.forbes.com/x', snippet: 'Snippet one' }]);
});

test('extractPageDate prefers modified over published', () => {
    const html = '<meta property="article:published_time" content="2026-01-02T00:00:00Z"><meta property="article:modified_time" content="2026-09-20T10:00:00Z">';
    assert.strictEqual(extractPageDate(html), '2026-09-20');
    assert.strictEqual(extractPageDate('<script type="application/ld+json">{"datePublished":"2025-05-01"}</script>'), '2025-05-01');
    assert.strictEqual(extractPageDate('<p>nothing</p>'), null);
});

// ── SSRF: forbidden before any network access ──
for (const url of ['http://127.0.0.1:11434/api/tags', 'http://localhost:11434/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://192.168.1.1/', 'file:///C:/Windows/win.ini', 'http://user:pw@example.com/']) {
  test(`SSRF blocked: ${url}`, async () => {
    const p = await web.fetchWebPageContent(url);
    assert(p.error, `expected error, got ${JSON.stringify(p).slice(0, 150)}`);
  });
}

done();
