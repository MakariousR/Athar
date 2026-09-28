/**
 * Beta license keys, checked offline.
 *
 * A license key is the tester's details (name, computer ID, end date, key ID)
 * plus a signature made with the developer's PRIVATE key, which never leaves
 * the developer's PC (see scripts/beta-key.js). The app only has the matching
 * PUBLIC key (public-key.js): it can check a signature, never make one. So
 * keys can't be forged, and changing any detail breaks the signature.
 *
 * Key format:  ATHAR-B1-<details, base64url JSON>.<signature, base64url>
 * Details:     { v: 1, i: keyId, n: name, c: computerId, e: 'YYYY-MM-DD' }
 *
 * The check only applies to the packaged app; `npm start` skips it unless
 * ATHAR_LICENSE=1 is set (to try the activation screen while developing).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY_PREFIX = 'ATHAR-B1-';
const DAY_MS = 86400000;
const CLOCK_TOLERANCE_MS = 36 * 3600000; // time zones, small clock fixes
const WARN_DAYS = 7;
const BASE32 = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789'; // 32 characters, no I, L, O, U (easy to read out)

// ─── Computer ID ─────────────────────────────────────────────────────────────

function rawMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
      }
    }
  } catch { /* fall through */ }
  return `${os.hostname()}|${os.userInfo().username}|${os.platform()}`; // last resort, still stable
}

/** Short, readable ID of this computer, e.g. "7KQ2-M9XD" (a hash — nothing personal in it). */
function formatComputerId(raw) {
  const hash = crypto.createHash('sha256').update(`athar-computer:${raw}`).digest();
  let id = '';
  for (let i = 0; i < 8; i++) id += BASE32[hash[i] % 32];
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

let cachedComputerId = null;
function computerId() {
  if (!cachedComputerId) cachedComputerId = formatComputerId(rawMachineId());
  return cachedComputerId;
}

const normalizeComputerId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');

// ─── Keys ────────────────────────────────────────────────────────────────────

/** Strips spaces/newlines a paste may add. */
function cleanKey(key) {
  return String(key || '').replace(/\s+/g, '').trim();
}

function parseKey(key) {
  const k = cleanKey(key);
  if (!k.startsWith(KEY_PREFIX)) return null;
  const [detailsPart, signaturePart, extra] = k.slice(KEY_PREFIX.length).split('.');
  if (!detailsPart || !signaturePart || extra !== undefined) return null;
  try {
    const detailsBytes = Buffer.from(detailsPart, 'base64url');
    const details = JSON.parse(detailsBytes.toString('utf8'));
    const signature = Buffer.from(signaturePart, 'base64url');
    if (!details || details.v !== 1 || typeof details.n !== 'string' || typeof details.e !== 'string' || signature.length !== 64) return null;
    return { details, detailsBytes, signature };
  } catch {
    return null;
  }
}

/** Last moment the key is valid: the end of its date, in UTC. */
const endOfDay = (yyyyMmDd) => Date.parse(`${yyyyMmDd}T23:59:59Z`);

/**
 * @param {string} key
 * @param {{ publicKey: string, computerId: string, now?: number }} opts
 * @returns {{ state: 'ok'|'invalid'|'expired'|'wrong-computer', name?, expires?, daysLeft?, keyId? }}
 */
function verifyKey(key, { publicKey, computerId: thisComputer, now = Date.now() }) {
  const parsed = parseKey(key);
  if (!parsed || !publicKey) return { state: 'invalid' };
  let genuine = false;
  try {
    genuine = crypto.verify(null, parsed.detailsBytes, crypto.createPublicKey(publicKey), parsed.signature);
  } catch { genuine = false; }
  if (!genuine) return { state: 'invalid' };

  const { n: name, e: expires, c: computer, i: keyId } = parsed.details;
  const end = endOfDay(expires);
  if (!Number.isFinite(end)) return { state: 'invalid' };
  const info = { name, expires, keyId, daysLeft: Math.max(0, Math.ceil((end - now) / DAY_MS)) };
  if (computer && normalizeComputerId(computer) !== normalizeComputerId(thisComputer)) return { ...info, state: 'wrong-computer' };
  if (now > end) return { ...info, state: 'expired' };
  return { ...info, state: 'ok' };
}

// ─── Stored activation + clock guard ─────────────────────────────────────────

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/**
 * The app's license state. Also remembers the latest time seen, so setting
 * the computer's clock back to before an end date doesn't reopen the app.
 */
function makeLicense({ storeFile, publicKey, getComputerId = computerId, required = true, now = () => Date.now() }) {
  function status() {
    const id = getComputerId();
    if (!required) return { state: 'dev', computerId: id };
    if (!publicKey) return { state: 'not-configured', computerId: id };
    const saved = readJson(storeFile);
    if (!saved || !saved.key) return { state: 'missing', computerId: id };

    const t = now();
    const lastSeen = Number(saved.lastSeen) || 0;
    if (lastSeen && t < lastSeen - CLOCK_TOLERANCE_MS) return { state: 'clock', computerId: id };
    const result = verifyKey(saved.key, { publicKey, computerId: id, now: Math.max(t, lastSeen) });
    if (t > lastSeen) writeJson(storeFile, { ...saved, lastSeen: t });
    return { ...result, computerId: id, warn: result.state === 'ok' && result.daysLeft <= WARN_DAYS };
  }

  /** Checks a key and, if it's good for this computer, saves it. */
  function activate(key) {
    const id = getComputerId();
    if (!publicKey) return { state: 'not-configured', computerId: id };
    const result = verifyKey(key, { publicKey, computerId: id, now: now() });
    if (result.state === 'ok') writeJson(storeFile, { key: cleanKey(key), activatedAt: now(), lastSeen: now() });
    return { ...result, computerId: id };
  }

  const isUsable = () => ['ok', 'dev'].includes(status().state);

  return { status, activate, isUsable };
}

module.exports = { makeLicense, verifyKey, parseKey, computerId, formatComputerId, normalizeComputerId, KEY_PREFIX };
