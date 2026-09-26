// Needs internet access. Run with: npm run test:live
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');
const web = require(path.join(ROOT, 'src/main/tools/web-search'));

test('SSRF blocked for a public DNS name that resolves to 127.0.0.1 (localtest.me)', async () => {
  const p = await web.fetchWebPageContent('http://localtest.me:11434/');
  assert(p.error && /private or local/.test(p.error), JSON.stringify(p).slice(0, 200));
});

test('Wikipedia via API returns clean text and a date', async () => {
  const p = await web.fetchWebPageContent('https://en.wikipedia.org/wiki/Eiffel_Tower', 3000);
  assert(p.fullText.length > 5000 && /Eiffel/.test(p.fullText), `len=${p.fullText.length}`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(p.updated || ''), `updated=${p.updated}`);
});

test('public page fetch works', async () => {
  const p = await web.fetchWebPageContent('https://example.com/');
  assert(!p.error && /Example Domain/i.test(p.title + p.fullText));
});

test('full research pipeline returns ranked sources', async () => {
  const r = await web.searchWebTool('Eiffel Tower height');
  assert(/WEB RESEARCH RESULTS/.test(r), r.slice(0, 300));
  assert(/^URL: https?:\/\//m.test(r));
});

done();
