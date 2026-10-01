const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, tempDir, ROOT } = require('./helpers');

stubElectron();
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));
const agentLoop = require(path.join(ROOT, 'src/main/ollama/agent-loop'));
const { executeTool } = client._internals;

const ws = tempDir('cm-ws-');
const bigLines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1} ${'x'.repeat(20)}`);
fs.writeFileSync(path.join(ws, 'big.txt'), bigLines.join('\n'));
fs.writeFileSync(path.join(ws, 'small.txt'), 'a\nb\nc');

const approve = async () => true;
const exec = (name, args, perm = approve) => executeTool(name, args, () => {}, ws, perm, null, null, null);

test('read_file caps output and gives a continuation hint', async () => {
  const out = await exec('read_file', { rel_path: 'big.txt' });
  assert(out.length < 20000, `output too long: ${out.length}`);
  assert(/lines 1-\d+ of 3000/.test(out), out.slice(0, 120));
  assert(/start_line=\d+/.test(out));
});

test('read_file start_line paging reaches the end', async () => {
  let start = 1;
  let out = '';
  for (let i = 0; i < 20; i++) {
    out = await exec('read_file', { rel_path: 'big.txt', start_line: start });
    const m = out.match(/start_line=(\d+)/);
    if (!m) break;
    start = Number(m[1]);
  }
  assert(/line 3000 x/.test(out));
  assert(/End of file/.test(out));
});

test('read_file refuses paths outside the project folder', async () => {
  const out = await exec('read_file', { rel_path: '../../etc/passwd' });
  assert(/Access denied/.test(out), out);
});

test('file-changing tools no longer exist', async () => {
  for (const name of ['write_file', 'edit_file', 'delete_file', 'git_add', 'git_commit', 'git_checkout', 'git_branch']) {
    const out = await exec(name, { rel_path: 'small.txt', content: 'x' });
    assert(/Unknown tool/.test(out), `${name}: ${out}`);
  }
  assert.strictEqual(fs.readFileSync(path.join(ws, 'small.txt'), 'utf8'), 'a\nb\nc');
});

test('the web tools no longer exist: Athar never goes online for an answer', async () => {
  for (const [name, args] of [['web_search', { query: 'news today' }], ['fetch_web_page', { url: 'https://example.com' }]]) {
    const out = await exec(name, args);
    assert(/Unknown tool/.test(out) && !/web_search|fetch_web_page/.test(out.replace(name, '')), `${name}: ${out}`);
  }
});

test('tool set offered to the model is read-only and has no web tools', () => {
  const tools = agentLoop.buildToolSet({ executeTool: async () => '', onStatus() {}, workspaceDir: ws });
  assert.deepStrictEqual(Object.keys(tools).sort(), [
    'get_current_time', 'git_diff', 'git_log', 'git_status', 'list_chat_resources',
    'list_directory', 'read_chat_resource', 'read_file', 'search_files', 'search_memory'
  ]);
  const noFolder = agentLoop.buildToolSet({ executeTool: async () => '', onStatus() {}, workspaceDir: null });
  assert(!('read_file' in noFolder));
});

test('printed tool-call JSON is recognised and can be stripped from prose', () => {
  const names = ['search_memory', 'read_file'];
  const text = 'Let me check.\n{"name": "search_memory", "arguments": {"query": "x"}}\nDone.';
  assert.strictEqual(agentLoop.tryParseFallbackToolCalls(text, names).length, 1);
  assert.strictEqual(agentLoop.stripToolCallJson(text, names), 'Let me check.\n\nDone.');
  assert.strictEqual(agentLoop.tryParseFallbackToolCalls('{"name": "write_file", "arguments": {}}', names).length, 0);
});

test('links in a message: parentheses inside the URL are kept, trailing punctuation is not', () => {
  const { extractUrls } = client._internals;
  assert.deepStrictEqual(extractUrls('read https://en.wikipedia.org/wiki/Mercury_(planet).'), ['https://en.wikipedia.org/wiki/Mercury_(planet)']);
  assert.deepStrictEqual(extractUrls('(see https://example.com/a)'), ['https://example.com/a']);
  assert.deepStrictEqual(extractUrls('links: https://a.com/x, https://b.com/y!'), ['https://a.com/x', 'https://b.com/y']);
});

test('the prompt says Athar can\'t go online, and has no web rules', () => {
  const { buildMessages } = client._internals;
  const msgs = buildMessages('hi', { cutoffLabel: 'late 2023', toolsAvailable: true }, [], [], null, [], null, '');
  const system = msgs.find((m) => m.role === 'system').content;
  assert(/cannot go online/.test(system) && /as of your training data/.test(system), system.slice(0, 400));
  assert(!/web_search|fetch_web_page|Search is on|SEARCH IS ON|web results/i.test(system));
});

test('project-question detection is narrow', () => {
  const q = client.PROJECT_QUESTION;
  assert(q.test('what does this project do?'));
  assert(q.test('explain src/main/index.js'));
  assert(!q.test('explain quantum physics'));
  assert(!q.test('show me a list of good books'));
});

done();
