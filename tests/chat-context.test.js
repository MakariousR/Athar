// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, ROOT } = require('./helpers');

stubElectron();
const cc = require(path.join(ROOT, 'src/main/ollama/chat-context'));
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));

const NOW = new Date('2026-09-29T15:00:00').getTime();
const DAY = 86400000;

test('where an earlier reply came from, read from its saved steps', () => {
  assert.strictEqual(cc.replyProvenance({ text: 'x', steps: ['Analyzing request…', 'Thinking & synthesizing answer…', 'Answer ready.'] }), 'unchecked');
  assert.strictEqual(cc.replyProvenance({ text: 'x' }), 'unchecked', 'old chats without steps');
  assert.strictEqual(cc.replyProvenance({ text: 'x', steps: ['Searching web for: "gold price"', 'Answer checks out against the sources found.'] }), 'web');
  assert.strictEqual(cc.replyProvenance({ text: 'x', steps: ['Searching web for: "a"', 'Some details may not be fully verified — noted below.'] }), 'web-partly-unverified');
  assert.strictEqual(cc.replyProvenance({ text: 'x\n\n---\n⚠️ *Not fully verified against the sources found: "…"*', steps: ['Searching web for: "a"'] }), 'web-partly-unverified');
  assert.strictEqual(cc.replyProvenance({ text: 'partial', stopped: true, steps: ['Searching web for: "a"'] }), 'stopped');
});

test('how long ago', () => {
  assert.strictEqual(cc.howLongAgo(NOW - 3600000, NOW), 'earlier today');
  assert.strictEqual(cc.howLongAgo(NOW - DAY, NOW), 'yesterday');
  assert.strictEqual(cc.howLongAgo(NOW - 5 * DAY, NOW), '5 days ago');
  assert.strictEqual(cc.howLongAgo(undefined, NOW), '');
});

test('the note names each earlier reply and says which were never checked', () => {
  const history = [
    { role: 'user', text: 'which is better, harmash or w3schools?' },
    { role: 'assistant', text: '## Comparison\n**W3Schools** has tutorials in Arabic, and Harmash is great.', timestamp: NOW - 2 * DAY, steps: ['Answer ready.'] },
    { role: 'user', text: 'what is the gold price today?' },
    { role: 'assistant', text: 'Gold is at $2,400 per ounce according to Reuters.', timestamp: NOW - 3600000, steps: ['Searching web for: "gold price"', 'Answer checks out against the sources found.'] },
    { role: 'user', text: 'and does w3schools have Arabic?' }
  ];
  const note = cc.earlierRepliesNote(history, { now: NOW });
  assert(/NOT sources/.test(note), note);
  assert(/"Comparison W3Schools has tutorials in Arabic, and Harmash is great\." — written from your own training knowledge, never checked/.test(note), note);
  assert(/"Gold is at \$2,400 per ounce according to Reuters\." — based on web results found earlier today/.test(note), note);
  assert(/the earlier reply was wrong: say so/.test(note));
  assert.strictEqual(cc.earlierRepliesNote([{ role: 'user', text: 'hi' }], { now: NOW }), '', 'first message: no note');
});

test('only the most recent replies the model is sent are described', () => {
  const history = [];
  for (let i = 0; i < 10; i++) history.push({ role: 'user', text: `q${i}` }, { role: 'assistant', text: `answer number ${i}`, timestamp: NOW });
  const note = cc.earlierRepliesNote(history, { now: NOW });
  assert.strictEqual((note.match(/^- "/gm) || []).length, 4);
  assert(note.includes('answer number 9') && !note.includes('answer number 5'));
});

test('the note and the "what counts as a source" rule reach the model, next to the new message', () => {
  const history = [
    { role: 'user', text: 'does w3schools have Arabic?' },
    { role: 'assistant', text: 'Yes, W3Schools has full Arabic tutorials.', timestamp: NOW - DAY },
    { role: 'user', text: 'are you sure?' }
  ];
  const msgs = client._internals.buildMessages('are you sure?', {
    cutoffLabel: 'late 2023', toolsAvailable: true, webAllowed: false, earlierReplies: cc.earlierRepliesNote(history, { now: NOW })
  }, history);
  const system = msgs.find((m) => m.role === 'system').content;
  assert(/WHAT COUNTS AS A SOURCE: the conversation so far is not a source of facts/.test(system));
  const last = msgs[msgs.length - 1];
  assert.strictEqual(last.role, 'user');
  assert(last.content.startsWith('are you sure?'), last.content.slice(0, 50));
  assert(/<earlier_replies_in_this_chat>[\s\S]*"Yes, W3Schools has full Arabic tutorials\." — written from your own training knowledge, never checked/.test(last.content), last.content);
  // the earlier reply is still sent in full (continuity), marked as unchecked, and the model is asked to check it
  assert(msgs.some((m) => m.role === 'assistant' && m.content === `${cc.UNCHECKED_MARKER}\nYes, W3Schools has full Arabic tutorials.`));
  assert(last.content.includes(cc.CHECK_FIRST_LINE));
});

test('replies checked against the web are not marked, and nothing is marked for "continue"', () => {
  const web = { role: 'assistant', text: 'Gold is $2,400.', timestamp: NOW, steps: ['Searching web for: "gold"', 'Answer checks out against the sources found.'] };
  const history = [{ role: 'user', text: 'gold price?' }, web, { role: 'user', text: 'and silver?' }];
  const msgs = client._internals.buildMessages('and silver?', { toolsAvailable: false, webAllowed: false, earlierReplies: cc.earlierRepliesNote(history, { now: NOW }) }, history);
  assert(msgs.some((m) => m.role === 'assistant' && m.content === 'Gold is $2,400.'));
  assert(!msgs[msgs.length - 1].content.includes(cc.CHECK_FIRST_LINE), 'nothing unchecked: no check line');

  const unchecked = [{ role: 'user', text: 'write a poem' }, { role: 'assistant', text: 'Roses are red…' }, { role: 'user', text: 'continue' }];
  const cont = client._internals.buildMessages('Please continue exactly from where you left off.', { toolsAvailable: false, webAllowed: false, earlierReplies: '' }, unchecked);
  assert(cont.some((m) => m.role === 'assistant' && m.content === 'Roses are red…'));
  assert(!cont[cont.length - 1].content.includes(cc.CHECK_FIRST_LINE));
});

test('an apology that opens the first reply of a chat is taken out; later ones are kept', () => {
  const first = [{ role: 'user', text: 'does w3schools offer arabic content?' }];
  assert.strictEqual(cc.stripUnpromptedApology('I apologize for the oversight. W3Schools is in English.', first), 'W3Schools is in English.');
  assert.strictEqual(cc.stripUnpromptedApology('I apologize for that oversight. Let me clarify based on the information I have:\nW3Schools is in English.', first), 'W3Schools is in English.');
  assert.strictEqual(cc.stripUnpromptedApology('أعتذر عن الخطأ السابق. موقع W3Schools باللغة الإنجليزية.', first), 'موقع W3Schools باللغة الإنجليزية.');
  assert.strictEqual(cc.stripUnpromptedApology('Sorry, I cannot help with that.', first), 'Sorry, I cannot help with that.', 'not an apology for a mistake');
  const later = [...first, { role: 'assistant', text: 'Yes it does.' }, { role: 'user', text: 'are you sure?' }];
  assert.strictEqual(cc.stripUnpromptedApology('I apologize for the mistake. It does not.', later), 'I apologize for the mistake. It does not.', 'a real correction keeps its apology');
});

test('a marker the model copies into its answer is taken out', () => {
  assert.strictEqual(cc.stripMarker(`${cc.UNCHECKED_MARKER}\nThe capital is Canberra.`), 'The capital is Canberra.');
  assert.strictEqual(cc.stripMarker('The capital is Canberra.'), 'The capital is Canberra.');
});

done();
