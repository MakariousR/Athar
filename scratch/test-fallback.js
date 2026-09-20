const { tryParseFallbackToolCalls } = require('../src/main/ollama/agent-loop');

const ALL_KNOWN_TOOLS = [
  'web_search', 'fetch_web_page', 'get_current_time',
  'read_file', 'list_directory', 'search_files', 'write_file', 'edit_file', 'delete_file',
  'git_status', 'git_log', 'git_diff', 'git_add', 'git_commit', 'git_checkout', 'git_branch'
];

const sampleText = `{"name": "read_file", "arguments": {"filename": "index.html"}}`;

const parsed = tryParseFallbackToolCalls(sampleText, ALL_KNOWN_TOOLS);
console.log('Parsed fallback tool calls:', parsed);
if (parsed.length > 0 && parsed[0].name === 'read_file') {
  console.log('✅ TEST PASSED: Successfully intercepted printed read_file JSON call!');
} else {
  console.error('❌ TEST FAILED');
}
