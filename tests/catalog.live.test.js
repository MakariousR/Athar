// Needs internet. Every model offered in the app's model list must exist in the
// Ollama library — a wrong name (e.g. "qwen2.5-vl" instead of "qwen2.5vl")
// makes "Download" fail for that entry.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');

const src = fs.readFileSync(path.join(ROOT, 'src/renderer/chat.js'), 'utf8');
const names = [...src.matchAll(/\{ name: '([^']+)',\s+label:/g)].map((m) => m[1]);
const defaultModel = (src.match(/const CHAT_MODEL\s*=\s*'([^']+)'/) || [])[1];

test('model list was found', () => {
  assert(names.length >= 10, `only ${names.length} models found`);
  assert(names.includes(defaultModel), `default model ${defaultModel} missing from the list`);
});

for (const name of names) {
  test(`exists in the Ollama library: ${name}`, async () => {
    const [repo, tag = 'latest'] = name.split(':');
    const res = await fetch(`https://registry.ollama.ai/v2/library/${repo}/manifests/${tag}`, {
      method: 'HEAD',
      headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' }
    });
    assert.strictEqual(res.status, 200, `HTTP ${res.status}`);
  });
}

done();
