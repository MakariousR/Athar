// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
// Memory citation labels ([M1]…) are hidden from answers in the chat view.
// stripCitations lives in the renderer script, so it is loaded from there.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');

const src = fs.readFileSync(path.join(ROOT, 'src/renderer/chat.js'), 'utf8');
const code = src.slice(src.indexOf('const CITATION = '), src.indexOf('function renderMarkdown(text) {'));
const stripCitations = new Function(`${code}; return stripCitations;`)();

const cases = [
  ['[M1] You discussed the app.\n[M2] You worked on a ranker.', 'You discussed the app.\nYou worked on a ranker.'],
  ['- [M3] You asked about signals', '- You asked about signals'],
  ['1. [M1][M2] Both chats', '1. Both chats'],
  ['  - nested [M4] item', '  - nested item'],
  ['As we decided [M1], use Postgres [M2, M3].', 'As we decided, use Postgres.'],
  ['Last time (see [M1]) you chose Traefik.', 'Last time you chose Traefik.'],
  ['كما ناقشنا سابقاً [M1]، استخدم بايثون.', 'كما ناقشنا سابقاً، استخدم بايثون.']
];
for (const [input, want] of cases) {
  test(`hides labels: ${JSON.stringify(input).slice(0, 50)}`, () => assert.strictEqual(stripCitations(input), want));
}

test('leaves code and text without labels alone', () => {
  for (const s of ['```js\nconst x = arr[M1];\n```', 'no citations here', 'a [link](http://x) and [M] text']) {
    assert.strictEqual(stripCitations(s), s);
  }
});

done();
