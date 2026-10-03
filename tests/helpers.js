// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Minimal test helpers — no framework needed.
 *
 *   const { test, done, ROOT } = require('./helpers');
 *   test('name', async () => { ... });
 *   done();
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

/** Runs the registered tests in order; exits non-zero if any failed. */
async function done() {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS ${name}`);
    } catch (err) {
      failures++;
      console.log(`  FAIL ${name}\n       ${String(err && err.message || err).split('\n').join('\n       ')}`);
    }
  }
  console.log(failures ? `  ${failures} of ${tests.length} FAILED` : `  all ${tests.length} passed`);
  process.exitCode = failures ? 1 : 0;
}

/**
 * Stubs the `electron` module so main-process code that only needs
 * app.getPath('userData') can run in plain Node. Returns the temp userData dir.
 */
function stubElectron() {
  const userData = tempDir('athar-test-');
  require.cache[require.resolve('electron', { paths: [ROOT] })] = {
    loaded: true,
    exports: {
      app: { getPath: () => userData },
      ipcMain: { handle() {}, on() {} },
      dialog: {},
      shell: {}
    }
  };
  return userData;
}

const tempDirs = [];
process.on('exit', () => {
  for (const dir of tempDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
});

function tempDir(prefix = 'athar-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Deterministic stand-in for the bge-m3 embedding model: a hashed bag of words
 * (so "meaning" ≈ shared words). Lets search tests run without Ollama.
 */
function fakeEmbed(texts) {
  const { tokenize } = require(path.join(ROOT, 'src/main/memory/bm25'));
  return Promise.resolve(texts.map((text) => {
    const v = new Array(256).fill(0);
    for (const tok of tokenize(text)) {
      let hash = 0;
      for (const ch of tok) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      v[hash % 256] += 1;
    }
    v[255] += 0.01; // never all-zero
    return v;
  }));
}

module.exports = { test, done, stubElectron, tempDir, fakeEmbed, ROOT };
