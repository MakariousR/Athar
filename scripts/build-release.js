#!/usr/bin/env node
/**
 * Builds the release installer from an OBFUSCATED COPY of the app.
 * Your source files are never changed.
 *
 *   npm run release                 tests → copy → obfuscate → check → installer (dist/) → smoke test
 *   npm run release -- --skip-tests
 *   npm run release -- --keep-copy  keep release/app/ afterwards (to inspect the obfuscated code)
 *   npm run release -- --no-smoke   don't start the built app to check it
 *
 * Steps:
 *   1. Checks: the beta signing key is set up (public key in the app).
 *   2. Tests (npm test) and the open-source notices (npm run notices).
 *   3. Copies what the app needs into release/app/ (git-ignored):
 *      src/, assets/, package.json, package-lock.json and the three documents.
 *      node_modules is linked, not copied.
 *   4. Obfuscates the copy: strongly the license code, lightly the files that
 *      call it (main process + preload). Every file is syntax-checked, and the
 *      obfuscated license code is tested with a real key.
 *   5. Builds the installer from the copy into dist/ (Electron fuses on: the
 *      app refuses to run if its files are modified).
 *   6. Starts the built app once to check it opens the activation screen.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGE_PARENT = path.join(ROOT, 'release');
const STAGE = path.join(STAGE_PARENT, 'app');
const DIST = path.join(ROOT, 'dist');
const args = new Set(process.argv.slice(2));

// What goes into the app (everything else — tests, scripts, .git — stays out)
const COPY = ['src', 'assets', 'package.json', 'package-lock.json', 'LICENSE.txt', 'PRIVACY.md', 'THIRD-PARTY-NOTICES.txt'];

// Obfuscation: strong for the license code, light for the files that call it.
// (The rest of the app — chat, memory, search — stays as it is: heavy
// obfuscation there would only slow Athar down.)
const STRONG = ['src/main/license/license.js', 'src/main/license/index.js', 'src/main/license/public-key.js'];
const LIGHT = ['src/main/index.js', 'src/main/ipc-handlers.js', 'src/preload/preload.js'];

const STRONG_OPTIONS = {
  target: 'node', compact: true, simplify: true,
  controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true, deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
  numbersToExpressions: true, splitStrings: true, splitStringsChunkLength: 6,
  stringArray: true, stringArrayEncoding: ['rc4'], stringArrayThreshold: 1,
  stringArrayWrappersCount: 2, stringArrayWrappersType: 'function',
  transformObjectKeys: true, selfDefending: true, sourceMap: false
};
const LIGHT_OPTIONS = {
  target: 'node', compact: true, simplify: true,
  identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.75,
  controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false, sourceMap: false
};

const step = (n, msg) => console.log(`\n[${n}/6] ${msg}`);
const fail = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };
const run = (cmd, cmdArgs, opts = {}) => {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed.`);
};

/** Deletes the staging copy — only ever <project>/release/app. */
function removeStage() {
  const target = path.resolve(STAGE);
  if (target !== path.join(ROOT, 'release', 'app') || !target.startsWith(ROOT + path.sep)) fail(`Refusing to delete ${target}`);
  if (!fs.existsSync(target)) return;
  const link = path.join(target, 'node_modules');
  try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch { /* no link */ } // never follow into the real node_modules
  fs.rmSync(target, { recursive: true, force: true });
}

// ─── 1. Checks ──────────────────────────────────────────────────────────────
step(1, 'Checking the beta signing key');
const PUBLIC_KEY = require(path.join(ROOT, 'src/main/license/public-key.js'));
if (!PUBLIC_KEY) fail('The beta signing key is not set up yet. Run once:  npm run beta-key -- init');
const SIGNING_DIR = process.env.ATHAR_SIGNING_DIR || path.join(os.homedir(), '.athar-signing');
const PRIVATE_KEY_FILE = path.join(SIGNING_DIR, 'beta-private-key.pem');
const privatePem = fs.existsSync(PRIVATE_KEY_FILE) ? fs.readFileSync(PRIVATE_KEY_FILE, 'utf8') : null;
if (privatePem) {
  const matching = crypto.createPublicKey(crypto.createPrivateKey(privatePem)).export({ type: 'spki', format: 'pem' }).toString();
  if (matching !== PUBLIC_KEY) fail('The public key in the app does not match your private key — keys you make would not work. Run: npm run beta-key -- init');
  console.log('  ✓ public key in the app matches your private key');
} else {
  console.log(`  ! private key not found at ${PRIVATE_KEY_FILE} — building anyway, but keys can only be made where it is`);
}

// ─── 2. Tests + notices ─────────────────────────────────────────────────────
step(2, args.has('--skip-tests') ? 'Open-source notices (tests skipped)' : 'Tests and open-source notices');
if (!args.has('--skip-tests')) run('npm', ['test']);
run('npm', ['run', 'notices']);

// ─── 3. Copy ────────────────────────────────────────────────────────────────
step(3, 'Copying the app into release/app/ (your source files are not touched)');
removeStage();
fs.mkdirSync(STAGE, { recursive: true });
for (const item of COPY) {
  const from = path.join(ROOT, item);
  if (!fs.existsSync(from)) fail(`Missing ${item}`);
  fs.cpSync(from, path.join(STAGE, item), { recursive: true });
}
fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), 'junction');
console.log(`  ✓ copied ${COPY.join(', ')}; linked node_modules`);

// ─── 4. Obfuscate ───────────────────────────────────────────────────────────
step(4, 'Obfuscating the copy');
const JavaScriptObfuscator = require('javascript-obfuscator');
for (const [files, options, label] of [[STRONG, STRONG_OPTIONS, 'strong'], [LIGHT, LIGHT_OPTIONS, 'light']]) {
  for (const rel of files) {
    const file = path.join(STAGE, rel);
    const code = fs.readFileSync(file, 'utf8');
    const out = JavaScriptObfuscator.obfuscate(code, { ...options, seed: crypto.randomInt(1, 2 ** 31) }).getObfuscatedCode();
    fs.writeFileSync(file, out);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) fail(`Obfuscated ${rel} is not valid JavaScript:\n${check.stderr}`);
    console.log(`  ✓ ${label.padEnd(6)} ${rel}  (${(code.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB)`);
  }
}
// The obfuscated license code must still work: check a real key with it (in a separate process)
{
  const staged = path.join(STAGE, 'src/main/license/license.js');
  let testKey = '';
  if (privatePem) {
    const { makeKey } = require('./beta-key');
    const { computerId } = require(path.join(ROOT, 'src/main/license/license'));
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    testKey = makeKey({ privateKey: privatePem, name: 'release self-test', computer: computerId(), expires: tomorrow });
  }
  const probe = `
    const lic = require(${JSON.stringify(staged)});
    const pub = require(${JSON.stringify(path.join(STAGE, 'src/main/license/public-key.js'))});
    const bad = lic.verifyKey('ATHAR-B1-nonsense.abc', { publicKey: pub, computerId: lic.computerId() }).state;
    const good = ${JSON.stringify(testKey)} ? lic.verifyKey(${JSON.stringify(testKey)}, { publicKey: pub, computerId: lic.computerId() }).state : 'skipped';
    console.log(JSON.stringify({ bad, good, id: lic.computerId() }));`;
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  let result = null;
  try { result = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
  if (!result || result.bad !== 'invalid' || !['ok', 'skipped'].includes(result.good)) {
    fail(`The obfuscated license code does not work correctly:\n${r.stdout}\n${r.stderr}`);
  }
  console.log(`  ✓ obfuscated license code: rejects a fake key${result.good === 'ok' ? ', accepts a real one' : ''} (this computer: ${result.id})`);
}

// ─── 5. Installer ───────────────────────────────────────────────────────────
step(5, 'Building the installer (electron-builder, fuses on)');
// Run electron-builder's own script with Node directly (no shell): the project
// path may contain spaces
run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', '--projectDir', STAGE, `-c.directories.output=${DIST}`], { shell: false });
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const installer = path.join(DIST, `${pkg.build.productName} Setup ${pkg.version}.exe`);
if (!fs.existsSync(installer)) fail(`Installer not found: ${installer}`);
console.log(`  ✓ ${path.relative(ROOT, installer)}  (${(fs.statSync(installer).size / 1048576).toFixed(0)} MB)`);

// ─── 6. Smoke test ──────────────────────────────────────────────────────────
(async () => {
  if (args.has('--no-smoke')) { step(6, 'Smoke test skipped'); return finish(); }
  step(6, 'Starting the built app once (temporary profile)');
  const exe = path.join(DIST, 'win-unpacked', `${pkg.build.productName}.exe`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'athar-release-smoke-'));
  const port = 9300 + crypto.randomInt(0, 400);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let verdict = null;
  try {
    let page = null;
    for (let i = 0; i < 40 && !page; i++) {
      await sleep(500);
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
    }
    if (!page) throw new Error('the app window did not open');
    await sleep(2500);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    verdict = await new Promise((resolve) => {
      ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m.result.result.value); });
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression:
        "JSON.stringify({ activation: !document.getElementById('licenseOverlay').classList.contains('hidden'), id: document.getElementById('licenseComputerId').textContent, version: null })" } }));
    });
    ws.close();
  } catch (err) {
    verdict = JSON.stringify({ error: err.message });
  } finally {
    child.kill();
    await sleep(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* in use a moment longer */ }
  }
  const v = JSON.parse(verdict);
  if (v.error || !v.activation) fail(`Smoke test failed: ${verdict}`);
  console.log(`  ✓ the built app opens on the activation screen (computer ID ${v.id})`);
  finish();
})();

function finish() {
  if (!args.has('--keep-copy')) removeStage();
  console.log(`\n✓ Release ready: ${path.relative(ROOT, installer)}\n`);
}
