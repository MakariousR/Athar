const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { isOllamaRunning } = require('./ollama-client');

/**
 * Finds, starts and (on Windows) installs Ollama, so people who have never
 * used a terminal can get going from the setup screen.
 *
 * Install = download the official OllamaSetup.exe, check it is signed by
 * Ollama Inc. with a valid certificate, run it silently (per-user install,
 * no admin prompt), then start the Ollama server. Other platforms get the
 * download page instead.
 */

const SETUP_URL = 'https://ollama.com/download/OllamaSetup.exe';
const DOWNLOAD_PAGE = 'https://ollama.com/download';
const SIGNER_RE = /\bO=Ollama Inc\.(,|$)/;
const EXTRA_SPACE_NEEDED = 3 * 1024 ** 3; // installed files + first model download headroom
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

const canInstall = () => process.platform === 'win32';

/** Places Ollama installs itself, per platform. */
function candidatePaths() {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [
      path.join(local, 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe')
    ];
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama'];
  }
  return ['/usr/local/bin/ollama', '/usr/bin/ollama', path.join(os.homedir(), '.local', 'bin', 'ollama')];
}

function whichOllama() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, ['ollama'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      const first = !err && String(stdout).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      resolve(first && fs.existsSync(first) ? first : null);
    });
  });
}

/** Path to the ollama executable, or null when Ollama isn't installed. */
async function findOllama() {
  return candidatePaths().find((p) => fs.existsSync(p)) || await whichOllama();
}

/** Size of the official installer in bytes (null if it can't be checked). */
async function installerSize() {
  if (!canInstall()) return null;
  try {
    const res = await fetch(SETUP_URL, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const n = Number(res.headers.get('content-length'));
    return res.ok && n > 0 ? n : null;
  } catch { return null; }
}

async function waitUntilRunning(timeoutMs, signal) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (signal && signal.aborted) throw abortError();
    if (await isOllamaRunning()) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

/**
 * Starts the Ollama server in the background (it keeps running after this
 * app closes, like Ollama's own tray app). Resolves once it answers.
 */
async function startOllama(exePath) {
  if (await isOllamaRunning()) return;
  const exe = exePath || await findOllama();
  if (!exe) throw new Error('Ollama is not installed.');
  const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  let spawnError = null;
  child.on('error', (err) => { spawnError = err; });
  child.unref();
  if (!(await waitUntilRunning(30000))) {
    throw new Error(spawnError ? `Could not start Ollama: ${spawnError.message}` : 'Ollama did not start. Try restarting your computer.');
  }
}

function abortError() {
  const err = new Error('Installation cancelled.');
  err.cancelled = true;
  return err;
}

async function checkFreeSpace(dir, needed) {
  try {
    const s = await fs.promises.statfs(dir);
    const free = s.bavail * s.bsize;
    if (free < needed) {
      throw new Error(`Not enough free disk space: Ollama needs about ${formatGB(needed)} and ${formatGB(free)} is free.`);
    }
  } catch (err) {
    if (/Not enough free disk space/.test(err.message)) throw err; // statfs itself failing isn't fatal
  }
}

const formatGB = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

async function download(url, file, onProgress, signal) {
  const res = await fetch(url, { redirect: 'follow', signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  await checkFreeSpace(path.dirname(file), total + EXTRA_SPACE_NEEDED);

  let received = 0;
  let lastReport = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastReport > 250) { lastReport = now; onProgress({ phase: 'download', received, total }); }
  });
  await pipeline(body, fs.createWriteStream(file), { signal });
  if (total && received !== total) throw new Error('The download was incomplete. Check your internet connection and try again.');
  onProgress({ phase: 'download', received, total: total || received });
}

/** Checks the installer's Authenticode signature: valid, and signed by Ollama Inc. */
function verifySignature(file) {
  return new Promise((resolve, reject) => {
    const script = '$s = Get-AuthenticodeSignature -LiteralPath $env:ATHAR_VERIFY_FILE; ' +
      "Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 60000, env: { ...process.env, ATHAR_VERIFY_FILE: file } },
      (err, stdout) => {
        if (err) { reject(new Error(`Could not check the installer's signature: ${err.message}`)); return; }
        const [status, subject = ''] = String(stdout).trim().split('|');
        if (status === 'Valid' && SIGNER_RE.test(subject)) resolve();
        else reject(new Error('The downloaded installer is not signed by Ollama, so it was not run.'));
      });
  });
}

function runInstaller(file, signal) {
  return new Promise((resolve, reject) => {
    // Inno Setup flags: no windows, no message boxes, never reboot
    const child = spawn(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('The Ollama installer took too long and was stopped.')); }, INSTALL_TIMEOUT_MS);
    const onAbort = () => { child.kill(); reject(abortError()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`Could not run the Ollama installer: ${err.message}`)); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`The Ollama installer failed (exit code ${code}).`));
    });
  });
}

let current = null; // { controller } while an install runs

/**
 * Downloads, verifies and installs Ollama, then starts it.
 * onProgress({ phase: 'download'|'verify'|'install'|'start', received?, total? })
 */
async function installOllama(onProgress = () => {}) {
  if (!canInstall()) throw new Error('Automatic install is only available on Windows.');
  if (current) throw new Error('Ollama is already being installed.');
  const controller = new AbortController();
  current = { controller };
  const { signal } = controller;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'athar-ollama-'));
  const file = path.join(dir, 'OllamaSetup.exe');
  try {
    onProgress({ phase: 'download', received: 0, total: 0 });
    await download(SETUP_URL, file, onProgress, signal);
    if (signal.aborted) throw abortError();

    onProgress({ phase: 'verify' });
    await verifySignature(file);
    if (signal.aborted) throw abortError();

    onProgress({ phase: 'install' });
    await runInstaller(file, signal);

    onProgress({ phase: 'start' });
    // The installer may start Ollama itself; give it a moment before starting it ourselves.
    if (!(await waitUntilRunning(5000))) await startOllama();
  } catch (err) {
    if (signal.aborted || err.name === 'AbortError') throw abortError();
    throw err;
  } finally {
    current = null;
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function cancelInstall() {
  if (current) current.controller.abort();
}

module.exports = {
  canInstall, findOllama, installerSize, startOllama, installOllama, cancelInstall, DOWNLOAD_PAGE,
  _internals: { verifySignature, download }
};
