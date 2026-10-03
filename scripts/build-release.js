#!/usr/bin/env node
// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Builds the Windows installer.
 *
 *   npm run release                 tests → notices → installer (dist/) → smoke test
 *   npm run release -- --skip-tests
 *   npm run release -- --no-smoke   don't start the built app to check it
 *
 * Steps:
 *   1. Tests (npm test).
 *   2. The open-source notices (npm run notices).
 *   3. The installer, by electron-builder, into dist/. Only the files listed in
 *      package.json "build.files" go in (no tests, scripts or .git), and the
 *      Electron fuses are on: the app refuses to run if its files are modified.
 *   4. Starts the built app once, with a temporary profile, to check it opens.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const step = (n, msg) => console.log(`\n[${n}/4] ${msg}`);
const fail = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };
const run = (cmd, cmdArgs, opts = {}) => {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed.`);
};

// ─── 1. Tests ───────────────────────────────────────────────────────────────
step(1, args.has('--skip-tests') ? 'Tests skipped' : 'Tests');
if (!args.has('--skip-tests')) run('npm', ['test']);

// ─── 2. Notices ─────────────────────────────────────────────────────────────
step(2, 'Open-source notices');
run('npm', ['run', 'notices']);

// ─── 3. Installer ───────────────────────────────────────────────────────────
step(3, 'Building the installer (electron-builder, fuses on)');
// Run electron-builder's own script with Node directly (no shell): the project
// path may contain spaces
run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', `-c.directories.output=${DIST}`], { shell: false });
const installer = path.join(DIST, `${pkg.build.productName} Setup ${pkg.version}.exe`);
if (!fs.existsSync(installer)) fail(`Installer not found: ${installer}`);
console.log(`  ✓ ${path.relative(ROOT, installer)}  (${(fs.statSync(installer).size / 1048576).toFixed(0)} MB)`);

// ─── 4. Smoke test ──────────────────────────────────────────────────────────
(async () => {
  if (args.has('--no-smoke')) { step(4, 'Smoke test skipped'); return finish(); }
  step(4, 'Starting the built app once (temporary profile)');
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
    await sleep(4000);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    verdict = await new Promise((resolve) => {
      ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m.result.result.value); });
      // A fresh profile shows the setup screen; one with a model installed may go straight to the app
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression:
        "JSON.stringify({ setup: !document.getElementById('setupOverlay').classList.contains('hidden'), app: !document.getElementById('appShell').classList.contains('hidden'), status: document.getElementById('setupStatus').textContent })" } }));
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
  if (v.error || !(v.setup || v.app)) fail(`Smoke test failed: ${verdict}`);
  console.log(`  ✓ the built app opens on ${v.app ? 'the main window' : `the setup screen ("${v.status}")`}`);
  finish();
})();

function finish() {
  console.log(`\n✓ Release ready: ${path.relative(ROOT, installer)}\n`);
}
