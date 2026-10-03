// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
// Claude exports replace code/commands in `text` with a placeholder; the real
// content is in the `content` blocks. These tests use the structure of a real
// export (bash_tool, create_file, str_replace, view, web_search, thinking,
// tool_result, attachments) with made-up content.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { test, done, tempDir, ROOT } = require('./helpers');
const { parseAnyExport } = require(path.join(ROOT, 'src/main/parser/chatgpt-parser'));
const { messageText } = require(path.join(ROOT, 'src/main/parser/claude-parser'));

const exportData = require('./fixtures/claude-export');

const file = path.join(tempDir('cm-claude-'), 'conversations.json');
fs.writeFileSync(file, JSON.stringify(exportData));

test('code, commands and edits replace the "not supported" placeholders', () => {
  const [thread] = parseAnyExport(file);
  const text = thread.messages[1].text;
  assert(!/not supported on your current device/.test(text), text);
  assert(/```bash\nnpm init -y && npm install express\n```/.test(text), 'command shown');
  assert(/Output:\n```\nadded 64 packages in 3s\n```/.test(text), 'command output shown');
  assert(/\*\*Created `\/app\/server\.js`\*\*\n```javascript\nconst express/.test(text), 'created file with language');
  assert(/```diff\n- app\.listen\(3000\);\n\+ app\.listen\(8080\);\n```/.test(text), 'edit as a diff');
  assert(/_Viewed \/app\/package\.json_/.test(text));
  assert(/_Searched the web: "express 5 release notes"_/.test(text));
  assert(text.startsWith('Let me set that up.') && text.endsWith('Done — the server is ready.'), 'prose kept in order');
  assert(!/internal reasoning/.test(text), 'thinking is not shown');
});

test('files the user uploaded are kept (their text; the app shows it as a card)', () => {
  const [thread] = parseAnyExport(file);
  const text = thread.messages[0].text;
  assert(/\*\*Attached `notes\.txt`\*\*\n```\nUse port 8080 in production\.\n```/.test(text), text);
  assert(/Set up an express server on port 8080$/.test(text));
});

test('conversations the export has no text for are skipped and counted', () => {
  const threads = parseAnyExport(file);
  assert.strictEqual(threads.length, 1);
  assert.strictEqual(threads.skippedEmpty, 1);
});

test('code containing ``` gets a longer fence so it can\'t break the block', () => {
  const text = messageText({ sender: 'assistant', text: '', content: [
    { type: 'tool_use', id: 'x', name: 'create_file', input: { path: 'README.md', file_text: 'Example:\n```js\nx()\n```' } }
  ] });
  assert(/````markdown\nExample:\n```js\nx\(\)\n```\n````/.test(text), text);
});

test('older export formats: artifacts and analysis-tool code', () => {
  const text = messageText({ sender: 'assistant', text: '', content: [
    { type: 'tool_use', name: 'artifacts', input: { command: 'create', title: 'Fibonacci', language: 'python', content: 'def fib(n): ...' } },
    { type: 'tool_use', name: 'repl', input: { code: 'console.log(1 + 1)' } }
  ] });
  assert(/\*\*Artifact `Fibonacci`\*\*\n```python\ndef fib\(n\): \.\.\.\n```/.test(text), text);
  assert(/```javascript\nconsole\.log\(1 \+ 1\)\n```/.test(text));
  // Artifact types → the language the viewer previews (Markdown, HTML, SVG) or highlights
  const typed = (type) => messageText({ sender: 'assistant', text: '', content: [{ type: 'tool_use', name: 'artifacts', input: { title: 'X', type, content: 'x' } }] });
  assert(/```markdown\n/.test(typed('text/markdown')) && /```html\n/.test(typed('text/html')) && /```svg\n/.test(typed('image/svg+xml')) && /```jsx\n/.test(typed('application/vnd.ant.react')));
  // Files Claude shared: one line each (the app shows each as a card)
  const shared = messageText({ sender: 'assistant', text: '', content: [{ type: 'tool_use', name: 'present_files', input: { filepaths: ['/out/a.md', '/out/b.docx'] } }] });
  assert.strictEqual(shared, '**Shared `/out/a.md`**\n\n**Shared `/out/b.docx`**');
  // An edit Claude's tool refused didn't change the file: a note, not an "Edited" card
  const failed = messageText({ sender: 'assistant', text: '', content: [
    { type: 'tool_use', id: 'e1', name: 'str_replace', input: { path: '/home/claude/window.py', old_str: 'a', new_str: 'b' } },
    { type: 'tool_result', tool_use_id: 'e1', is_error: true, content: [{ type: 'text', text: 'String to replace not found in /home/claude/window.py.' }] },
    { type: 'tool_use', id: 'e2', name: 'str_replace', input: { path: '/home/claude/window.py', old_str: 'c', new_str: 'd' } },
    { type: 'tool_result', tool_use_id: 'e2', content: [{ type: 'text', text: 'Successfully replaced string in /home/claude/window.py' }] }
  ] });
  assert.strictEqual((failed.match(/\*\*Edited /g) || []).length, 1, failed);
  assert(/_Tried to edit \/home\/claude\/window\.py — it didn't work_/.test(failed), failed);
});

test('plain-text messages are unchanged; unknown tools are named', () => {
  assert.strictEqual(messageText({ text: 'hello', content: [{ type: 'text', text: 'hello' }] }), 'hello');
  const t = messageText({ text: '', content: [{ type: 'tool_use', name: 'future_tool', input: { code: 'run()' } }] });
  assert(/_Used future\\_tool_\n```\nrun\(\)\n```/.test(t), t);
});

done();
