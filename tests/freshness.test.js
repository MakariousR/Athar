const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');
const f = require(path.join(ROOT, 'src/main/ollama/freshness'));

const NOW = new Date('2026-09-26T12:00:00Z');
const needs = (text, opts = {}) => f.needsFreshInfo(text, { cutoffYear: 2023, now: NOW, ...opts }).needed;

test('model knowledge cutoffs (approximate, by name prefix)', () => {
  assert.deepStrictEqual(f.modelKnowledgeCutoff('qwen2.5-coder:7b'), { label: 'late 2023', labelAr: 'أواخر 2023', year: 2023 });
  assert.strictEqual(f.modelKnowledgeCutoff('llama3.1:8b').label, 'December 2023');
  assert.strictEqual(f.modelKnowledgeCutoff('gemma3:4b').year, 2024);
  assert.deepStrictEqual(f.modelKnowledgeCutoff('some-custom-model'), { label: null, labelAr: null, year: null });
});

test('time-sensitive questions need current information', () => {
  for (const q of [
    'What is the latest version of Node.js?',
    'what is elon musk net worth',
    'Who is the current CEO of OpenAI?',
    'bitcoin price today',
    'Is Twitter still called X?',
    'What happened in the news this week?',
    'Who won the 2025 Champions League?',   // year after the cutoff
    'ما هو سعر الذهب اليوم؟',
    'ما هو أحدث إصدار من بايثون؟',
    'من هو رئيس فرنسا الحالي'
  ]) assert(needs(q), q);
});

test('timeless or personal questions do not', () => {
  for (const q of [
    'What is 17 times 23?',
    'Explain how recursion works',
    'What is the capital of Australia?',
    'Who won the 2018 World Cup?',            // explicit old year = history question
    'Write a poem about the sea',
    'What did I ask Claude about salary last year?',
    'what did we decide about the database last time',
    'ماذا سألت كلود عن بايثون؟',
    'how do I reverse a list in python',
    'I still don\'t understand recursion',
    'why does my code still fail?'
  ]) assert(!needs(q), q);
  assert(!needs('what is the latest version in this file?', { hasDocuments: true }), 'attached files answer it');
  assert(!needs('what is the current version of this project?', { isProjectQuestion: true }), 'project folder answers it');
});

test('unknown cutoff: only recent years count as "after the training data"', () => {
  const unknown = (text) => f.needsFreshInfo(text, { cutoffYear: null, now: NOW }).needed;
  assert(unknown('movies released in 2026'));
  assert(!unknown('history of the 2008 financial crisis'));
});

test('detects answers that admit not knowing or hedge with the training date', () => {
  for (const a of [
    "I don't have real-time information about current prices.",
    'As of my last update in 2023, the CEO was Sam Altman.',
    "I'm not aware of any release called Node 30.",
    'My knowledge cutoff means I may be out of date. Please check the official website.',
    'I do not have information about that event.',
    'لا أملك معلومات حديثة عن هذا الموضوع.',
    'حسب آخر تحديث لبياناتي، كان السعر 50 دولاراً.'
  ]) assert(f.looksUncertainOrDated(a), a);
  for (const a of ['17 × 23 = 391.', 'The capital of Australia is Canberra.', 'Here is a poem about the sea.']) {
    assert(!f.looksUncertainOrDated(a), a);
  }
});

test('offline note is in the user\'s language and names the cutoff', () => {
  const en = f.offlineNote({ why: 'offline', cutoffLabel: 'late 2023' });
  assert(/no internet connection/.test(en) && /around late 2023/.test(en));
  assert(/couldn't get web results/.test(f.offlineNote({ why: 'search-failed', cutoffLabel: null })));
  const ar = f.offlineNote({ why: 'offline', cutoffLabel: 'late 2023', arabic: true });
  assert(/لا يوجد اتصال بالإنترنت/.test(ar) && /late 2023/.test(ar));
  assert(f.hasTrainingDisclaimer(en) && f.hasTrainingDisclaimer(ar));
  const arLabel = f.offlineNote({ why: 'offline', cutoffLabel: 'late 2023', cutoffLabelAr: 'أواخر 2023', arabic: true });
  assert(/حتى حوالي أواخر 2023/.test(arLabel), arLabel);
  // the model already said it — don't add a second note
  assert(f.hasTrainingDisclaimer('My information is as of around late 2023, and it may have changed since.'));
  assert(!f.hasTrainingDisclaimer('Node.js 26.10.0 was released in September 2026.'));
  assert(!f.hasTrainingDisclaimer('عذرًا، لا أستطيع تقديم سعر الذهب اليوم.'));
  assert(f.hasTrainingDisclaimer('لا يمكنني تقديم السعر لأن لا يوجد إتصال بالإنترنت في الوقت الحالي.'), 'hamza spelling variant');
  assert(f.isArabic('ما هو سعر الذهب؟') && !f.isArabic('gold price?'));
});

// ── The "Search" button: search before every answer, with exceptions ──
const decide = (text, alwaysSearch, extra = {}) => f.shouldSearchFirst(text, {
  fresh: f.needsFreshInfo(text, { cutoffYear: 2023, ...extra }), alwaysSearch, ...extra
});

test('Search off: only questions that need current information are searched first', () => {
  assert.deepStrictEqual(decide('what is the latest version of Node.js?', false), { search: true, reason: 'fresh' });
  for (const q of ['write a python function that reverses a linked list', 'explain recursion', 'make it shorter']) {
    assert.strictEqual(decide(q, false).search, false, q);
  }
});

test('Search on: every question is searched first…', () => {
  for (const q of ['write a python function that reverses a linked list', 'explain recursion', 'ما هي عاصمة أستراليا؟']) {
    assert.deepStrictEqual(decide(q, true), { search: true, reason: 'always' }, q);
  }
  assert.strictEqual(decide('what is the latest version of Node.js?', true).reason, 'fresh', 'still marked as a current-information question');
});

test('…except small talk, questions about your own chats, attached files and the project folder', () => {
  for (const q of ['hi', 'Thanks a lot!', 'ok', 'thank you so much', 'شكرا جزيلا', 'صباح الخير', '']) {
    assert.strictEqual(decide(q, true).search, false, `small talk: "${q}"`);
  }
  for (const q of ['summarize my chat about the bakery database', 'ماذا قلنا في محادثاتي عن التداول؟', 'what did we decide last time?']) {
    assert.strictEqual(decide(q, true).search, false, `own chats: ${q}`);
  }
  assert.strictEqual(decide('what are the main risks?', true, { hasDocuments: true }).search, false, 'attached file');
  assert.strictEqual(decide('how is the router set up?', true, { isProjectQuestion: true }).search, false, 'project folder');
  assert.strictEqual(decide('ok, and what about Python 3.13?', true).search, true, 'a real question after "ok" is searched');
});

done();
