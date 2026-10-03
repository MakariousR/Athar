// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
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

test('the "from my training data" note is in the user\'s language and names the cutoff', () => {
  const en = f.offlineNote({ cutoffLabel: 'late 2023' });
  assert.strictEqual(en, 'Note: this is from my training data (up to around late 2023) and may be out of date.');
  assert(/up to my training date/.test(f.offlineNote({ cutoffLabel: null })));
  const ar = f.offlineNote({ cutoffLabel: 'late 2023', cutoffLabelAr: 'أواخر 2023', arabic: true });
  assert(/بيانات تدريبي/.test(ar) && /حتى حوالي أواخر 2023/.test(ar), ar);
  assert(f.hasTrainingDisclaimer(en) && f.hasTrainingDisclaimer(ar));
  assert(!/Search|internet|web/i.test(en), 'no mention of going online');
  assert(/does not go online/.test(f.offlineInstruction({ cutoffLabel: 'late 2023' })) && /late 2023/.test(f.offlineInstruction({ cutoffLabel: 'late 2023' })));
  // the model already said it — don't add a second note
  assert(f.hasTrainingDisclaimer('My information is as of around late 2023, and it may have changed since.'));
  assert(!f.hasTrainingDisclaimer('Node.js 26.10.0 was released in September 2026.'));
  assert(!f.hasTrainingDisclaimer('عذرًا، لا أستطيع تقديم سعر الذهب اليوم.'));
  assert(f.hasTrainingDisclaimer('لا يمكنني تقديم السعر لأن لا يوجد إتصال بالإنترنت في الوقت الحالي.'), 'hamza spelling variant');
  assert(f.isArabic('ما هو سعر الذهب؟') && !f.isArabic('gold price?'));
});

test('Gemini models: cutoffs Google documents, by model id (with or without the provider prefix)', () => {
  assert.strictEqual(f.modelKnowledgeCutoff('gemini/gemini-2.5-flash').label, 'January 2025');
  assert.strictEqual(f.modelKnowledgeCutoff('gemini-2.0-flash').year, 2024);
  assert.strictEqual(f.modelKnowledgeCutoff('gemini/gemini-3.5-flash').label, null, 'unknown: no guess');
});

test('questions about your own chats: time words about the chats are not "current information"', () => {
  const inside = (q) => f.needsFreshInfo(q, { cutoffYear: 2023, includePersonal: true }).needed;
  for (const q of ['summarize my latest chat', 'what did I say in my latest conversation about docker?', 'what did I ask Claude recently?', 'ما آخر محادثة لي عن التداول؟']) {
    assert.strictEqual(inside(q), false, q);
  }
  for (const q of ['in my trading bot chats, what lot size was I using, and what is the gold price today?', 'ما قلته في محادثاتي عن الذهب، وما سعر الذهب اليوم؟']) {
    assert.strictEqual(inside(q), true, `mixed: ${q}`);
    assert.strictEqual(f.needsFreshInfo(q, { cutoffYear: 2023 }).needed, false, 'without includePersonal, own-chat questions are never "fresh"');
  }
});

test('everyday and programming uses of "current", "stock", "population"… are not current-information questions', () => {
  for (const q of [
    'how do I get the current working directory in python?', 'what is electric current?', 'explain the population standard deviation formula',
    'how to stock a pantry', 'filter rows where year = 2025 in pandas', 'how do I release a mutex lock?', 'what is a z-score?',
    'explain price elasticity of demand', 'implement long polling in node', 'show the most recently used files list in `ls`'
  ]) assert(!needs(q), q);
  // …while the real ones still are
  for (const q of ['what is the population of Egypt?', 'Apple stock price', 'when was the iPhone 17 released?', 'live scores of the match',
    'what is the latest version of pandas?', 'is python 3.8 still supported?']) assert(needs(q), q);
});

test('questions about the world that mention "last time", "my … memory", "my … history" are not about your chats', () => {
  for (const q of ['When was the last time Egypt qualified for the World Cup?', 'how much is my GPU memory bandwidth on an RTX 4090',
    'my family history of diabetes: what are the risks?', 'آخر مرة فازت مصر بكأس أفريقيا', 'تحدثت الصحف عن الانتخابات']) {
    assert(!f.isPersonalMemoryQuestion(q), q);
  }
  for (const q of ['last time we talked about docker, what did you suggest?', 'what is in your memory about me?', 'show my chat history about taxes',
    'آخر مرة سألتك عن بايثون', 'what are my memories about the trip?']) {
    assert(f.isPersonalMemoryQuestion(q), q);
  }
});

test('a dated answer ("As of December 2023, …") counts as already saying so; "offline mode" does not', () => {
  assert(f.hasTrainingDisclaimer('As of December 2023, the CEO is X.'));
  assert(f.hasTrainingDisclaimer('This is as of late 2023.'));
  assert(!f.hasTrainingDisclaimer('The app has an offline mode that syncs later.'));
  assert(f.hasTrainingDisclaimer("I'm offline right now, so I can't check."));
});

done();
