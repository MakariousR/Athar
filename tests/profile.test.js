const path = require('path');
const assert = require('assert');
const { test, done, tempDir, ROOT } = require('./helpers');
const { buildProfile, toChatGptInstructions, profileContext, ProfileStore, _internals } = require(path.join(ROOT, 'src/main/memory/profile'));
const { normalizeThread } = require(path.join(ROOT, 'src/main/memory/memory-index'));
const corpus = require('./fixtures/memory-corpus').map((t) => normalizeThread(t, t.source));

const { parseFacts, mergeFacts, assembleProfile, collectMaterial, detectLanguage, isGrounded } = _internals;

test('fact parsing tolerates the ways small models format lines', () => {
  const facts = parseFacts([
    'Here are the facts:',
    'ABOUT: Works as a backend developer.',
    '- PROJECT: Building an order system for a bakery',
    '**TECH**: Uses Postgres and React',
    '3. Preferences - Likes short answers with code',
    'GOALS: Wants to learn Kubernetes',
    'TOOLS: Docker compose',
    'RANDOM: ignore me',
    'PROJECT: none'
  ].join('\n'));
  assert.deepStrictEqual(facts.map((f) => f.tag), ['ABOUT', 'PROJECT', 'TECH', 'PREFERENCE', 'GOAL', 'TECH']);
  assert.strictEqual(facts[0].text, 'Works as a backend developer');
});

test('near-duplicate facts merge and count their support', () => {
  const merged = mergeFacts([
    { tag: 'TECH', text: 'Uses Postgres for databases', time: 1 },
    { tag: 'TECH', text: 'Uses Postgres databases', time: 3 },
    { tag: 'TECH', text: 'Uses React', time: 2 },
    { tag: 'GOAL', text: 'Learning Kubernetes networking', time: 2 }
  ]);
  const pg = merged.find((f) => /Postgres/.test(f.text));
  assert.strictEqual(pg.count, 2);
  assert.strictEqual(pg.text, 'Uses Postgres databases', 'keeps the most recent wording');
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0], pg, 'best-supported first');
});

test('the same fact under two headings is kept once, under the more specific one', () => {
  const merged = mergeFacts([
    { tag: 'ABOUT', text: 'Building a bakery order system', time: 2 },
    { tag: 'PROJECT', text: 'Building a bakery order system', time: 1 }
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].tag, 'PROJECT');
  assert.strictEqual(merged[0].count, 2);
});

test('material comes from the user\'s own messages, newest conversations first', () => {
  const material = collectMaterial(corpus, 5);
  assert.strictEqual(material.length, 5);
  assert(material[0].time >= material[4].time);
  assert(!material.some((c) => /Zustand with selectors/.test(c.text)), 'assistant replies are not included');
});

test('profile language follows the user\'s writing', () => {
  assert.strictEqual(detectLanguage([{ text: 'I am building an app' }]), 'English');
  assert.strictEqual(detectLanguage([{ text: 'أريد أن أتعلم البرمجة بلغة بايثون من الصفر' }]), 'Arabic');
});

test('grounding check: keeps supported facts, drops invented ones', () => {
  const en = 'As a freelancer, how much of my income should I set aside for taxes? Plan a trip to Japan. Please keep answers short and show a code example first.';
  const ar = 'أريد أن أتعلم البرمجة بلغة بايثون من الصفر';
  assert(isGrounded({ tag: 'ABOUT', text: 'Freelancer' }, en));
  assert(isGrounded({ tag: 'GOAL', text: 'Plan a trip to Japan' }, en));
  assert(isGrounded({ tag: 'PREFERENCE', text: 'Short answers with code examples' }, en));
  assert(!isGrounded({ tag: 'ABOUT', text: 'Lives in Berlin and works at Google' }, en), 'invented specifics');
  assert(!isGrounded({ tag: 'PREFERENCE', text: 'Wants detailed answers' }, ar), 'style never requested');
  assert(!isGrounded({ tag: 'ABOUT', text: 'يدرس البرمجة في مصر' }, ar), 'Egypt never mentioned');
  assert(isGrounded({ tag: 'GOAL', text: 'يتعلم البرمجة بلغة بايثون' }, ar));
  assert(!isGrounded({ tag: 'GOAL', text: 'لا يوجد مشروع محدد مذكور' }, ar), 'filler');
});

test('builds a profile end-to-end from grounded facts only', async () => {
  const prompts = [];
  const complete = async (prompt) => {
    prompts.push(prompt);
    return [
      'ABOUT: Considering a backend developer role',   // supported (salary conversation)
      'PROJECT: Building an order system for a bakery', // supported
      'TECH: Uses Postgres and React',                  // supported
      'PREFERENCE: Likes very detailed answers',        // guessed — no style request in the messages
      'ABOUT: Lives in Berlin and works at Google',     // invented
      'GOAL: No specific goal mentioned'                // filler
    ].join('\n');
  };
  const progress = [];
  const result = await buildProfile({ threads: corpus, complete, maxConversations: 50, onProgress: (p) => progress.push(p) });
  assert(/^## About me\n- Considering a backend developer role/m.test(result.markdown), result.markdown);
  assert(/## Projects\n- Building an order system for a bakery/.test(result.markdown));
  assert(/Postgres and React/.test(result.markdown));
  assert(!/Berlin|detailed answers|No specific goal|How I like answers/.test(result.markdown), result.markdown);
  assert.strictEqual(result.language, 'English');
  assert(prompts.every((p) => /Write the facts in English/.test(p)));
  assert.strictEqual(progress[progress.length - 1].done, prompts.length, 'one model call per batch, nothing else');
  assert(!prompts[0].includes('Zustand with selectors'), 'only user messages are sent for extraction');
});

test('Arabic profiles get Arabic headings', () => {
  const md = assembleProfile([{ tag: 'ABOUT', text: 'يتعلم البرمجة', count: 1, time: 1 }], 'Arabic');
  assert(md.startsWith('## عنّي'), md);
});

test('a failed extraction batch does not sink the profile; cancel stops it', async () => {
  // enough history for several extraction batches, so one failed batch leaves others
  const many = Array.from({ length: 40 }, (_, i) => normalizeThread({
    id: `t${i}`, title: `Chat ${i}`, source: 'chatgpt', createTime: 1700000000 + i * 1000,
    messages: [{ role: 'user', text: `Message ${i}: ${'I bake sourdough bread at home every weekend. '.repeat(8)}` }, { role: 'assistant', text: 'ok' }]
  }, 'chatgpt'));
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    return 'GOAL: Bakes sourdough bread at home every weekend';
  };
  const ok = await buildProfile({ threads: many, complete: flaky, maxConversations: 200 });
  assert(calls > 2);
  assert(/sourdough/i.test(ok.markdown), ok.markdown);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildProfile({ threads: many, complete: flaky, signal: controller.signal }), /Cancelled/);
});

test('no usable facts gives a clear error instead of an empty profile', async () => {
  await assert.rejects(buildProfile({ threads: corpus, complete: async () => 'ABOUT: Lives on the Moon' }), /Could not find lasting facts/);
});

test('ChatGPT export: two fields, each within 1,500 characters, bullets never cut', () => {
  const many = Array.from({ length: 80 }, (_, i) => `- Fact number ${i} about the user and their work`).join('\n');
  const md = `## About me\n${many}\n\n## How I like answers\n- Short answers\n- Code examples first`;
  const { aboutYou, howToRespond } = toChatGptInstructions(md);
  assert(aboutYou.length <= 1500 && aboutYou.length > 1000, `aboutYou ${aboutYou.length}`);
  assert(aboutYou.split('\n').every((l) => l === 'About me:' || /^- Fact number \d+ about the user and their work$/.test(l)));
  assert.strictEqual(howToRespond, '- Short answers\n- Code examples first');
  assert(!aboutYou.includes('Short answers'));
});

test('profile store persists; context block is bounded', () => {
  const store = new ProfileStore(tempDir('cm-profile-'));
  assert.strictEqual(store.get().markdown, '');
  store.save({ markdown: '## About me\n- x', enabled: true });
  assert.strictEqual(store.get().enabled, true);
  const ctx = profileContext('x'.repeat(10000));
  assert(ctx.length < 3400 && ctx.startsWith('<user_profile>'));
  assert.strictEqual(profileContext(''), '');
});

done();
