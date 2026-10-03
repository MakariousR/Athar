// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, ROOT } = require('./helpers');

const userData = stubElectron();
const store = require(path.join(ROOT, 'src/main/store/chat-store'));
const { parseAnyExport } = require(path.join(ROOT, 'src/main/parser/chatgpt-parser'));
const { isContinuationRequest, looksCutOff } = require(path.join(ROOT, 'src/main/ipc-handlers'))._internals;

const tmpFile = (name, data) => { const p = path.join(userData, name); fs.writeFileSync(p, JSON.stringify(data)); return p; };

// ── Export parsing ──
const gptConv = (title, text, extra = {}) => ({
  title, create_time: 1700000000, current_node: 'b', ...extra,
  mapping: {
    a: { message: { author: { role: 'user' }, content: { parts: [text] } }, parent: null },
    b: { message: { author: { role: 'assistant' }, content: { parts: ['reply to ' + text] } }, parent: 'a' }
  }
});

test('ChatGPT: same-title conversations without IDs stay separate, IDs stable', () => {
  const file = tmpFile('gpt.json', [gptConv('New chat', 'how do I bake bread'), gptConv('New chat', 'fix my python error')]);
  const threads = parseAnyExport(file);
  assert.strictEqual(threads.length, 2);
  assert.notStrictEqual(threads[0].id, threads[1].id);
  assert(!threads.some((t) => t.id === 'New chat'));
  assert.deepStrictEqual(parseAnyExport(file).map((t) => t.id), threads.map((t) => t.id));
});

test('ChatGPT: real conversation_id is used when present', () => {
  const file = tmpFile('gpt2.json', [gptConv('X', 'hello', { conversation_id: 'abc-123' })]);
  assert.strictEqual(parseAnyExport(file)[0].id, 'abc-123');
});

test('Claude: content-array messages parsed; conversations without uuid get content IDs', () => {
  const file = tmpFile('claude.json', [
    { name: 'Untitled', created_at: '2026-01-01T00:00:00Z', chat_messages: [
      { sender: 'human', text: '', content: [{ type: 'text', text: 'What is 2+2?' }] },
      { sender: 'assistant', text: '', content: [{ type: 'text', text: '4' }, { type: 'tool_use', name: 'x' }] }
    ] },
    { name: 'Untitled', created_at: '2026-01-02T00:00:00Z', chat_messages: [{ sender: 'human', text: 'Different chat' }] }
  ]);
  const threads = parseAnyExport(file);
  assert.strictEqual(threads.length, 2);
  assert.strictEqual(threads[0].messages.length, 2);
  assert.strictEqual(threads[0].messages[0].text, 'What is 2+2?');
  assert.notStrictEqual(threads[0].id, threads[1].id);
});

// ── "continue" detection ──
const hist = (reply) => [{ role: 'user', text: 'q' }, { role: 'assistant', text: reply }];

test('continuation only for explicit phrases after a cut-off reply', () => {
  const cut = hist('Here is the plan:\n1. Install the package\n2. Configure the');
  const finished = hist('All done. The file was updated.');
  assert(isContinuationRequest('continue', cut));
  assert(isContinuationRequest('Please continue.', cut));
  assert(isContinuationRequest('keep going', hist('```js\nconst a = 1;\n')));
  assert(!isContinuationRequest('continue', finished));
  for (const w of ['next', 'more', 'proceed', 'and?', 'finish']) {
    assert(!isContinuationRequest(w, cut), `"${w}" must not be rewritten`);
  }
  assert(!looksCutOff('Done 🎉'));
  assert(looksCutOff('The results show that'));
});

// ── Chat store ──
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('legacy inline images migrate to files; sessions.json no longer holds base64', () => {
  const chats = path.join(userData, 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.writeFileSync(path.join(chats, 'sessions.json'), JSON.stringify([
    { id: 's_legacy', title: 'Old', messages: [{ role: 'user', text: 'look', images: [PNG_B64, `data:image/png;base64,${PNG_B64}`] }], resources: [] }
  ]));
  const imgs = store.loadSessions()[0].messages[0].images;
  assert(imgs.every((i) => i.startsWith('ref:')), JSON.stringify(imgs));
  assert.strictEqual(new Set(imgs).size, 1, 'same image stored once');
  assert(!fs.readFileSync(path.join(chats, 'sessions.json'), 'utf8').includes(PNG_B64.slice(0, 40)));
  assert.deepStrictEqual(store.getSession('s_legacy', { withImages: true }).messages[0].images, [PNG_B64, PNG_B64]);
  assert(store.getSession('s_legacy').messages[0].images[0].startsWith('ref:'), 'default getSession stays lightweight');
});

test('appendMessage stores images as refs; deleting the session removes them', () => {
  const s = store.createSession();
  store.appendMessage(s.id, 'user', 'with image', [PNG_B64]);
  assert(store.getSession(s.id).messages[0].images[0].startsWith('ref:'));
  assert.strictEqual(store.getSession(s.id, { withImages: true }).messages[0].images[0], PNG_B64);
  const imgDir = path.join(userData, 'chats', 'images', s.id);
  assert(fs.existsSync(imgDir));
  store.deleteSession(s.id);
  assert(!fs.existsSync(imgDir));
});

test('an answer keeps its thinking steps (and "stopped") when the chat is reopened', () => {
  const s = store.createSession();
  store.appendMessage(s.id, 'user', 'what is the gold price today?');
  store.appendMessage(s.id, 'assistant', 'Partial answer…\n\n_Stopped._', [], [], {
    steps: ['Analyzing request…', 'Searching the web first…', '', 'x'.repeat(1000), 'Stopped by you.'],
    stopped: true
  });
  const saved = store.getSession(s.id).messages[1];
  assert.deepStrictEqual(saved.steps.slice(0, 2), ['Analyzing request…', 'Searching the web first…']);
  assert.strictEqual(saved.steps.length, 4, 'empty steps dropped');
  assert.strictEqual(saved.steps[2].length, 400, 'long steps shortened');
  assert.strictEqual(saved.stopped, true);
  store.appendMessage(s.id, 'assistant', 'plain');
  const plain = store.getSession(s.id).messages[2];
  assert(!('steps' in plain) && !('stopped' in plain), 'nothing extra stored when there are no steps');
});

done();
