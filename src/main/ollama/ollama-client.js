const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'gemma3:4b';
const EMBED_MODEL = 'bge-m3';

async function isOllamaRunning() {
  try {
    const res = await fetch(OLLAMA_BASE, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function listModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Failed to list models: ${res.status}`);
  const data = await res.json();
  // Return objects with name + size so callers can sort lightest → heaviest
  return (data.models || []).map((m) => ({ name: m.name, size: m.size || 0 }));
}

async function isModelInstalled(modelName) {
  const models = await listModels();
  return models.some((m) => m.name === modelName || m.name.startsWith(`${modelName}:`));
}

async function checkAllModels() {
  const models = await listModels();
  const has = (name) => models.some((m) => m.name === name || m.name.startsWith(`${name}:`));
  const chatInstalled  = has(DEFAULT_MODEL);
  const embedInstalled = has(EMBED_MODEL);
  return { chatInstalled, embedInstalled, allInstalled: chatInstalled && embedInstalled };
}

async function pullModel(modelName, onProgress = () => {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true })
  });
  if (!res.ok || !res.body) throw new Error(`Failed to pull ${modelName}: ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onProgress(JSON.parse(line)); } catch {}
    }
  }
  return { success: true };
}

async function deleteModel(modelName) {
  const res = await fetch(`${OLLAMA_BASE}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName })
  });
  if (!res.ok) throw new Error(`Failed to delete ${modelName}: ${res.status}`);
  return { success: true };
}

async function embedText(text) {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  if (!res.ok) throw new Error(`Embed failed: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

const { normalizeArabicText } = require('../utils/text-normalizer');

async function embedThreads(threads, onProgress = () => {}) {
  const results = [];
  for (let i = 0; i < threads.length; i++) {
    const t    = threads[i];
    const rawText = `${t.title}\n${t.fullText}`.slice(0, 2000);
    const normalizedText = normalizeArabicText(rawText);
    const embedding = await embedText(normalizedText);
    results.push({ ...t, embedding });
    onProgress(i + 1, threads.length);
  }
  return results;
}



const { searchWebTool, fetchPageTool } = require('../tools/web-search');

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Surfs DuckDuckGo to search for current news, facts, web links, or real-time info.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query terms' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_web_page',
      description: 'Enters a specific web URL link, scrapes its main content paragraphs, and returns the page text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The exact HTTP/HTTPS URL of the web page to open and read' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Returns the current local date and time.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

async function executeTool(toolName, args, onStatus = () => {}) {
  if (toolName === 'web_search') {
    onStatus({ icon: '🌐', text: `Searching web for: "${args.query}"` });
    return await searchWebTool(args.query);
  }
  if (toolName === 'fetch_web_page') {
    onStatus({ icon: '📄', text: `Opening page: ${args.url.slice(0, 45)}…` });
    return await fetchPageTool(args.url);
  }
  if (toolName === 'get_current_time') {
    onStatus({ icon: '🕒', text: `Checking current date and time…` });
    return { date: new Date().toLocaleString() };
  }
  return { error: `Unknown tool: ${toolName}` };
}

function buildMessages(userText, importedThreads, conversationHistory) {
  const messages = [];

  let systemContent = `You are an intelligent personal AI agent.

CRITICAL CONTEXT & BOUNDARY RULES:
1. STRICT BOUNDARY BETWEEN ARCHIVE & ACTIVE CHAT:
   - Items inside <background_reference_archive> are imported past logs from old ChatGPT/Claude exports. They are PASSIVE REFERENCE ONLY.
   - The active user chat session history represents the real-time conversation.
   - NEVER confuse past imported threads with the active chat session history.
   - ONLY reference background archives if the user explicitly asks about past work, or if it directly answers the user's prompt.
2. PRIMARY FOCUS: The active chat conversation topic is your top priority. Stay focused on what the user is currently asking or building.
3. LANGUAGE MATCHING: You MUST ALWAYS respond in the EXACT SAME LANGUAGE as the user's input prompt (e.g., if prompt is in Arabic, respond in Arabic; if English, respond in English).
4. NO PLACEHOLDERS: Never output bracket placeholders like "[Name 1]".`;

  // Inject matching threads in explicit XML structure
  if (importedThreads && importedThreads.length > 0) {
    systemContent += `\n\n<background_reference_archive>\n`;
    systemContent += `The following are imported past conversation logs from prior exports. Treat them solely as background knowledge.\n`;
    importedThreads.forEach((t, i) => {
      const date = t.createTime
        ? new Date(t.createTime * 1000).toISOString().slice(0, 10)
        : 'unknown date';

      let threadDialogue = '';
      if (t.messages && t.messages.length > 0) {
        threadDialogue = t.messages
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
          .join('\n');
      } else {
        threadDialogue = t.fullText || '';
      }

      const text = threadDialogue.length > 2500 ? threadDialogue.slice(0, 2500) + '…' : threadDialogue;
      systemContent += `\n<past_thread index="${i + 1}" title="${t.title}" date="${date}">\n${text}\n</past_thread>\n`;
    });
    systemContent += `</background_reference_archive>\n`;
  }

  messages.push({ role: 'system', content: systemContent });

  // Append active chat history turns (prior turns + user message)
  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-12);
    for (const msg of recent) {
      const text = msg.text || msg.content || '';
      if (text) {
        messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      }
    }
  } else {
    messages.push({ role: 'user', content: userText });
  }

  return messages;
}

async function generate(userText, importedThreads, conversationHistory, modelName = DEFAULT_MODEL, onToken = () => {}, onStatus = () => {}) {
  const messages = buildMessages(userText, importedThreads, conversationHistory);
  let step = 0;
  const maxSteps = 4;
  const executedToolKeys = new Set();

  onStatus({ icon: '🧠', text: 'Thinking & planning execution steps…' });

  while (step < maxSteps) {
    step++;

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages,
        tools: AGENT_TOOLS,
        stream: true,
        options: { temperature: 0.7, num_ctx: 8192, num_predict: -1 }
      })
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.status);
      throw new Error(`Ollama chat failed: ${errText}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCalls = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.message) {
            const token = chunk.message.content;
            if (token) { fullContent += token; onToken(token); }
            if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
              toolCalls.push(...chunk.message.tool_calls);
            }
          }
        } catch {}
      }
    }

    // Filter out duplicate tool calls already executed in previous turns to prevent infinite loops
    const uniqueToolCalls = toolCalls.filter((call) => {
      const key = `${call.function.name}:${JSON.stringify(call.function.arguments || {})}`;
      if (executedToolKeys.has(key)) return false;
      executedToolKeys.add(key);
      return true;
    });

    // If no new tool calls requested, we are done!
    if (uniqueToolCalls.length === 0) {
      onStatus({ icon: '✨', text: 'Final answer synthesized.' });
      return fullContent;
    }

    // Store assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: fullContent,
      tool_calls: uniqueToolCalls
    });

    // Execute each unique tool call
    for (const call of uniqueToolCalls) {
      const fnName = call.function.name;
      const fnArgs = call.function.arguments || {};

      const toolResult = await executeTool(fnName, fnArgs, onStatus);

      messages.push({
        role: 'tool',
        content: JSON.stringify(toolResult)
      });
    }

    onStatus({ icon: '🔄', text: 'Analyzing observations & drafting answer…' });
  }

  return fullContent;
}

module.exports = {
  DEFAULT_MODEL,
  EMBED_MODEL,
  isOllamaRunning,
  listModels,
  isModelInstalled,
  checkAllModels,
  pullModel,
  deleteModel,
  embedText,
  embedThreads,
  generate
};
