// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
// A Claude export with the structure of a real one (made-up content): the
// `text` field has "not supported" placeholders; the real code/commands are
// in the `content` blocks. Used by tests/claude-export.test.js.
const PLACEHOLDER = '\n```\nThis block is not supported on your current device yet.\n```\n';

const assistantMsg = {
  uuid: 'm2', sender: 'assistant', created_at: '2026-07-01T10:01:00Z', attachments: [], files: [],
  text: `Let me set that up.${PLACEHOLDER}${PLACEHOLDER}Done — the server is ready.`,
  content: [
    { type: 'thinking', thinking: 'internal reasoning that should not be shown' },
    { type: 'text', text: 'Let me set that up.' },
    { type: 'tool_use', id: 't1', name: 'bash_tool', input: { command: 'npm init -y && npm install express', description: 'Create the project' } },
    { type: 'tool_result', tool_use_id: 't1', name: 'bash_tool', is_error: false, content: [{ type: 'text', text: 'added 64 packages in 3s' }] },
    { type: 'tool_use', id: 't2', name: 'create_file', input: { path: '/app/server.js', description: 'Server', file_text: "const express = require('express');\napp.listen(3000);" } },
    { type: 'tool_result', tool_use_id: 't2', name: 'create_file', content: [{ type: 'text', text: 'File created' }] },
    { type: 'tool_use', id: 't3', name: 'str_replace', input: { path: '/app/server.js', old_str: 'app.listen(3000);', new_str: 'app.listen(8080);' } },
    { type: 'tool_use', id: 't4', name: 'view', input: { path: '/app/package.json' } },
    { type: 'tool_use', id: 't5', name: 'web_search', input: { query: 'express 5 release notes' } },
    { type: 'tool_result', tool_use_id: 't5', name: 'web_search', content: [{ type: 'knowledge', title: 'x', url: 'https://example.com' }] },
    { type: 'text', text: 'Done — the server is ready.' }
  ]
};

const exportData = [
  {
    uuid: 'c1', name: 'Express server setup', created_at: '2026-07-01T10:00:00Z',
    chat_messages: [
      { uuid: 'm1', sender: 'human', created_at: '2026-07-01T10:00:00Z', text: 'Set up an express server on port 8080', content: [{ type: 'text', text: 'Set up an express server on port 8080' }],
        attachments: [{ file_name: 'notes.txt', file_size: 40, file_type: 'text/plain', extracted_content: 'Use port 8080 in production.' }], files: [] },
      assistantMsg
    ]
  },
  // Untitled conversation whose messages are empty in the export
  { uuid: 'c2', name: '', created_at: '2026-07-02T10:00:00Z', chat_messages: [
    { uuid: 'e1', sender: 'human', text: '', content: [], attachments: [], files: [{ file_uuid: 'f', file_name: '' }] },
    { uuid: 'e2', sender: 'assistant', text: '', content: [], attachments: [], files: [] }
  ] }
];

module.exports = exportData;
