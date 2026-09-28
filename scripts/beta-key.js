#!/usr/bin/env node
/**
 * Beta license keys — the developer's tool (not part of the app).
 *
 *   npm run beta-key -- init
 *       Once: creates your signing key pair. The PRIVATE key is saved outside
 *       the project (~/.athar-signing/). The PUBLIC key is written into
 *       src/main/license/public-key.js, so the app can check keys.
 *
 *   npm run beta-key -- --name "Ahmed" --computer 7KQ2-M9XD [--expires 2026-12-31]
 *       Makes a license key for one tester, for their computer (the ID shown
 *       on Athar's activation screen), valid until the end date.
 *
 *   npm run beta-key -- check <key>      what a key contains, and whether it is genuine
 *   npm run beta-key -- list             keys you have made (kept next to your private key)
 *
 * Keep the private key secret and backed up: without it you can't make keys
 * for builds that contain its public key; with it, anyone could.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KEY_PREFIX, parseKey, verifyKey, normalizeComputerId } = require('../src/main/license/license');

const ROOT = path.join(__dirname, '..');
const SIGNING_DIR = process.env.ATHAR_SIGNING_DIR || path.join(os.homedir(), '.athar-signing');
const PRIVATE_KEY_FILE = path.join(SIGNING_DIR, 'beta-private-key.pem');
const LOG_FILE = path.join(SIGNING_DIR, 'issued-keys.csv');
const PUBLIC_KEY_MODULE = path.join(ROOT, 'src', 'main', 'license', 'public-key.js');
const DEFAULT_EXPIRES = '2026-12-31';
const ID_CHARS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** Signs a tester's details with the private key → license key string. */
function makeKey({ privateKey, name, computer, expires, keyId }) {
  const details = { v: 1, i: keyId || randomId(), n: name, c: computer ? normalizeComputerId(computer) : undefined, e: expires };
  const bytes = Buffer.from(JSON.stringify(details), 'utf8');
  const signature = crypto.sign(null, bytes, crypto.createPrivateKey(privateKey));
  return `${KEY_PREFIX}${bytes.toString('base64url')}.${signature.toString('base64url')}`;
}

function randomId() {
  const bytes = crypto.randomBytes(6);
  return [...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

function publicKeyInApp() {
  delete require.cache[require.resolve(PUBLIC_KEY_MODULE)];
  return require(PUBLIC_KEY_MODULE);
}

function publicKeyOf(privatePem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privatePem)).export({ type: 'spki', format: 'pem' }).toString();
}

function writePublicKeyModule(publicPem) {
  fs.writeFileSync(PUBLIC_KEY_MODULE,
    '// The public half of the beta signing key: it can CHECK license keys, never\n' +
    '// make them. Written by `npm run beta-key -- init` (the private half stays on\n' +
    "// the developer's PC). null = not set up yet: a packaged build then refuses to\n" +
    '// run, and `npm run release` refuses to build.\n' +
    `module.exports = ${JSON.stringify(publicPem)};\n`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

const fail = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };

function init({ force }) {
  if (fs.existsSync(PRIVATE_KEY_FILE) && !force) {
    const pub = publicKeyOf(fs.readFileSync(PRIVATE_KEY_FILE, 'utf8'));
    if (publicKeyInApp() !== pub) writePublicKeyModule(pub);
    console.log(`\n  Your signing key already exists: ${PRIVATE_KEY_FILE}\n  The app's public key matches it.` +
      '\n  (A new key pair would make every key you have given out stop working with new builds.' +
      '\n   If you really want that: npm run beta-key -- init --force)\n');
    return;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(SIGNING_DIR, { recursive: true });
  fs.writeFileSync(PRIVATE_KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writePublicKeyModule(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  console.log(`\n  ✓ Signing key pair created.
    PRIVATE key (secret — back it up, never share it):  ${PRIVATE_KEY_FILE}
    PUBLIC key written into the app:                    src/main/license/public-key.js

  Next: build the installer (npm run release), then make a key per tester:
    npm run beta-key -- --name "Tester name" --computer XXXX-XXXX\n`);
}

function make(args) {
  if (!fs.existsSync(PRIVATE_KEY_FILE)) fail('No signing key yet. Run: npm run beta-key -- init');
  const privatePem = fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
  if (publicKeyInApp() !== publicKeyOf(privatePem)) {
    fail('The public key in src/main/license/public-key.js does not match your private key. Run: npm run beta-key -- init');
  }
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) fail('Give the tester\'s name: --name "Ahmed"');
  if (name.length > 60) fail('Name is too long (60 characters at most).');
  let computer = null;
  if (args['any-computer'] !== true) {
    computer = normalizeComputerId(args.computer);
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(computer)) {
      fail('Give the computer ID shown on the tester\'s activation screen: --computer 7KQ2-M9XD\n' +
        '    (or --any-computer for a key that works on any computer — easier to share, so use it sparingly)');
    }
  }
  const expires = typeof args.expires === 'string' ? args.expires : DEFAULT_EXPIRES;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || !Number.isFinite(Date.parse(`${expires}T00:00:00Z`))) fail('End date must look like 2026-12-31.');
  if (Date.parse(`${expires}T23:59:59Z`) < Date.now()) fail('That end date has already passed.');

  const keyId = randomId();
  const key = makeKey({ privateKey: privatePem, name, computer, expires, keyId });
  const check = verifyKey(key, { publicKey: publicKeyOf(privatePem), computerId: computer || '', now: Date.now() });
  if (check.state !== 'ok') fail('Self-check of the new key failed — nothing was issued.');

  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, 'issued,key_id,name,computer,expires\n');
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()},${keyId},"${name.replace(/"/g, '""')}",${computer || 'any'},${expires}\n`);

  console.log(`\n  License key for ${name} — ${computer ? `computer ${computer}` : 'ANY computer'} — until ${expires} (key ID ${keyId}):\n\n${key}\n`);
}

function check(key) {
  const parsed = parseKey(key);
  if (!parsed) fail('That is not an Athar beta key.');
  const pub = publicKeyInApp();
  const genuine = pub && verifyKey(key, { publicKey: pub, computerId: parsed.details.c || '' }).state !== 'invalid';
  const d = parsed.details;
  console.log(`\n  Name: ${d.n}\n  Computer: ${d.c || 'any'}\n  Ends: ${d.e}\n  Key ID: ${d.i}\n  Genuine (signed by your key): ${genuine ? 'yes' : 'NO'}\n`);
}

function list() {
  if (!fs.existsSync(LOG_FILE)) { console.log('\n  No keys made yet.\n'); return; }
  console.log(`\n${fs.readFileSync(LOG_FILE, 'utf8')}`);
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'init') init({ force: args.force === true });
  else if (cmd === 'check') check(args._[1]);
  else if (cmd === 'list') list();
  else make(args);
}

module.exports = { makeKey };
