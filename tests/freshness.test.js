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
const decide = (text, searchOn, extra = {}) => f.shouldSearchFirst(text, {
  fresh: f.needsFreshInfo(text, { cutoffYear: 2023, ...extra }), searchOn, ...extra
});

test('Search off: nothing is searched, not even questions that need current information', () => {
  for (const q of ['what is the latest version of Node.js?', 'what is the price of gold today?', 'write a python function that reverses a linked list', 'explain recursion', 'make it shorter']) {
    assert.strictEqual(decide(q, false).search, false, q);
  }
});

test('Search off: current-information questions get the "turn on Search" note, in the user\'s language', () => {
  const en = f.offlineNote({ why: 'disabled', cutoffLabel: 'late 2023' });
  assert(/web search is off/.test(en) && /Search/.test(en) && /late 2023/.test(en), en);
  const ar = f.offlineNote({ why: 'disabled', cutoffLabel: 'late 2023', arabic: true });
  assert(/البحث في الإنترنت متوقف/.test(ar) && /Search/.test(ar), ar);
  assert(/turned OFF/.test(f.offlineInstruction({ why: 'disabled', cutoffLabel: 'late 2023' })));
});

test('Search on: only time-sensitive questions that nothing local covers are searched BEFORE answering', () => {
  assert.deepStrictEqual(decide('what is the latest version of Node.js?', true), { search: true, reason: 'fresh' });
  assert.deepStrictEqual(decide('ok, and what is the latest version of Python?', true), { search: true, reason: 'fresh' });
  // everything else is answered first from what's local, then checked (needsWebAfterAnswer)
  for (const q of ['write a python function that reverses a linked list', 'explain recursion', 'ما هي عاصمة أستراليا؟']) {
    assert.strictEqual(decide(q, true).search, false, q);
  }
  // something local may already answer it (memory excerpts, a linked page): answer first, then check
  assert.strictEqual(decide('what is the latest version of Node.js?', true, { hasLocalContext: true }).search, false);
});

test('never searched first: small talk, questions about your own chats or memory, attached files, the project folder', () => {
  for (const q of ['hi', 'Thanks a lot!', 'ok', 'thank you so much', 'شكرا جزيلا', 'صباح الخير', '']) {
    assert.strictEqual(decide(q, true).search, false, `small talk: "${q}"`);
  }
  for (const q of ['summarize my chat about the bakery database', 'ماذا قلنا في محادثاتي عن التداول؟', 'what did we decide last time?',
    'what were my recent conversations in the memory?', 'tell me about my latest chats', 'ما هي آخر محادثاتي في الذاكرة؟']) {
    assert(f.isPersonalMemoryQuestion(q), `recognised as about your own history: ${q}`);
    assert.strictEqual(decide(q, true).search, false, `own chats: ${q}`);
  }
  assert.strictEqual(decide('what are the latest risks?', true, { hasDocuments: true }).search, false, 'attached file');
  assert.strictEqual(decide('what is the latest router config?', true, { isProjectQuestion: true }).search, false, 'project folder');
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

test('placeholders instead of facts ("[gold_price]") are caught; citations, links, lists and code are not', () => {
  for (const t of ['the gold price is [gold_price] USD', 'as of [current date]', 'سعر الذهب اليوم هو [السعر] دولار']) assert(f.hasPlaceholder(t), t);
  for (const t of ['see [M1] and [M2, M3]', '[the docs](https://x.y)', 'a list [1, 2, 3]', '```js\nconst d = rows[date];\n```', 'use `prices[date]` here']) {
    assert(!f.hasPlaceholder(t), t);
  }
});

test('an explicit request to search the web is recognised (English and Arabic)…', () => {
  for (const q of ['search the web for the latest iPhone price', 'Search for the best laptops in 2026', 'look it up', 'can you google the population of Egypt?',
    'check online who won the match', 'what is the weather in Cairo? search it online', 'ابحث عن سعر الذهب اليوم', 'ابحث في الانترنت عن أفضل هاتف', 'دور على أخبار مصر', 'هات لي المعلومة من الإنترنت']) {
    assert(f.asksForWebSearch(q), q);
  }
});

test('…including the short ways it is said in the middle of a chat', () => {
  for (const q of ['ok search it', 'no, search again', 'I told you to search', 'I asked you to look it up', 'please search for that', 'use the internet',
    'yes search first', 'do a web search', 'so can you search about them?', 'طيب ابحث عنها', 'استخدم الانترنت', 'دور عليه']) {
    assert(f.asksForWebSearch(q), q);
  }
});

test('…but not searching your own chats, or "search" as a topic', () => {
  for (const q of ['search my chats for the database decision', 'find my conversation about docker', 'ابحث في محادثاتي عن التداول',
    'explain binary search', 'write a search function in python', 'how do I search in vim?', 'what is the capital of Australia?']) {
    assert(!f.asksForWebSearch(q), q);
  }
});

test('the search is for the subject, not the command words', () => {
  assert.strictEqual(f.stripSearchCommand('search the web for the latest iPhone price'), 'the latest iPhone price');
  assert.strictEqual(f.stripSearchCommand('can you google the population of Egypt?'), 'the population of Egypt?');
  assert.strictEqual(f.stripSearchCommand('what is the weather in Cairo? search it online'), 'what is the weather in Cairo?');
  assert.strictEqual(f.stripSearchCommand('ابحث عن سعر الذهب اليوم'), 'سعر الذهب اليوم');
  assert.strictEqual(f.stripSearchCommand('ابحث في الانترنت عن أفضل هاتف'), 'أفضل هاتف');
  assert.strictEqual(f.stripSearchCommand('look it up'), 'look it up', 'kept: "it" is resolved from the conversation');
});

test('the checker\'s verdict: NO, or SEARCH with the query to look up', () => {
  assert.deepStrictEqual(f.parseWebVerdict('NO'), { search: false, query: null });
  assert.deepStrictEqual(f.parseWebVerdict('no, the answer is based on the context'), { search: false, query: null });
  assert.deepStrictEqual(f.parseWebVerdict('SEARCH: current CEO of OpenAI'), { search: true, query: 'current CEO of OpenAI' });
  assert.deepStrictEqual(f.parseWebVerdict('**SEARCH**: "population of Egypt 2026"\nbecause…'), { search: true, query: 'population of Egypt 2026' });
  assert.deepStrictEqual(f.parseWebVerdict('SEARCH: من يملك MystiEgypt'), { search: true, query: 'من يملك MystiEgypt' });
  assert.deepStrictEqual(f.parseWebVerdict(''), { search: false, query: null });
});

done();
