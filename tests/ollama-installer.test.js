// Ollama installer pieces: download with progress, signature check (the
// installer only runs if it is signed by Ollama Inc.), finding an install.
// Windows-only parts are skipped elsewhere.
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, tempDir, ROOT } = require('./helpers');

stubElectron();
const installer = require(path.join(ROOT, 'src/main/ollama/ollama-installer'));
const { verifySignature, download } = installer._internals;
const isWindows = process.platform === 'win32';
const dir = tempDir('athar-inst-');

const payload = Buffer.alloc(3 * 1024 * 1024, 7);
const server = http.createServer((req, res) => {
  if (req.url === '/short') {
    // claims more bytes than it sends
    res.writeHead(200, { 'content-length': String(payload.length) });
    res.end(payload.subarray(0, 1000));
    return;
  }
  res.writeHead(200, { 'content-length': String(payload.length) });
  res.end(payload);
});
const listening = new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;

test('download saves the whole file and reports progress', async () => {
  await listening;
  const file = path.join(dir, 'a.bin');
  const seen = [];
  await download(url('/file'), file, (p) => seen.push(p));
  assert.strictEqual(fs.statSync(file).size, payload.length);
  const last = seen[seen.length - 1];
  assert.strictEqual(last.phase, 'download');
  assert.strictEqual(last.received, payload.length);
  assert.strictEqual(last.total, payload.length);
});

test('an incomplete download is an error, not a broken installer', async () => {
  await listening;
  await assert.rejects(download(url('/short'), path.join(dir, 'b.bin'), () => {}));
});

test('a cancelled download stops', async () => {
  await listening;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(download(url('/file'), path.join(dir, 'c.bin'), () => {}, controller.signal));
});

if (isWindows) {
  test('an unsigned file is refused', async () => {
    const file = path.join(dir, 'fake.exe');
    fs.writeFileSync(file, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096)]));
    await assert.rejects(verifySignature(file), /not signed by Ollama/);
  });

  test('a validly signed file from another publisher is refused', async () => {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await assert.rejects(verifySignature(ps), /not signed by Ollama/);
  });

  const installedApp = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe');
  if (fs.existsSync(installedApp)) {
    test('a file signed by Ollama Inc. is accepted', async () => {
      await verifySignature(installedApp);
    });
    test('an existing Ollama install is found', async () => {
      assert(await installer.findOllama(), 'not found');
    });
  }
}

test('automatic install is offered on Windows only', () => {
  assert.strictEqual(installer.canInstall(), isWindows);
});

done().finally(() => server.close());
