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
  const userData = tempDir('chat-memory-test-');
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

function tempDir(prefix = 'chat-memory-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

module.exports = { test, done, stubElectron, tempDir, ROOT };
