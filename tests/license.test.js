// Beta license keys: signed offline keys, computer lock, end date, clock guard.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, tempDir, ROOT } = require('./helpers');
const { makeLicense, verifyKey, formatComputerId, computerId, KEY_PREFIX } = require(path.join(ROOT, 'src/main/license/license'));
const { makeKey } = require(path.join(ROOT, 'scripts/beta-key'));

const pair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
const dev = pair();
const other = pair();
const PC = 'ABCD-EF23';
const DAY = 86400000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const key = (extra = {}) => makeKey({ privateKey: dev.priv, name: 'Ahmed', computer: PC, expires: '2026-12-31', ...extra });
const check = (k, extra = {}) => verifyKey(k, { publicKey: dev.pub, computerId: PC, now: NOW, ...extra });

test('a key signed with the private key unlocks the app for that tester', () => {
  const k = key();
  assert(k.startsWith(KEY_PREFIX));
  const r = check(k);
  assert.strictEqual(r.state, 'ok');
  assert.strictEqual(r.name, 'Ahmed');
  assert.strictEqual(r.expires, '2026-12-31');
  assert.strictEqual(r.daysLeft, 95);
});

test('pasting with spaces or line breaks still works', () => {
  const k = key();
  const messy = `  ${k.slice(0, 30)}\n${k.slice(30, 70)} \r\n ${k.slice(70)}  `;
  assert.strictEqual(check(messy).state, 'ok');
});

test('changing any detail (e.g. the end date) breaks the signature', () => {
  const k = key();
  const [details, sig] = k.slice(KEY_PREFIX.length).split('.');
  const d = JSON.parse(Buffer.from(details, 'base64url'));
  d.e = '2099-12-31';
  const edited = `${KEY_PREFIX}${Buffer.from(JSON.stringify(d)).toString('base64url')}.${sig}`;
  assert.strictEqual(check(edited).state, 'invalid');
  const flipped = k.slice(0, -5) + (k.slice(-5, -4) === 'A' ? 'B' : 'A') + k.slice(-4);
  assert.strictEqual(check(flipped).state, 'invalid');
});

test('a key made with a different private key is rejected', () => {
  const forged = makeKey({ privateKey: other.priv, name: 'Pirate', computer: PC, expires: '2030-01-01' });
  assert.strictEqual(check(forged).state, 'invalid');
});

test('garbage and empty input are rejected, never throw', () => {
  for (const k of ['', 'hello', `${KEY_PREFIX}abc`, `${KEY_PREFIX}abc.def`, `${KEY_PREFIX}a.b.c`, null, undefined]) {
    assert.strictEqual(check(k).state, 'invalid', String(k));
  }
});

test('the key only works on the computer it was made for', () => {
  assert.strictEqual(check(key(), { computerId: 'ZZZZ-9999' }).state, 'wrong-computer');
  assert.strictEqual(check(key(), { computerId: 'abcdef23' }).state, 'ok', 'ID typed without dash / lowercase');
  const anyPc = makeKey({ privateKey: dev.priv, name: 'Sara', computer: null, expires: '2026-12-31' });
  assert.strictEqual(check(anyPc, { computerId: 'ZZZZ-9999' }).state, 'ok', '--any-computer keys');
});

test('the key stops working after its end date (end of that day, UTC)', () => {
  assert.strictEqual(check(key(), { now: Date.parse('2026-12-31T23:00:00Z') }).state, 'ok');
  assert.strictEqual(check(key(), { now: Date.parse('2027-01-01T00:00:01Z') }).state, 'expired');
});

test('activation saves the key; status is checked on every start; warns in the last 7 days', () => {
  let t = NOW;
  const file = path.join(tempDir('athar-lic-'), 'license.json');
  const lic = makeLicense({ storeFile: file, publicKey: dev.pub, getComputerId: () => PC, now: () => t });
  assert.strictEqual(lic.status().state, 'missing');
  assert.strictEqual(lic.isUsable(), false);
  assert.strictEqual(lic.activate('nonsense').state, 'invalid');
  assert.strictEqual(lic.activate(key({ computer: 'ZZZZ-9999' })).state, 'wrong-computer');
  assert(!fs.existsSync(file), 'bad keys are not saved');
  assert.strictEqual(lic.activate(key()).state, 'ok');
  assert.strictEqual(lic.status().state, 'ok');
  assert.strictEqual(lic.status().warn, false);
  t = Date.parse('2026-12-27T10:00:00Z');
  assert.strictEqual(lic.status().warn, true, '5 days left');
  t = Date.parse('2027-01-02T10:00:00Z');
  assert.strictEqual(lic.status().state, 'expired');
  assert.strictEqual(lic.isUsable(), false);
});

test('setting the clock back after the end date does not reopen the app', () => {
  let t = Date.parse('2027-01-05T10:00:00Z');
  const file = path.join(tempDir('athar-lic-'), 'license.json');
  fs.writeFileSync(file, JSON.stringify({ key: key(), lastSeen: Date.parse('2026-11-01T00:00:00Z') }));
  const lic = makeLicense({ storeFile: file, publicKey: dev.pub, getComputerId: () => PC, now: () => t });
  assert.strictEqual(lic.status().state, 'expired');
  t = Date.parse('2026-12-01T10:00:00Z'); // clock moved back a month
  assert.strictEqual(lic.status().state, 'clock');
  t = Date.parse('2027-01-05T09:00:00Z'); // small differences (time zones) are fine
  assert.strictEqual(lic.status().state, 'expired');
});

test('no public key in the build → locked; development (not required) → open', () => {
  const file = path.join(tempDir('athar-lic-'), 'license.json');
  assert.strictEqual(makeLicense({ storeFile: file, publicKey: null, getComputerId: () => PC }).status().state, 'not-configured');
  const devMode = makeLicense({ storeFile: file, publicKey: dev.pub, getComputerId: () => PC, required: false });
  assert.strictEqual(devMode.status().state, 'dev');
  assert.strictEqual(devMode.isUsable(), true);
});

test('computer ID: short, readable, stable', () => {
  const a = formatComputerId('11111111-2222-3333-4444-555555555555');
  assert.match(a, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.strictEqual(a, formatComputerId('11111111-2222-3333-4444-555555555555'));
  assert.notStrictEqual(a, formatComputerId('11111111-2222-3333-4444-555555555556'));
  assert.doesNotMatch(a, /[ILOU]/);
  assert.match(computerId(), /^[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'this computer');
  assert.strictEqual(computerId(), computerId());
});

done();
