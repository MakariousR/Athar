const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, tempDir, ROOT } = require('./helpers');
const { parseAnyExport } = require(path.join(ROOT, 'src/main/parser/chatgpt-parser'));
const { parseGeminiData } = require(path.join(ROOT, 'src/main/parser/gemini-parser'));

const dir = tempDir('cm-gemini-');
const write = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content)); return p; };

// Shape of Google Takeout → My Activity → Gemini Apps (JSON)
const activity = [
  { header: 'Gemini Apps', title: 'Prompted which tomato varieties grow well in pots?', time: '2026-05-02T09:00:00.000Z',
    products: ['Gemini Apps'], safeHtmlItem: [{ html: '<p>Cherry varieties like <b>Sungold</b> do well.</p><ul><li>20-litre pots</li><li>Water daily</li></ul>' }] },
  { header: 'Gemini Apps', title: 'Prompted how often should I fertilise them?', time: '2026-05-02T09:10:00.000Z',
    products: ['Gemini Apps'], safeHtmlItem: [{ html: '<p>Every two weeks with a tomato feed.</p>' }] },
  { header: 'Gemini Apps', title: 'Used Gemini Apps', time: '2026-05-02T12:00:00.000Z', products: ['Gemini Apps'] },
  { header: 'Gemini Apps', title: 'Prompted write a haiku about rain', time: '2026-05-03T20:00:00.000Z',
    products: ['Gemini Apps'], safeHtmlItem: [{ html: '<p>Soft rain on the roof&nbsp;&amp; the street</p>' }] },
  { header: 'YouTube', title: 'Watched a video', time: '2026-05-03T21:00:00.000Z' }
];

test('Gemini activity is grouped into conversations by time', () => {
  const threads = parseAnyExport(write('MyActivity.json', activity));
  assert.strictEqual(threads.length, 2, JSON.stringify(threads.map((t) => t.title)));
  const [garden, haiku] = threads;
  assert.strictEqual(garden.source, 'gemini');
  assert.strictEqual(garden.title, 'which tomato varieties grow well in pots?');
  assert.deepStrictEqual(garden.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert(/Sungold do well\.\n- 20-litre pots\n- Water daily/.test(garden.messages[1].text), garden.messages[1].text);
  assert.strictEqual(haiku.messages[1].text, 'Soft rain on the roof & the street');
});

test('Gemini conversation IDs are stable across re-imports', () => {
  const a = parseGeminiData(activity).map((t) => t.id);
  const b = parseGeminiData(JSON.parse(JSON.stringify(activity))).map((t) => t.id);
  assert.deepStrictEqual(a, b);
  assert(a.every((id) => id.startsWith('gemini_')));
});

test('the HTML version of Takeout gets a clear "choose JSON" message', () => {
  const html = '<html><body><div class="outer-cell">Gemini Apps<br>Prompted hello</div></body></html>';
  assert.throws(() => parseAnyExport(write('MyActivity.html', html)), /pick JSON instead of HTML/);
});

test('non-JSON and unknown files get a helpful error', () => {
  assert.throws(() => parseAnyExport(write('notes.json', 'hello')), /not a JSON export/);
  assert.throws(() => parseAnyExport(write('other.json', [{ foo: 1 }])), /Unrecognised export format/);
});

done();
