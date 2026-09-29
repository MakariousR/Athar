const path = require('path');
const assert = require('assert');
const { test, done, ROOT } = require('./helpers');
const g = require(path.join(ROOT, 'src/main/ollama/grounding'));

const RESEARCH = `--- [1] أفضل موقع عربي للتعلم الذاتي (harmash.com) ---
URL: https://harmash.com/
- مسارات دورات كورسات مشاريع كتب مقالات Programming Basics SQL HTML CSS JavaScript Python أفضل موقع عربي للتعلم الذاتي
--- [2] 7 Best Free Arabic Coding Platforms for Beginners in 2026 ---
Harmash has the most comprehensive free Python content in Arabic covering basics through intermediate concepts.`;
const ASKED = 'hi, which is better harmash or w3schools and which of them offers arabic content';

test('the answer is split into statements; code, headings and "the results don\'t say" are left out', () => {
  const s = g.answerStatements(`## Comparison
Harmash is an Arabic site for learning programming. W3Schools has tutorials in Arabic.
As for Arabic content:
\`\`\`js
console.log('W3Schools has content in Arabic too');
\`\`\`
- The results don't mention any Arabic content on W3Schools.
ok.`);
  assert.deepStrictEqual(s, ['Harmash is an Arabic site for learning programming.', 'W3Schools has tutorials in Arabic.']);
});

test('the checker\'s reply: quotes (with or without a translation after them), NONE, ADVICE', () => {
  const e = g.parseEvidence('1. "أفضل موقع عربي للتعلم الذاتي" (The best Arabic site for self-learning)\n2. NONE\n**3.** ADVICE\n4. Harmash has the most comprehensive free Python content');
  assert.deepStrictEqual(e.get(1), { kind: 'quote', quote: 'أفضل موقع عربي للتعلم الذاتي' });
  assert.deepStrictEqual(e.get(2), { kind: 'none' });
  assert.deepStrictEqual(e.get(3), { kind: 'advice' });
  assert.strictEqual(e.get(4).quote, 'Harmash has the most comprehensive free Python content');
});

test('a quote must really be in the results', () => {
  assert(g.quoteInResearch('أفضل موقع عربي للتعلم الذاتي', RESEARCH));
  assert(g.quoteInResearch('harmash has the most comprehensive free Python content', RESEARCH), 'case');
  assert(g.quoteInResearch('Harmash has the most comprehensive free Python content in Arabic, covering basics', RESEARCH), 'punctuation, near-exact');
  assert(!g.quoteInResearch('W3Schools offers tutorials in Arabic', RESEARCH), 'made up');
  assert(!g.quoteInResearch('Arabic', RESEARCH), 'one word proves nothing');
});

test('flagged: statements about what was asked with no real proof; not advice or general explanation', () => {
  const statements = [
    'Harmash is an Arabic site for learning programming.',
    'W3Schools has some resources available in Arabic, including tutorials.',
    'Harmash has limited Arabic content, primarily focusing on English resources.',
    'Practising every day is the fastest way to learn to code.',
    'Choose the one that suits your learning style best.'
  ];
  const evidence = g.parseEvidence('1. "أفضل موقع عربي للتعلم الذاتي"\n2. NONE\n3. "Harmash focuses on English resources"\n4. NONE\n5. ADVICE');
  assert.deepStrictEqual(g.unsupportedStatements(statements, evidence, RESEARCH, ASKED), [statements[1], statements[2]]);
  // no line for a statement: not judged
  assert.deepStrictEqual(g.unsupportedStatements(statements, g.parseEvidence('1. NONE'), RESEARCH, ASKED), [statements[0]]);
});

test('a quote\'s words must be close together, not scattered over the whole research', () => {
  const research = `Gold was mentioned in paragraph one. ${'filler words about other topics here. '.repeat(40)}` +
    `The price of silver rose. ${'more unrelated filler text follows. '.repeat(40)} Cairo markets opened late.`;
  assert(!g.quoteInResearch('the price of gold in Cairo markets', research), 'words from different places');
  assert(g.quoteInResearch('the price of silver rose', research));
  assert(g.quoteInResearch('The price of silver has rose', research), 'near-exact');
});

test('the checker sees the research that matches each statement, even from the last sources', () => {
  const sources = [];
  for (let i = 1; i <= 7; i++) {
    sources.push(`--- [${i}] Source ${i} (site${i}.com) ---\nURL: https://site${i}.com/\n` +
      `${`General filler paragraph number ${i} about nothing in particular at all. `.repeat(20)}\n\n` +
      (i === 7 ? 'Harmash launched a new Arabic course on data science in 2026.' : `Other fact ${i} about unrelated things.`));
  }
  const research = sources.join('\n\n');
  assert(research.length > 7000);
  const statements = ['Harmash launched an Arabic data science course in 2026.'];
  const seen = g.researchForCheck(research, statements, 3000);
  assert(seen.length <= 3200, `too long: ${seen.length}`);
  assert(seen.includes('Harmash launched a new Arabic course'), 'the 7th source\'s fact is shown');
  assert(seen.includes('--- [7] Source 7'), 'with its source header');
  assert(g.evidencePrompt(statements, research, 3000).includes('Harmash launched a new Arabic course'));
  assert.strictEqual(g.researchForCheck('short', statements, 3000), 'short');
});

test('the prompt numbers the statements and asks for exact words', () => {
  const p = g.evidencePrompt(['A is B.', 'C is D.'], RESEARCH);
  assert(/1\. A is B\.\n2\. C is D\./.test(p) && /copy the exact words/.test(p) && /N\. NONE/.test(p));
});

done();
