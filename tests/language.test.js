// Which language the answer must be in, and whether an answer is in it.
const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');
const { detectLanguage, requestedLanguage, replyLanguage, matchesLanguage, LANGUAGES } = require(path.join(ROOT, 'src/main/ollama/language'));

const code = (lang) => (lang ? lang.code : null);

test('detects the language of a message', () => {
  const cases = [
    ['what were my main chats with claude?', 'en'],
    ['ما هي عناوين محادثاتي مع كلود؟', 'ar'],
    ['كيف أصلح docker compose error في مشروعي', 'ar'],
    ['What did I discuss in my chat "خطة الحديقة"?', 'en'],
    ['write a python function that reverses a list', 'en'],
    ['make a plan for a trip to Cairo', 'en'],
    ['Escreva uma função que inverte uma lista', 'pt'],
    ['لخص محادثة "Using the Weather API"', 'ar'],
    ['Quels sont mes projets en cours ?', 'fr'],
    ['¿Cuál es la capital de Australia?', 'es'],
    ['Wie funktioniert das mit der Datenbank?', 'de'],
    ['Bu projede ne yapmam gerekiyor?', 'tr'],
    ['Как настроить сервер?', 'ru'],
    ['این پروژه چگونه کار می‌کند؟', 'fa'],
    ['这个项目怎么运行？', 'zh'],
    ['このプロジェクトはどう動きますか？', 'ja'],
    ['이 프로젝트는 어떻게 작동하나요?', 'ko']
  ];
  for (const [text, want] of cases) assert.strictEqual(code(detectLanguage(text)), want, text);
});

test('too little to tell → null (then earlier messages decide)', () => {
  for (const text of ['ok', '17 * 23', 'docker compose', '```js\nx()\n```']) assert.strictEqual(detectLanguage(text), null, text);
});

test('explicit requests: "answer in English", "ترجم إلى الفرنسية", "اشرح بالعربي"', () => {
  const cases = [
    ['اشرح لي هذا الكود وأجب بالإنجليزية', 'en'],
    ['ترجم هذه الفقرة إلى الفرنسية', 'fr'],
    ['explain docker volumes بالعربي', 'ar'],
    ['answer in Arabic please: what is recursion?', 'ar'],
    ['Translate my last message into Spanish', 'es'],
    ['in English please', 'en'],
    ['رد باللغة الألمانية', 'de']
  ];
  for (const [text, want] of cases) assert.strictEqual(code(requestedLanguage(text)), want, text);
  // Mentioning a language is not a request for the answer's language
  for (const text of ['what is "hello" in French?', 'I am learning Arabic', 'ما معنى كلمة شكرا بالإنجليزي؟ وكيف أنطقها']) {
    assert.strictEqual(requestedLanguage(text), null, text);
  }
});

test('replyLanguage: the request wins, then the message, then earlier messages', () => {
  const history = [{ role: 'user', text: 'ما هي مشاريعي الحالية؟' }, { role: 'assistant', text: '...' }];
  assert.strictEqual(code(replyLanguage('ok', history)), 'ar');
  assert.strictEqual(code(replyLanguage('why?', history)), 'ar');
  assert.strictEqual(code(replyLanguage('summarize my chats with claude', history)), 'en');
  assert.strictEqual(code(replyLanguage('لخص محادثاتي واكتب الملخص بالإنجليزية', [])), 'en');
  assert.strictEqual(replyLanguage('ok', []), null);
  // The history as the app passes it: already ending with the current message
  assert.strictEqual(code(replyLanguage('why?', [...history, { role: 'user', text: 'why?' }])), 'ar');
});

test('matchesLanguage: English terms and code inside an Arabic answer are fine', () => {
  const ar = LANGUAGES.ar;
  assert(matchesLanguage('لديك ثلاث محادثات مع Claude: "Using the Weather API" و "Garden planning notes" و "Bakery price list".', ar));
  assert(matchesLanguage('استخدم الأمر التالي:\n```bash\ndocker compose up -d --build\n```\nثم افتح المتصفح على العنوان المحلي.', ar));
  assert(!matchesLanguage('You have three conversations with Claude about the Weather API, garden planning notes and a bakery price list.', ar));
  assert(!matchesLanguage('لديك ثلاث محادثات مع كلود حول واجهة برمجة التطبيقات وتطبيق الذاكرة', LANGUAGES.en));
  assert(matchesLanguage('You have three conversations with Claude about the Weather API and garden notes.', LANGUAGES.en));
  assert(!matchesLanguage('Vous avez trois conversations avec Claude sur une application de mémoire et une API.', LANGUAGES.en));
  assert(matchesLanguage('42', ar), 'short answers pass');
  assert(!matchesLanguage('الصفحة تقدم معلومات عن الشركة. فيما يلي ملخص لل主要内容: رحلات مخصصة في مصر.', ar), 'a stray Chinese phrase');
  assert(!matchesLanguage('The page describes 主要内容 of the company and its tours in Egypt.', LANGUAGES.en));
});

done();
