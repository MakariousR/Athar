// Attached files: follow-up questions must see the relevant part of the file,
// even when they don't name it and weren't asked about when it was attached.
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, fakeEmbed, ROOT } = require('./helpers');

stubElectron();
const store = require(path.join(ROOT, 'src/main/store/chat-store'));
const rt = require(path.join(ROOT, 'src/main/tools/resource-tools'));
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));
const { parseTextContent } = require(path.join(ROOT, 'src/main/parser/document-parser'));
const doc = require('./fixtures/report-document');
const { buildResourcePreRead } = client._internals;

// Offline: use the deterministic stand-in instead of Ollama
rt.setEmbedder(async (t) => (await fakeEmbed([t]))[0], 'fake');
let batchCalls = 0;
rt.setBatchEmbedder(async (texts) => { batchCalls++; return fakeEmbed(texts); });

function chatWithReport() {
  const s = store.createSession();
  const { resource } = store.addSessionResource(s.id, parseTextContent(doc.name, doc.text));
  return { session: s, resource };
}

test('upload-time indexing embeds in batches and is reused afterwards', async () => {
  const { session, resource } = chatWithReport();
  batchCalls = 0;
  await rt.indexResource(session.id, resource);
  const afterIndex = batchCalls;
  assert(afterIndex >= 1);
  await rt.findRelevantPassages(session.id, [resource], 'flour price risk');
  assert.strictEqual(batchCalls, afterIndex + 1, 'only the question is embedded, not the file again');
});

test('finds the part of the file a question is about', async () => {
  const { session, resource } = chatWithReport();
  const r = await rt.findRelevantPassages(session.id, [resource], 'how many drivers and warehouse staff will be hired');
  assert(r.count > 0);
  assert(/eleven people in 2026: four drivers/.test(r.text), r.text.slice(0, 300));
  assert(/^--- "northwind-annual-report-2025\.md", page \d+/m.test(r.text), 'passages say where they come from');
});

test('unrelated questions get no passages', async () => {
  const { session, resource } = chatWithReport();
  for (const q of ['what is 17 times 23', 'write a poem about the sea', 'capital of Australia']) {
    const r = await rt.findRelevantPassages(session.id, [resource], q);
    assert.strictEqual(r.count, 0, `${q} → ${r.text.slice(0, 120)}`);
  }
});

test('message 1 (file attached): overview of the file', async () => {
  const { session, resource } = chatWithReport();
  const pre = await buildResourcePreRead(session.id, 'What is the IT budget?', [resource], { history: [] });
  assert(/northwind-annual-report-2025\.md/.test(pre));
  assert(/280,000 euros/.test(pre), 'the budget section is shown');
});

test('follow-up about a DIFFERENT part, without naming the file: relevant passages are added', async () => {
  const { session, resource } = chatWithReport();
  const history = [
    { role: 'user', text: 'What is the IT budget?', documents: [resource] },
    { role: 'assistant', text: 'The IT budget is 280,000 euros.' },
    { role: 'user', text: 'When is two-factor authentication mandatory for staff?' }
  ];
  const pre = await buildResourcePreRead(session.id, 'When is two-factor authentication mandatory for staff?', [], { history });
  assert(/Passages that match this message/.test(pre), pre.slice(0, 300));
  assert(/Two-factor authentication will be mandatory for all staff by February 2026/.test(pre));
});

test('short follow-up is searched together with the previous question', async () => {
  const { session } = chatWithReport();
  const history = [
    { role: 'user', text: 'What happened to monthly customer churn?' }, // (stand-in embedder matches exact words)
    { role: 'assistant', text: 'It fell.' },
    { role: 'user', text: 'and why?' }
  ];
  const pre = await buildResourcePreRead(session.id, 'and why?', [], { history });
  assert(/account managers/.test(pre), 'the churn section explains why');
});

test('"summarise the report" without naming it shows the file overview', async () => {
  const { session } = chatWithReport();
  const pre = await buildResourcePreRead(session.id, 'Can you summarise the report?', [], { history: [] });
  assert(/northwind-annual-report-2025\.md/.test(pre) && /Executive summary/.test(pre), pre.slice(0, 200));
});

test('unrelated question in a chat with a file adds nothing', async () => {
  const { session } = chatWithReport();
  assert.strictEqual(await buildResourcePreRead(session.id, 'What is 17 times 23?', [], { history: [] }), '');
});

test('tool-less models are told to say so instead of calling tools', async () => {
  const { session, resource } = chatWithReport();
  const withTools = await buildResourcePreRead(session.id, 'budget?', [resource], { toolsAvailable: true });
  const noTools = await buildResourcePreRead(session.id, 'budget?', [resource], { toolsAvailable: false });
  assert(/read_chat_resource/.test(withTools));
  assert(!/read_chat_resource/.test(noTools) && /don't guess/.test(noTools));
});

done();
