const fs = require('fs');
const crypto = require('crypto');

/**
 * Fallback ID for a conversation whose export entry has no ID of its own.
 * Built from its content, not just its title: many different chats share
 * titles like "New chat", and threads are merged by ID, so a title-based ID
 * silently merged unrelated conversations into one. Stable across re-imports
 * of the same export.
 */
function contentId(source, title, createTime, messages) {
  const first = messages[0] ? `${messages[0].role}:${String(messages[0].text).slice(0, 500)}` : '';
  const hash = crypto.createHash('sha1')
    .update(`${source}|${title || ''}|${createTime || ''}|${messages.length}|${first}`)
    .digest('hex')
    .slice(0, 20);
  return `${source}_${hash}`;
}

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

  const createTime = create_time || (messages[0] && messages[0].createTime) || null;

  return {
    id: conversation.conversation_id || conversation.id || contentId('chatgpt', title, createTime, messages),
    title: title || 'Untitled conversation',
    source: 'chatgpt',
    createTime,
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
  return parseChatGptData(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}

/** Same as parseExportFile, for already-parsed JSON. */
function parseChatGptData(data) {
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
  const { parseClaudeData } = require('./claude-parser');
  const { parseGeminiData, looksLikeGeminiActivity, isGeminiActivityHtml } = require('./gemini-parser');

  // Read and parse ONCE — exports can be hundreds of MB.
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (isGeminiActivityHtml(raw)) {
    throw new Error('This is the HTML version of Google Takeout\'s Gemini activity. In Google Takeout, choose ' +
      '"My Activity", open its format options, pick JSON instead of HTML, and import the MyActivity.json file.');
  }
  let data;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    throw new Error('This file is not a JSON export. Import conversations.json (ChatGPT or Claude) or MyActivity.json (Gemini, from Google Takeout).');
  }
  const conversations = Array.isArray(data) ? data : [data];

  if (conversations.length === 0) return [];

  const first = conversations[0] || {};

  if (first.chat_messages) {
    // Claude format
    return parseClaudeData(data);
  }

  if (first.mapping) {
    // ChatGPT format
    return parseChatGptData(data);
  }

  if (looksLikeGeminiActivity(data)) {
    // Google Takeout → My Activity → Gemini Apps (JSON)
    return parseGeminiData(data);
  }

  throw new Error(
    'Unrecognised export format. Supported: ChatGPT or Claude conversations.json, and Gemini MyActivity.json from Google Takeout.'
  );
}

module.exports = { parseExportFile, parseChatGptData, parseAnyExport, reconstructThread, extractText, contentId };
