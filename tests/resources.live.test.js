// Needs Ollama running with bge-m3. Run with: npm run test:live
// Real-model checks of the automatic file-passage search used on every message:
// follow-up questions (paraphrased, Arabic) find the right section of an
// attached file; unrelated questions find nothing.
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, ROOT } = require('./helpers');

stubElectron();
const store = require(path.join(ROOT, 'src/main/store/chat-store'));
const rt = require(path.join(ROOT, 'src/main/tools/resource-tools'));
const ollama = require(path.join(ROOT, 'src/main/ollama/ollama-client')); // registers the bge-m3 embedders
const { parseTextContent } = require(path.join(ROOT, 'src/main/parser/document-parser'));
const doc = require('./fixtures/report-document');

const session = store.createSession();
const { resource } = store.addSessionResource(session.id, parseTextContent(doc.name, doc.text));

const related = [
  ['what are the main risks?', /price of flour/],
  ['how much is the IT budget', /IT budget is 280,000/],
  ['who is the finance director', /Hugo Bernard/],
  ['how many drivers will they hire', /four drivers/],
  ['when does the mobile app launch', /mobile app for repeat orders launches in May/],
  ['is there two-factor login', /Two-factor authentication/],
  ['are they doing anything for the environment', /recycled cardboard|electric/],
  ['ما هي المخاطر الرئيسية؟', /price of flour/]
];
for (const [q, expected] of related) {
  test(`related: "${q}"`, async () => {
    const r = await rt.findRelevantPassages(session.id, [resource], q);
    assert(r.count > 0, 'no passages');
    assert(expected.test(r.text), r.text.slice(0, 300));
  });
}

for (const q of ['what is 17 times 23', 'write a poem about the sea', 'what is the capital of Australia', 'latest version of Node.js', 'explain recursion in python']) {
  test(`unrelated: "${q}" → nothing`, async () => {
    const r = await rt.findRelevantPassages(session.id, [resource], q);
    assert.strictEqual(r.count, 0, r.text.slice(0, 200));
  });
}

void ollama;
done();
