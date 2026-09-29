const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, stubElectron, tempDir, ROOT } = require('./helpers');

stubElectron();
const client = require(path.join(ROOT, 'src/main/ollama/ollama-client'));
const agentLoop = require(path.join(ROOT, 'src/main/ollama/agent-loop'));
const { executeTool, createTurnState } = client._internals;

const ws = tempDir('cm-ws-');
const bigLines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1} ${'x'.repeat(20)}`);
fs.writeFileSync(path.join(ws, 'big.txt'), bigLines.join('\n'));
fs.writeFileSync(path.join(ws, 'small.txt'), 'a\nb\nc');

const approve = async () => true;
const exec = (turn, name, args, perm = approve) => executeTool(name, args, () => {}, ws, perm, null, null, null, turn);

test('read_file caps output and gives a continuation hint', async () => {
  const out = await exec(createTurnState(''), 'read_file', { rel_path: 'big.txt' });
  assert(out.length < 20000, `output too long: ${out.length}`);
  assert(/lines 1-\d+ of 3000/.test(out), out.slice(0, 120));
  assert(/start_line=\d+/.test(out));
});

test('read_file start_line paging reaches the end', async () => {
  let start = 1;
  let out = '';
  for (let i = 0; i < 20; i++) {
    out = await exec(createTurnState(''), 'read_file', { rel_path: 'big.txt', start_line: start });
    const m = out.match(/start_line=(\d+)/);
    if (!m) break;
    start = Number(m[1]);
  }
  assert(/line 3000 x/.test(out));
  assert(/End of file/.test(out));
});

test('read_file refuses paths outside the project folder', async () => {
  const out = await exec(createTurnState(''), 'read_file', { rel_path: '../../etc/passwd' });
  assert(/Access denied/.test(out), out);
});

test('file-changing tools no longer exist', async () => {
  for (const name of ['write_file', 'edit_file', 'delete_file', 'git_add', 'git_commit', 'git_checkout', 'git_branch']) {
    const out = await exec(createTurnState(''), name, { rel_path: 'small.txt', content: 'x' });
    assert(/Unknown tool/.test(out), `${name}: ${out}`);
  }
  assert.strictEqual(fs.readFileSync(path.join(ws, 'small.txt'), 'utf8'), 'a\nb\nc');
});

test('tool set offered to the model is read-only', () => {
  const tools = agentLoop.buildToolSet({ executeTool: async () => '', onStatus() {}, workspaceDir: ws });
  assert.deepStrictEqual(Object.keys(tools).sort(), [
    'fetch_web_page', 'get_current_time', 'git_diff', 'git_log', 'git_status', 'list_chat_resources',
    'list_directory', 'read_chat_resource', 'read_file', 'search_files', 'search_memory', 'web_search'
  ]);
  const noFolder = agentLoop.buildToolSet({ executeTool: async () => '', onStatus() {}, workspaceDir: null });
  assert(!('read_file' in noFolder));
});

test('fetch_web_page on an unknown URL asks permission; denial blocks', async () => {
  let asked = null;
  const out = await exec(createTurnState('hello'), 'fetch_web_page', { url: 'https://example.com/?secret=1' }, async (req) => { asked = req; return false; });
  assert(asked && asked.toolName === 'fetch_web_page');
  assert(/DENIED/.test(out), out);
});

test('fetch_web_page on a URL from the user message does not ask (SSRF guard still applies)', async () => {
  let asked = false;
  const turn = createTurnState('please read https://127.0.0.1:11434/api/tags');
  const out = await exec(turn, 'fetch_web_page', { url: 'https://127.0.0.1:11434/api/tags' }, async () => { asked = true; return true; });
  assert(!asked);
  assert(/ERROR: .*(Local network|private)/i.test(out), out);
});

test('with Search off, the web tools refuse without going online', async () => {
  const turn = createTurnState('what happened in the news today? https://example.com');
  turn.webAllowed = false;
  let asked = false;
  for (const [name, args] of [['web_search', { query: 'news today' }], ['fetch_web_page', { url: 'https://example.com' }]]) {
    const out = await exec(turn, name, args, async () => { asked = true; return true; });
    assert(/turned OFF by the user/.test(out) && /Search/.test(out), out);
  }
  assert(!asked, 'no permission prompt either');
  assert.strictEqual(turn.webBlocked, true, 'remembered, so the answer can say Search is off');
});

test('web search follow-ups: messages that refer back are recognised (English and Arabic)', () => {
  const { REFERS_BACK_RE } = client._internals;
  for (const q of ['who is the owner of this company or online platform?', 'how much does it cost?', 'what did they announce?',
    'من هو صاحب هذه الشركة؟', 'كم سعرها؟', 'ما هو الموقع الرسمي للشركة؟']) {
    assert(REFERS_BACK_RE.test(q), q);
  }
  for (const q of ['what is the capital of Australia?', 'latest version of Node.js', 'ما هي عاصمة أستراليا؟', 'history of the Ottoman empire']) {
    assert(!REFERS_BACK_RE.test(q), q);
  }
});

test('web search follow-ups: a self-contained question, or one with no earlier turns, is searched as it is (no model call)', async () => {
  const { standaloneWebQuery } = client._internals;
  const history = [{ role: 'user', text: 'tell me about MystiEgypt' }, { role: 'assistant', text: 'A travel company.' }];
  assert.strictEqual(await standaloneWebQuery('what is the capital of Australia?', history, 'none'), 'what is the capital of Australia?');
  // first message of a chat: nothing to refer back to
  assert.strictEqual(await standaloneWebQuery('who owns this company?', [{ role: 'user', text: 'who owns this company?' }], 'none'), 'who owns this company?');
});

test('printed tool-call JSON is recognised and can be stripped from prose', () => {
  const names = ['web_search', 'read_file'];
  const text = 'Let me check.\n{"name": "web_search", "arguments": {"query": "x"}}\nDone.';
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

test('research is usable by how it starts: a query containing "timed out" is fine; "no results" is not', () => {
  const { isUsableResearch } = client._internals;
  const ok = `=== WEB RESEARCH RESULTS FOR: "why does my nginx request get timed out" ===\n${'x'.repeat(300)}`;
  assert(isUsableResearch(ok));
  assert(!isUsableResearch('Web search for "x" returned no results. Try a shorter or differently worded query.'));
  assert(!isUsableResearch(`Web research for "x" timed out. ${'x'.repeat(300)}`));
});

test('failed searches and unreadable pages do not count as research', () => {
  const web = require(path.join(ROOT, 'src/main/tools/web-search'));
  for (const t of ['Could not extract content from: https://example.com/some/long/path', 'Web search for "x" returned no results.', 'Fetching https://x.com timed out.']) {
    assert(!web.isSearchResult(t) && !web.isPageResult(t), t);
  }
});

test('Stop cancels a web search right away', async () => {
  const web = require(path.join(ROOT, 'src/main/tools/web-search'));
  const ctrl = new AbortController();
  ctrl.abort();
  const started = Date.now();
  const out = await web.searchWebTool('some uncached query 12345', () => {}, { signal: ctrl.signal });
  assert(/cancelled/i.test(out), out);
  assert(Date.now() - started < 1000);
});

test('project-question detection is narrow', () => {
  const q = client.PROJECT_QUESTION;
  assert(q.test('what does this project do?'));
  assert(q.test('explain src/main/index.js'));
  assert(!q.test('explain quantum physics'));
  assert(!q.test('show me a list of good books'));
});

done();
