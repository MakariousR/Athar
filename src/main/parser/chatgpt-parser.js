const fs = require('fs');

/**
 * Extracts plain text from a ChatGPT export message node.
 * Message content can be a string, a "parts" array, or missing entirely
 * (system/tool placeholder nodes) - all of those are handled here.
 */
function extractText(message) {
  if (!message || !message.content) return '';
  const content = message.content;

  if (typeof content === 'string') return content;

  if (Array.isArray(content.parts)) {
    return content.parts
      .filter((p) => typeof p === 'string')
      .join('\n');
  }

  return '';
}

/**
 * Walks a single conversation's `mapping` tree starting at `current_node`
 * and following `parent` links back to the root. This reconstructs the
 * single linear branch that was actually shown to the user, discarding
 * abandoned "regenerate" branches, then reverses it into chronological order.
 */
function reconstructThread(conversation) {
  const { mapping, current_node, title, create_time } = conversation;
  if (!mapping || !current_node) return null;

  const messages = [];
  let nodeId = current_node;
  let safety = 0;

  while (nodeId && mapping[nodeId] && safety < 10000) {
    const node = mapping[nodeId];
    const msg = node.message;
    const role = msg && msg.author ? msg.author.role : null;
    const text = extractText(msg);

    // Skip empty/system placeholder nodes but keep walking up the tree.
    if (text && (role === 'user' || role === 'assistant')) {
      messages.push({
        role,
        text,
        createTime: msg.create_time || null
      });
    }

    nodeId = node.parent;
    safety += 1;
  }

  messages.reverse(); // we walked leaf -> root, so flip back to chronological

  if (messages.length === 0) return null;

  return {
    id: conversation.conversation_id || conversation.id || title,
    title: title || 'Untitled conversation',
    createTime: create_time || (messages[0] && messages[0].createTime) || null,
    messages,
    // Precomputed flat text used by the keyword ranker so it doesn't have
    // to re-join messages on every search.
    fullText: messages.map((m) => m.text).join('\n')
  };
}

/**
 * Parses a ChatGPT `conversations.json` export file into an array of
 * normalized, chronologically-ordered thread objects.
 *
 * Also tolerates a single-conversation object or an already-flat array
 * of { role, text } style exports, so other export formats degrade
 * gracefully instead of throwing.
 */
function parseExportFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);

  const conversations = Array.isArray(data) ? data : [data];

  const threads = conversations
    .map((conv) => {
      if (conv.mapping) return reconstructThread(conv);
      return null; // unsupported shape - skipped rather than crashing the app
    })
    .filter(Boolean)
    .sort((a, b) => (a.createTime || 0) - (b.createTime || 0));

  return threads;
}

/**
 * Auto-detects whether a conversations.json is from ChatGPT or Claude
 * and routes to the correct parser. The rest of the app just calls this.
 *
 * Detection logic:
 * - Claude exports have a `chat_messages` array on each conversation
 * - ChatGPT exports have a `mapping` object on each conversation
 */
function parseAnyExport(filePath) {
  const { parseClaudeExport } = require('./claude-parser');

  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const conversations = Array.isArray(data) ? data : [data];

  if (conversations.length === 0) return [];

  const first = conversations[0];

  if (first.chat_messages) {
    // Claude format
    return parseClaudeExport(filePath);
  }

  if (first.mapping) {
    // ChatGPT format
    return parseExportFile(filePath);
  }

  throw new Error(
    'Unrecognised export format. Please use a ChatGPT or Claude conversations.json export file.'
  );
}

module.exports = { parseExportFile, parseAnyExport, reconstructThread, extractText };
