const fs = require('fs');

/**
 * Parses a Claude export conversations.json into the same normalized
 * thread format used by the ChatGPT parser, so the rest of the app
 * (ranker, prompt builder, UI) needs zero changes.
 *
 * Claude's format is a flat array of messages per conversation (no branching
 * tree). The important detail: each message's plain `text` field replaces
 * anything that isn't prose — code Claude wrote, commands it ran, file edits —
 * with a placeholder ("This block is not supported on your current device
 * yet."). The real content is in the message's `content` array as typed
 * blocks (text / tool_use / tool_result / thinking), so messages are rebuilt
 * from those blocks.
 */
function parseClaudeExport(filePath) {
  return parseClaudeData(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}

const PLACEHOLDER_RE = /\n?```\n?This block is not supported on your current device yet\.?\n?```\n?/g;
const MAX_CODE_CHARS = 20000;       // one file/artifact
const MAX_OUTPUT_CHARS = 1500;      // command output shown under a command
const MAX_ATTACHMENT_CHARS = 20000; // text of a file the user uploaded (shown as a card, opened on demand)

const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', ps1: 'powershell',
  html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', sql: 'sql', md: 'markdown', txt: '', csv: 'csv', dockerfile: 'dockerfile'
};

function langFor(path, fallback = '') {
  const name = String(path || '').toLowerCase();
  if (name.endsWith('dockerfile')) return 'dockerfile';
  const ext = name.split('.').pop();
  return LANG_BY_EXT[ext] !== undefined ? LANG_BY_EXT[ext] : fallback;
}

function clip(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}\n… (${(s.length - max).toLocaleString()} more characters)` : s;
}

/** Markdown code block; uses a longer fence if the code itself contains ``` */
function fence(code, lang = '') {
  const body = String(code || '').replace(/\s+$/, '');
  let ticks = '```';
  while (body.includes(ticks)) ticks += '`';
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

function resultText(result) {
  if (!result) return '';
  const parts = Array.isArray(result.content) ? result.content : [result.content];
  return parts
    .filter((p) => p && (typeof p === 'string' || p.type === 'text'))
    .map((p) => (typeof p === 'string' ? p : p.text || ''))
    .join('\n')
    .trim();
}

const italic = (s) => `_${String(s).replace(/_/g, '\\_')}_`;

/** Markdown for one tool call (and, for commands, its output). */
function renderToolUse(block, result) {
  const input = block.input || {};
  const name = block.name || 'tool';
  const note = input.description ? `${italic(input.description)}\n` : '';

  switch (name) {
    case 'bash_tool': {
      const output = resultText(result);
      return `${note}${fence(input.command, 'bash')}` +
        (output ? `\n${result && result.is_error ? 'Error:' : 'Output:'}\n${fence(clip(output, MAX_OUTPUT_CHARS))}` : '');
    }
    case 'create_file':
      return `${note}**Created \`${input.path}\`**\n${fence(clip(input.file_text, MAX_CODE_CHARS), langFor(input.path))}`;
    case 'str_replace': {
      const diff = [
        ...String(input.old_str || '').split('\n').map((l) => `- ${l}`),
        ...String(input.new_str || '').split('\n').map((l) => `+ ${l}`)
      ].join('\n');
      return `${note}**Edited \`${input.path}\`**\n${fence(clip(diff, MAX_CODE_CHARS), 'diff')}`;
    }
    case 'view':
      return italic(`Viewed ${input.path || 'a file'}`);
    case 'present_files':
      // One line per file shared with the user; the app shows each as a file card
      return (input.filepaths || []).length
        ? input.filepaths.map((p) => `**Shared \`${p}\`**`).join('\n\n')
        : italic('Shared files');
    case 'web_search':
    case 'web_search_fast':
      return italic(`Searched the web: "${input.query || ''}"`);
    case 'web_fetch':
      return italic(`Opened ${input.url || 'a web page'}`);
    case 'artifacts': {
      // Older exports: code/document artifacts — shown as a card, like a created file
      const title = String(input.title || input.id || 'Artifact').replace(/`/g, "'");
      if (input.command === 'update' && (input.old_str || input.new_str)) {
        const diff = [
          ...String(input.old_str || '').split('\n').map((l) => `- ${l}`),
          ...String(input.new_str || '').split('\n').map((l) => `+ ${l}`)
        ].join('\n');
        return `**Updated artifact \`${title}\`**\n${fence(clip(diff, MAX_CODE_CHARS), 'diff')}`;
      }
      return input.content ? `**Artifact \`${title}\`**\n${fence(clip(input.content, MAX_CODE_CHARS), artifactLang(input))}` : italic(title);
    }
    case 'repl':
      return fence(clip(input.code, MAX_CODE_CHARS), 'javascript');
    case 'ask_user_input_v0': {
      const qs = (input.questions || []).map((q) => (typeof q === 'string' ? q : q.question || q.text || '')).filter(Boolean);
      return qs.length ? `${italic('Asked you:')}\n${qs.map((q) => `- ${q}`).join('\n')}` : '';
    }
    default: {
      // Unknown/future tools: name + any code-like field
      const code = input.code || input.command || input.content || input.file_text;
      return `${italic(`Used ${name}`)}${typeof code === 'string' && code.trim() ? `\n${fence(clip(code, MAX_CODE_CHARS), langFor(input.path))}` : ''}`;
    }
  }
}

/** The code language of an artifact, from its type: markdown, html, svg, jsx, mermaid, or its own language. */
function artifactLang(input) {
  const type = String(input.type || '');
  if (/markdown/.test(type)) return 'markdown';
  if (/html/.test(type)) return 'html';
  if (/svg/.test(type)) return 'svg';
  if (/react/.test(type)) return 'jsx';
  if (/mermaid/.test(type)) return 'mermaid';
  return input.language || '';
}

/** Files the user uploaded in this message (their extracted text is kept; the app shows it as a card). */
function renderAttachments(m) {
  const parts = [];
  for (const a of m.attachments || []) {
    const name = String(a.file_name || 'file').replace(/`/g, "'");
    parts.push(a.extracted_content
      ? `**Attached \`${name}\`**\n${fence(clip(a.extracted_content, MAX_ATTACHMENT_CHARS), langFor(name))}`
      : `**Attached \`${name}\`**`);
  }
  for (const f of m.files || []) {
    if (f && f.file_name && !(m.attachments || []).some((a) => a.file_name === f.file_name)) parts.push(`**Attached \`${String(f.file_name).replace(/`/g, "'")}\`**`);
  }
  return parts.join('\n\n');
}

/**
 * The message as Markdown, rebuilt from its content blocks when there are
 * any beyond plain text (so code, commands and edits appear instead of the
 * "not supported on your current device" placeholder).
 */
function messageText(m) {
  const blocks = Array.isArray(m.content) ? m.content.filter(Boolean) : [];
  const hasRichBlocks = blocks.some((b) => b.type && b.type !== 'text');
  let body;

  if (blocks.length > 0 && (hasRichBlocks || !(typeof m.text === 'string' && m.text.trim()))) {
    const results = new Map(blocks.filter((b) => b.type === 'tool_result' && b.tool_use_id).map((b) => [b.tool_use_id, b]));
    body = blocks.map((b) => {
      if (b.type === 'text') return typeof b.text === 'string' ? b.text : '';
      if (b.type === 'tool_use') return renderToolUse(b, results.get(b.id));
      return ''; // thinking (internal) and tool_result (shown with its tool call)
    }).filter((s) => s && s.trim()).join('\n\n');
  } else {
    body = typeof m.text === 'string' ? m.text : '';
  }

  body = body.replace(PLACEHOLDER_RE, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const attachments = renderAttachments(m);
  return [attachments, body].filter(Boolean).join('\n\n');
}

/** Same as parseClaudeExport, for already-parsed JSON. */
function parseClaudeData(data) {
  // Lazy require: chatgpt-parser also requires this module (lazily) for auto-detection.
  const { contentId } = require('./chatgpt-parser');
  const conversations = Array.isArray(data) ? data : [data];

  const threads = conversations
    .map((conv) => {
      // Skip anything that doesn't look like a Claude conversation
      if (!conv || !conv.chat_messages || !Array.isArray(conv.chat_messages)) return null;

      const messages = conv.chat_messages
        .filter((m) => m && (m.sender === 'human' || m.sender === 'assistant'))
        .map((m) => ({
          role: m.sender === 'human' ? 'user' : 'assistant',
          text: messageText(m),
          createTime: m.created_at ? new Date(m.created_at).getTime() / 1000 : null
        }))
        .filter((m) => m.text);

      if (messages.length === 0) return null;

      const createTime = conv.created_at
        ? new Date(conv.created_at).getTime() / 1000
        : (messages[0].createTime || null);

      return {
        id: conv.uuid || contentId('claude', conv.name, createTime, messages),
        title: conv.name || 'Untitled conversation',
        source: 'claude',
        createTime,
        messages,
        // Same precomputed fullText field the keyword ranker expects
        fullText: messages.map((m) => m.text).join('\n')
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  // Claude's export sometimes contains conversations with no text at all
  // (e.g. untitled chats whose messages are all empty). Report how many.
  Object.defineProperty(threads, 'skippedEmpty', { value: conversations.length - threads.length });
  return threads;
}

module.exports = { parseClaudeExport, parseClaudeData, messageText };
