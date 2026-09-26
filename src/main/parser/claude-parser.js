const fs = require('fs');

/**
 * Parses a Claude export conversations.json into the same normalized
 * thread format used by the ChatGPT parser, so the rest of the app
 * (ranker, prompt builder, UI) needs zero changes.
 *
 * Claude's format is much simpler than ChatGPT's - flat array of
 * messages per conversation, no branching tree to walk.
 */
function parseClaudeExport(filePath) {
  return parseClaudeData(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}

/**
 * Message text: older exports have a plain `text` field; newer ones may leave
 * it empty and put the text in a `content` array of { type: 'text', text } blocks.
 */
function messageText(m) {
  if (typeof m.text === 'string' && m.text.trim()) return m.text;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
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

  return threads;
}

module.exports = { parseClaudeExport, parseClaudeData };
