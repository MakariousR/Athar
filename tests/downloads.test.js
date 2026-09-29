// Downloads: warning before closing, unfinished model downloads, leftover installer cleanup.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, tempDir, ROOT } = require('./helpers');

stubElectron();
const downloads = require(path.join(ROOT, 'src/main/downloads'));
const { cleanupLeftoverInstallers } = require(path.join(ROOT, 'src/main/ollama/ollama-installer'));

test('closing: no warning when nothing is downloading', () => {
  assert.strictEqual(downloads.closeWarning(), null);
});

test('closing during a model download: warns, and says it can be continued', () => {
  downloads.start('model:qwen3:8b', { kind: 'model', label: 'qwen3:8b' });
  downloads.update('model:qwen3:8b', { percent: 45 });
  const w = downloads.closeWarning();
  assert.strictEqual(w.message, 'A download is in progress');
  assert(/qwen3:8b is downloading \(45%\)/.test(w.detail) && /continue it next time/.test(w.detail), w.detail);
  downloads.end('model:qwen3:8b');
  assert.strictEqual(downloads.closeWarning(), null);
});

test('closing during the Ollama download vs. while it installs', () => {
  downloads.start('ollama', { kind: 'ollama', label: 'Ollama' });
  downloads.update('ollama', { phase: 'download', percent: 30 });
  assert(/Ollama is downloading \(30%\).*starts again/.test(downloads.closeWarning().detail));
  downloads.update('ollama', { phase: 'install', percent: 0 });
  const w = downloads.closeWarning();
  assert.strictEqual(w.message, 'Ollama is being installed');
  assert(/wait a minute/.test(w.detail) && /half-installed/.test(w.detail), w.detail);
  downloads.end('ollama');
});

test('unfinished model downloads are remembered until they finish', () => {
  downloads.addPending('qwen3:8b');
  downloads.addPending('bge-m3');
  downloads.addPending('qwen3:8b'); // no duplicates
  assert.deepStrictEqual(downloads.readPending(), ['qwen3:8b', 'bge-m3']);
  downloads.removePending('qwen3:8b');
  assert.deepStrictEqual(downloads.readPending(), ['bge-m3']);
  downloads.removePending('bge-m3');
  assert.deepStrictEqual(downloads.readPending(), []);
});

test('leftover installer folders: removed only when no running app owns them', async () => {
  const tmp = tempDir('athar-cleanup-');
  const make = (name, owner, ageHours = 0) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'OllamaSetup.exe'), 'partial');
    if (owner) fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify(owner));
    const t = (Date.now() - ageHours * 3600000) / 1000;
    fs.utimesSync(dir, t, t);
    return dir;
  };
  const running = make('athar-ollama-running', { pid: process.ppid, started: Date.now() }); // another live process
  const dead = make('athar-ollama-dead', { pid: 2147483000, started: Date.now() - 3600000 });
  const newNoOwner = make('athar-ollama-new', null, 1);      // e.g. started by an older version right now
  const oldNoOwner = make('athar-ollama-old', null, 30);
  const unrelated = path.join(tmp, 'something-else');
  fs.mkdirSync(unrelated);

  const removed = await cleanupLeftoverInstallers({ tempDir: tmp });
  assert.strictEqual(removed, 2);
  assert(fs.existsSync(running), 'a running download is never touched');
  assert(!fs.existsSync(dead), 'owner no longer running → removed');
  assert(fs.existsSync(newNoOwner), 'recent folder without owner record is kept');
  assert(!fs.existsSync(oldNoOwner), 'old folder without owner record → removed');
  assert(fs.existsSync(unrelated), 'other folders are never touched');
});

done();
