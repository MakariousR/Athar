// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
// Needs internet. Every model offered in the app's model list must exist in the
// Ollama library — a wrong name (e.g. "qwen2.5-vl" instead of "qwen2.5vl")
// makes "Download" fail for that entry.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');

const src = fs.readFileSync(path.join(ROOT, 'src/renderer/chat.js'), 'utf8');
const catalog = new Function(`${fs.readFileSync(path.join(ROOT, 'src/renderer/model-catalog.js'), 'utf8')}; return MODEL_CATALOG;`)();
const names = catalog.map((m) => m.name);
const defaultModel = (src.match(/const CHAT_MODEL\s*=\s*'([^']+)'/) || [])[1];

test('model list was found', () => {
  assert(names.length >= 10, `only ${names.length} models found`);
  assert(names.includes(defaultModel), `default model ${defaultModel} missing from the list`);
});

for (const name of names) {
  test(`exists in the Ollama library: ${name}`, async () => {
    const [repo, tag = 'latest'] = name.split(':');
    let res;
    // The registry turns away bursts of requests (429): wait and ask again
    for (let i = 0; i < 4; i++) {
      res = await fetch(`https://registry.ollama.ai/v2/library/${repo}/manifests/${tag}`, {
        method: 'HEAD',
        headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
      });
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
    assert.strictEqual(res.status, 200, `HTTP ${res.status}`);
  });
}

done();
