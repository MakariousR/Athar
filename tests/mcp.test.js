// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PassThrough } = require('stream');
const { test, done, tempDir, fakeEmbed, ROOT } = require('./helpers');

const { createMcpServer } = require(path.join(ROOT, 'src/main/mcp/mcp-server'));
const { memoryTools, readOnlyMemory } = require(path.join(ROOT, 'src/main/mcp/memory-tools'));
const mcpConnect = require(path.join(ROOT, 'src/main/mcp/connect'));
const { MemoryIndex } = require(path.join(ROOT, 'src/main/memory/memory-index'));
const corpus = require('./fixtures/memory-corpus');

async function waitIdle(mem) {
  for (let i = 0; i < 200 && (mem.embedding || mem.countPending() > 0); i++) await new Promise((r) => setTimeout(r, 10));
}

/** A userData folder like the Athar window leaves it: imported history, indexed, plus one in-app chat. */
async function makeUserData(embedTexts = fakeEmbed) {
  const userData = tempDir('athar-mcp-');
  const mem = new MemoryIndex({ dir: path.join(userData, 'memory'), embedTexts, embedModel: 'fake' });
  for (const source of ['chatgpt', 'claude', 'gemini']) mem.importThreads(corpus.filter((t) => t.source === source), source);
  await waitIdle(mem);
  fs.mkdirSync(path.join(userData, 'chats'));
  fs.writeFileSync(path.join(userData, 'chats', 'sessions.json'), JSON.stringify([{
    id: 'app-1', title: 'Garden plan', createdAt: Date.parse('2026-09-01') / 1000,
    messages: [{ role: 'user', text: 'Which tomatoes grow well on a balcony?' }, { role: 'assistant', text: 'Cherry tomatoes in large pots.' }]
  }]));
  return userData;
}

function toolsFor(userData, opts = {}, embedTexts = fakeEmbed) {
  const getMemory = readOnlyMemory({ userData, embedTexts, embedModel: 'fake' });
  const tools = memoryTools({ getMemory, ...opts });
  return { call: (name, args) => tools.find((t) => t.name === name).run(args), tools, getMemory };
}

// ── The protocol ──
const echo = { name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, run: async (a) => { if (a.fail) throw new Error('it failed'); return `you said ${a.text}`; } };

test('initialize agrees on a protocol version and says the server only has tools', async () => {
  const server = createMcpServer({ info: { name: 'athar', version: '1.0.0' }, instructions: 'Use it.', tools: [echo] });
  const r = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
  assert.strictEqual(r.result.protocolVersion, '2025-06-18');
  assert.deepStrictEqual(Object.keys(r.result.capabilities), ['tools']);
  assert.strictEqual(r.result.serverInfo.name, 'athar');
  assert.strictEqual(r.result.instructions, 'Use it.');
  const future = await server.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
  assert.match(future.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/, 'an unknown version gets ours');
});

test('tools are listed as read-only; a call returns text; a failing tool is a readable error', async () => {
  const server = createMcpServer({ info: { name: 'a', version: '1' }, tools: [echo] });
  const list = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.strictEqual(list.result.tools[0].name, 'echo');
  assert.strictEqual(list.result.tools[0].annotations.readOnlyHint, true);
  assert(!('run' in list.result.tools[0]));
  const ok = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } });
  assert.deepStrictEqual(ok.result, { content: [{ type: 'text', text: 'you said hi' }] });
  const bad = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { fail: true } } });
  assert.strictEqual(bad.result.isError, true);
  assert.strictEqual(bad.result.content[0].text, 'it failed');
  const unknown = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } });
  assert.strictEqual(unknown.error.code, -32602);
});

test('notifications get no reply; unknown methods and bad messages get errors', async () => {
  const server = createMcpServer({ info: { name: 'a', version: '1' }, tools: [echo] });
  assert.strictEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.strictEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }), null);
  assert.strictEqual((await server.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).error.code, -32601);
  assert.deepStrictEqual(await server.handle({ jsonrpc: '2.0', id: 6, method: 'ping' }), { jsonrpc: '2.0', id: 6, result: {} });
  assert.strictEqual((await server.handle({ id: 7, method: 'ping' })).error.code, -32600);
});

test('over a pipe: one JSON message per line; a blank or broken line doesn\'t stop it', async () => {
  const server = createMcpServer({ info: { name: 'a', version: '1' }, tools: [echo] });
  const input = new PassThrough();
  let out = '';
  const finished = server.serve(input, { write: (s) => { out += s; } });
  input.write('\r\n');
  input.write('{not json\n');
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'مرحبا\nthere' } } })}\r\n`);
  input.end();
  await finished;
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].error.code, -32700);
  assert.strictEqual(lines[1].result.content[0].text, 'you said مرحبا\nthere', 'newlines inside a message stay escaped');
});

// ── The memory tools ──
test('search_memory finds past chats with their ids, and filters by source', async () => {
  const { call } = toolsFor(await makeUserData());
  const text = await call('search_memory', { query: 'docker compose error' });
  assert.match(text, /^\[1\] ChatGPT · "Docker compose error" · \d{4}-\d{2}-\d{2} · id: gpt-docker/m);
  const claudeOnly = await call('search_memory', { query: 'state management', source: 'claude' });
  assert(/React state management/.test(claudeOnly) && !/ChatGPT ·/.test(claudeOnly));
  assert.match(await call('search_memory', { query: 'balcony tomatoes' }), /This app · "Garden plan"/, 'chats made in Athar are searched too');
  assert.match(await call('search_memory', { query: 'zxqv nothing like this' }), /Nothing in the user's past conversations matched/);
  await assert.rejects(call('search_memory', { query: 'x', source: 'bing' }), /must be one of: chatgpt, claude, gemini, app/);
  await assert.rejects(call('search_memory', { query: '  ' }), /empty/);
});

test('list_conversations: newest first, filters, pages', async () => {
  const { call } = toolsFor(await makeUserData());
  const all = await call('list_conversations', {});
  assert.match(all, /^13 conversation\(s\):/);
  assert(all.indexOf('Garden plan') < all.indexOf('Trip to Japan'), 'newest first');
  const page = await call('list_conversations', { limit: 5 });
  assert.match(page, /8 more — call again with offset 5\./);
  assert.match(await call('list_conversations', { offset: 5, limit: 5 }), /^13 conversation\(s\), showing 6–10:/);
  const claude = await call('list_conversations', { source: 'claude' });
  assert(!/ChatGPT ·/.test(claude) && /React state management/.test(claude));
  assert.match(await call('list_conversations', { title_contains: 'japan' }), /^1 conversation\(s\):\n- ChatGPT · "Trip to Japan itinerary" · 2024-07-\d\d · 2 messages · id: gpt-trip/);
  // gpt-trip is from July 2024: "to" includes its whole day, "from" the next day excludes it
  assert.match(await call('list_conversations', { from: '2024-07-01', to: '2024-07-31' }), /Trip to Japan/);
  assert.match(await call('list_conversations', { from: '2030-01-01' }), /No conversations match/);
  await assert.rejects(call('list_conversations', { from: 'last week' }), /date like 2025-03-31/);
});

test('read_conversation reads a whole chat, in parts when it\'s long', async () => {
  const { call } = toolsFor(await makeUserData());
  const whole = await call('read_conversation', { id: 'gpt-postgres' });
  assert.match(whole, /^# Designing the database for the bakery app\nChatGPT · \d{4}-\d{2}-\d{2} · 4 messages\n\n### 1\. User/);
  assert(/### 2\. ChatGPT/.test(whole) && /### 4\./.test(whole) && !/more message/.test(whole));
  const long = corpus.find((t) => t.id === 'claude-long');
  const first = await call('read_conversation', { id: 'claude-long', max_chars: 2000 });
  const next = Number(first.match(/call again with start_message (\d+)/)[1]);
  assert(next > 1 && next <= long.messages.length);
  const rest = await call('read_conversation', { id: 'claude-long', start_message: next, max_chars: 100000 });
  assert(rest.includes(`### ${next}. `) && rest.includes(`### ${long.messages.length}. `) && !/more message/.test(rest));
  await assert.rejects(call('read_conversation', { id: 'missing' }), /No conversation with id "missing"/);
});

test('the memory is only read — never written — and new imports show up without a restart', async () => {
  const userData = await makeUserData();
  const memDir = path.join(userData, 'memory');
  const snapshot = () => fs.readdirSync(memDir).sort().map((f) => `${f}:${fs.statSync(path.join(memDir, f)).mtimeMs}`).join('|');
  const before = snapshot();
  const { call } = toolsFor(userData);
  await call('search_memory', { query: 'sleep' });
  await call('list_conversations', {});
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(snapshot(), before, 'no file in the memory folder changed');

  // The Athar window imports more while the MCP server is running
  const writer = new MemoryIndex({ dir: memDir, embedTexts: fakeEmbed, embedModel: 'fake' });
  writer.importThreads([{ id: 'new-1', title: 'Learning the oud', source: 'gemini', createTime: 1790000000, messages: [
    { role: 'user', text: 'How do I tune an oud?' }, { role: 'assistant', text: 'Common tuning: C F A D G C.' }] }], 'gemini');
  await waitIdle(writer);
  assert.match(await call('search_memory', { query: 'tune an oud' }), /Learning the oud/);
});

test('meaning search working: no note; without Ollama or bge-m3: keywords only, with the reason and what to try', async () => {
  const userData = await makeUserData();
  const meaning = await toolsFor(userData).call('search_memory', { query: 'docker compose error' });
  assert(!/Search mode/.test(meaning) && /Docker compose error/.test(meaning), meaning);

  const noOllama = () => Promise.reject(new TypeError('fetch failed'));
  const off = await toolsFor(userData, {}, noOllama).call('search_memory', { query: 'docker compose error' });
  assert.match(off, /^Search mode: keywords only, because Ollama isn't running or isn't installed on this computer. .*synonyms.*other language/);
  assert(/Docker compose error/.test(off), 'keyword matches are still returned');
  const none = await toolsFor(userData, {}, noOllama).call('search_memory', { query: 'vehicle maintenance' });
  assert.match(none, /^Nothing in the user's past conversations matched "vehicle maintenance"\.\n\nSearch mode: keywords only/);

  const noModel = () => Promise.reject(new Error('Embed failed: 404 {"error":"model \"bge-m3\" not found, try pulling it first"}'));
  assert.match(await toolsFor(userData, {}, noModel).call('search_memory', { query: 'docker' }), /keywords only, because the bge-m3 model isn't installed in Ollama/);

  // Ollama comes back while Claude is open: the next search uses meaning again
  let up = false;
  const tools = toolsFor(userData, {}, (t) => (up ? fakeEmbed(t) : noOllama()));
  assert.match(await tools.call('search_memory', { query: 'docker' }), /keywords only/);
  up = true;
  assert(!/Search mode/.test(await tools.call('search_memory', { query: 'docker' })));
});

test('history never indexed for meaning (no Ollama when it was imported): keywords only, and why', async () => {
  const userData = await makeUserData(() => Promise.reject(new TypeError('fetch failed')));
  const text = await toolsFor(userData).call('search_memory', { query: 'docker compose error' });
  assert.match(text, /keywords only, because the past chats haven't been indexed for meaning search yet/);
});

test('an empty memory explains how to import', async () => {
  const { call } = toolsFor(tempDir('athar-mcp-empty-'));
  assert.match(await call('search_memory', { query: 'anything' }), /memory is empty/);
  assert.match(await call('list_conversations', {}), /memory is empty/);
});

// ── Connecting Claude Desktop ──
const launch = { command: 'C:\\Users\\Sara Ali\\AppData\\Local\\Programs\\Athar\\Athar.exe', args: ['--mcp'] };

test('finds Claude Desktop\'s settings folders: the installer\'s and the Microsoft Store app\'s', () => {
  const root = tempDir('athar-claude-');
  const env = { APPDATA: path.join(root, 'Roaming'), LOCALAPPDATA: path.join(root, 'Local') };
  assert.deepStrictEqual(mcpConnect.claudeDesktopDirs({ platform: 'win32', env }), [], 'not installed');
  fs.mkdirSync(path.join(env.APPDATA, 'Claude'), { recursive: true });
  const store = path.join(env.LOCALAPPDATA, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(path.join(env.LOCALAPPDATA, 'Packages', 'Microsoft.Paint_8wekyb3d8bbwe'), { recursive: true });
  assert.deepStrictEqual(mcpConnect.claudeDesktopDirs({ platform: 'win32', env }), [path.join(env.APPDATA, 'Claude'), store]);
});

test('connecting keeps the user\'s other servers and settings; disconnecting removes only Athar', () => {
  const dir = tempDir('athar-claude-');
  const file = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['fs-server'] } }, globalShortcut: 'Ctrl+Space' }));
  assert.deepStrictEqual(mcpConnect.desktopStatus(launch, [dir]), { installed: true, connected: false, outdated: false, files: [file] });

  const st = mcpConnect.connectDesktop(launch, [dir]);
  assert.strictEqual(st.connected, true);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(config.mcpServers.athar, launch);
  assert.deepStrictEqual(config.mcpServers.files, { command: 'npx', args: ['fs-server'] });
  assert.strictEqual(config.globalShortcut, 'Ctrl+Space');

  // Athar moved to another folder: the old entry is "outdated", connecting again fixes it
  const moved = { command: 'D:\\Apps\\Athar\\Athar.exe', args: ['--mcp'] };
  assert.deepStrictEqual(mcpConnect.desktopStatus(moved, [dir]).outdated, true);
  assert.strictEqual(mcpConnect.connectDesktop(moved, [dir]).connected, true);

  assert.strictEqual(mcpConnect.disconnectDesktop(moved, [dir]).connected, false);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mcpServers: { files: { command: 'npx', args: ['fs-server'] } }, globalShortcut: 'Ctrl+Space' });
});

test('a settings file that can\'t be read is never overwritten; no Claude Desktop is a clear error', () => {
  const dir = tempDir('athar-claude-');
  const file = path.join(dir, 'claude_desktop_config.json');
  fs.writeFileSync(file, '{ "mcpServers": { "files": ');
  assert.throws(() => mcpConnect.connectDesktop(launch, [dir]), /couldn't be read, so it was left unchanged/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ "mcpServers": { "files": ');
  assert.throws(() => mcpConnect.connectDesktop(launch, []), /Claude Desktop isn't installed/);
  // A new install with no settings file yet
  const fresh = tempDir('athar-claude-');
  mcpConnect.connectDesktop(launch, [fresh]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(fresh, 'claude_desktop_config.json'), 'utf8')), { mcpServers: { athar: launch } });
});

test('the launch command: the installed app with --mcp, or electron + the app folder while developing', () => {
  assert.deepStrictEqual(mcpConnect.launchCommand({ execPath: 'C:\\A\\Athar.exe', isPackaged: true }), { command: 'C:\\A\\Athar.exe', args: ['--mcp'] });
  assert.deepStrictEqual(mcpConnect.launchCommand({ execPath: 'C:\\n\\electron.exe', isPackaged: false, appPath: 'D:\\src\\Athar' }), { command: 'C:\\n\\electron.exe', args: ['D:\\src\\Athar', '--mcp'] });
  assert.strictEqual(mcpConnect.claudeCodeCommand(launch),
    'claude mcp add --scope user athar -- "C:\\Users\\Sara Ali\\AppData\\Local\\Programs\\Athar\\Athar.exe" --mcp');
});

test('"Athar --mcp" starts the server before any window or IPC code', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/main/index.js'), 'utf8');
  assert(src.indexOf("require('./mcp').startMcpMode()") < src.indexOf('registerIpcHandlers();'));
  assert(/if \(!MCP_MODE\) app\.whenReady\(\)/.test(src), 'no window in MCP mode');
});

done();
