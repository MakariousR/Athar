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
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  const conversations = Array.isArray(data) ? data : [data];

  const threads = conversations
    .map((conv) => {
      // Skip anything that doesn't look like a Claude conversation
      if (!conv.chat_messages || !Array.isArray(conv.chat_messages)) return null;

      const messages = conv.chat_messages
        .filter((m) => m.text && (m.sender === 'human' || m.sender === 'assistant'))
        .map((m) => ({
          role: m.sender === 'human' ? 'user' : 'assistant',
          text: m.text,
          createTime: m.created_at ? new Date(m.created_at).getTime() / 1000 : null
        }));

      if (messages.length === 0) return null;

      const createTime = conv.created_at
        ? new Date(conv.created_at).getTime() / 1000
        : (messages[0].createTime || null);

      return {
        id: conv.uuid || conv.name,
        title: conv.name || 'Untitled conversation',
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

module.exports = { parseClaudeExport };
