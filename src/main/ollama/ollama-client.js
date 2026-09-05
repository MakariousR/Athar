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
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {}
      if (parsed) {
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        onProgress(parsed);
      }
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
      description: 'Searches DuckDuckGo for live facts, real-time data, specific entity names, lists, and news. Returns extracted web page text and snippets. IMPORTANT: Always extract the exact names, items, facts, or data requested by the user from these results rather than returning website titles or search result descriptions.',
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
      description: 'Fetches and extracts full article text, ordered lists, and tables from a web page URL. Use this if search snippets do not contain all the specific names, list items, or details requested by the user.',
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
    const result = await searchWebTool(args.query);
    if (result.resultsCount > 0) {
      onStatus({ icon: '📊', text: `Retrieved ${result.resultsCount} source${result.resultsCount !== 1 ? 's' : ''} — analyzing content…` });
    } else if (result.status === 'offline') {
      onStatus({ icon: '⚠️', text: 'No internet connection — using local knowledge.' });
    } else if (result.status === 'no_results') {
      onStatus({ icon: '🔎', text: `No results found for "${args.query}" — trying another approach…` });
    }
    return result;
  }
  if (toolName === 'fetch_web_page') {
    onStatus({ icon: '📄', text: `Opening page: ${String(args.url).slice(0, 50)}…` });
    const result = await fetchPageTool(args.url);
    if (result.success && result.content) {
      onStatus({ icon: '📋', text: `Page loaded: "${result.title || 'Untitled'}" — extracting content…` });
    } else {
      onStatus({ icon: '⚠️', text: `Could not load page — will rely on search snippets.` });
    }
    return result;
  }
  if (toolName === 'get_current_time') {
    onStatus({ icon: '🕒', text: `Checking current date and time…` });
    return { date: new Date().toLocaleString() };
  }
  return { error: `Unknown tool: ${toolName}` };
}

class ThinkTagStreamParser {
  constructor(onToken, onReasoningToken) {
    this.onToken = onToken || (() => {});
    this.onReasoningToken = onReasoningToken || (() => {});
    this.inThink = false;
    this.buffer = '';
    this.fullReasoning = '';
    this.fullOutput = '';
  }

  process(chunk) {
    this.buffer += chunk;

    while (this.buffer.length > 0) {
      if (!this.inThink) {
        const thinkStart = this.buffer.indexOf('<think>');
        if (thinkStart !== -1) {
          const before = this.buffer.slice(0, thinkStart);
          if (before) {
            this.fullOutput += before;
            this.onToken(before);
          }
          this.inThink = true;
          this.buffer = this.buffer.slice(thinkStart + '<think>'.length);
        } else {
          const partialIdx = this.buffer.lastIndexOf('<');
          if (partialIdx !== -1 && '<think>'.startsWith(this.buffer.slice(partialIdx))) {
            const safe = this.buffer.slice(0, partialIdx);
            if (safe) {
              this.fullOutput += safe;
              this.onToken(safe);
            }
            this.buffer = this.buffer.slice(partialIdx);
            break;
          } else {
            this.fullOutput += this.buffer;
            this.onToken(this.buffer);
            this.buffer = '';
          }
        }
      } else {
        const thinkEnd = this.buffer.indexOf('</think>');
        if (thinkEnd !== -1) {
          const inside = this.buffer.slice(0, thinkEnd);
          if (inside) {
            this.fullReasoning += inside;
            this.onReasoningToken(inside);
          }
          this.inThink = false;
          this.buffer = this.buffer.slice(thinkEnd + '</think>'.length);
        } else {
          const partialIdx = this.buffer.lastIndexOf('<');
          if (partialIdx !== -1 && '</think>'.startsWith(this.buffer.slice(partialIdx))) {
            const safe = this.buffer.slice(0, partialIdx);
            if (safe) {
              this.fullReasoning += safe;
              this.onReasoningToken(safe);
            }
            this.buffer = this.buffer.slice(partialIdx);
            break;
          } else {
            this.fullReasoning += this.buffer;
            this.onReasoningToken(this.buffer);
            this.buffer = '';
          }
        }
      }
    }
  }

  flush() {
    if (this.buffer.length > 0) {
      if (this.inThink) {
        this.fullReasoning += this.buffer;
        this.onReasoningToken(this.buffer);
      } else {
        this.fullOutput += this.buffer;
        this.onToken(this.buffer);
      }
      this.buffer = '';
    }
  }
}

function buildMessages(userText, importedThreads, conversationHistory, images = []) {
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
4. NO PLACEHOLDERS: Never output bracket placeholders like "[Name 1]".
5. SEARCH & SCRAPED CONTEXT INSTRUCTIONS:
   - When web_search or fetch_web_page is executed, full scraped webpage content is ingested.
   - Your objective is to extract SPECIFIC FACTS, NAMES, DATES, FIGURES, LISTS, and EXACT REAL DATA requested by the user directly from the scraped webpage content.
   - NEVER output placeholder syntax like "[Title]", "[Artist]", "[Name]", "[Description]", or generic brackets. Always use the actual real entity/item names found in the scraped text.
   - NEVER output web page titles, search snippet descriptions, or URL domain metadata as your final answer when the user requested factual content or lists.
   - If initial web search results do not contain all requested items, execute fetch_web_page on the relevant target URL or run a follow-up query to retrieve complete information before synthesizing your final response.
6. MANDATORY INTERNAL CHAIN-OF-THOUGHT (SCRATCHPAD):
   - You MUST ALWAYS begin your response with a <think> tag and write out your step-by-step internal reasoning, planning, logic evaluation, and draft steps.
   - Close your reasoning block with a </think> tag before providing your final answer.
   - All final answers, summaries, code blocks, or structured deliverables MUST be placed strictly outside the <think>...</think> block.
7. AGENTIC SELF-CHECK PROTOCOL:
   - After receiving tool results you will be asked to review your findings before answering.
   - Ask yourself: "Do I now have ALL the specific names, items, dates, figures, or facts the user requested?"
   - If YES → write the complete, well-structured final answer immediately. Do NOT call another tool.
   - If NO or UNCERTAIN → call the appropriate tool again with a more specific query or a targeted URL.
   - NEVER write a partial answer and promise to search more. Either search first, or deliver a complete answer.
   - NEVER fabricate, guess, or invent data items (names, songs, titles, numbers) that were not found in search results.
   - NEVER output the raw text of a tool call (e.g. JSON). Either call a tool properly, or write your final answer.`;

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
    for (let i = 0; i < recent.length; i++) {
      const msg = recent[i];
      const text = msg.text || msg.content || '';
      if (text || (msg.images && msg.images.length > 0)) {
        const msgObj = {
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: text
        };
        // If message has attached images (Base64), include them
        if (msg.images && msg.images.length > 0) {
          msgObj.images = msg.images;
        }
        // If this is the final turn and new images are provided, merge them
        if (i === recent.length - 1 && msg.role === 'user' && images && images.length > 0) {
          msgObj.images = Array.from(new Set([...(msgObj.images || []), ...images]));
        }
        messages.push(msgObj);
      }
    }
  } else {
    const userMsgObj = { role: 'user', content: userText };
    if (images && images.length > 0) {
      userMsgObj.images = images;
    }
    messages.push(userMsgObj);
  }

  return messages;
}

// Detects tool calls that the model emitted as plain JSON text instead of
// using the structured tool_calls field. Some models (e.g. qwen2.5:3b) accept
// the tools schema without error but write the call as raw content.
function extractTextToolCalls(text) {
  const results = [];
  // Strip <think>…</think> blocks before scanning
  const stripped = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
  if (!stripped) return results;

  const normalizeCall = (parsed) => {
    if (!parsed || typeof parsed !== 'object') return null;
    const source = parsed.function || parsed.tool || parsed;
    const name = source.name || source.function?.name;
    let args = source.arguments ?? source.parameters ?? source.input ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { return null; }
    }
    return typeof name === 'string' && args && typeof args === 'object'
      ? { function: { name, arguments: args } }
      : null;
  };

  // Try the whole stripped output as a single tool-call JSON object
  try {
    const parsed = JSON.parse(stripped);
    const call = normalizeCall(parsed);
    if (call) { results.push(call); return results; }
  } catch {}

  // Fallback: locate JSON objects embedded anywhere in the text
  let i = 0;
  while (i < stripped.length) {
    if (stripped[i] === '{') {
      let depth = 0;
      let j = i;
      while (j < stripped.length) {
        if (stripped[j] === '{') depth++;
        else if (stripped[j] === '}') { depth--; if (depth === 0) break; }
        j++;
      }
      try {
        const parsed = JSON.parse(stripped.slice(i, j + 1));
        const call = normalizeCall(parsed);
        if (call) results.push(call);
      } catch {}
      i = j + 1;
    } else {
      i++;
    }
  }
  return results;
}

function normalizeToolArguments(args) {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return args;
}

async function generate(userText, importedThreads, conversationHistory, modelName = DEFAULT_MODEL, onToken = () => {}, onReasoningToken = () => {}, onStatus = () => {}, images = []) {
  const messages = buildMessages(userText, importedThreads, conversationHistory, images);
  let step = 0;
  const agentDeadline = Date.now() + 180000;
  const executedToolKeys = new Set();
  let enableTools = true;

  // Track the most recent iteration's token buffer and content for timeout fallback handling.
  let lastTokenBuffer = [];
  let lastFullContent = '';

  onStatus({ icon: '🧠', text: 'Thinking & planning execution steps…' });

  while (Date.now() < agentDeadline) {
    step++;
    const timeRemaining = agentDeadline - Date.now();
    const finalWindow = timeRemaining < 30000;

    // Keep exploring until the time budget is nearly exhausted, then reserve
    // a final synthesis window instead of stopping at an arbitrary step count.
    if (finalWindow && enableTools) enableTools = false;

    const reqBody = {
      model: modelName,
      messages,
      stream: true,
      options: {
        temperature: 0.7,
        num_ctx: 8192,
        // Uncapped on tool-call steps; capped at 2048 on synthesis steps
        num_predict: finalWindow ? 2048 : -1
      }
    };
    if (enableTools) reqBody.tools = AGENT_TOOLS;

    let res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => String(res.status));
      if (enableTools && (errText.includes('does not support tools') || errText.includes('tools'))) {
        // Model does not support the tools API — fallback to plain generation
        enableTools = false;
        delete reqBody.tools;
        res = await fetch(`${OLLAMA_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody)
        });
      }
      if (!res.ok || !res.body) {
        const finalErr = res.ok ? '' : await res.text().catch(() => String(res.status));
        throw new Error(`Ollama chat failed: ${finalErr || errText}`);
      }
    }

    // ── Stream this iteration ───────────────────────────────────────────────
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let toolCalls = [];

    // Buffer content tokens; only forwarded to onToken when this turn is confirmed
    // as a final answer — prevents raw tool-call JSON from appearing in the chat UI.
    const tokenBuffer = [];
    lastTokenBuffer = tokenBuffer;
    const parser = new ThinkTagStreamParser((t) => tokenBuffer.push(t), onReasoningToken);

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
            if (token) { fullContent += token; parser.process(token); }
            if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0) {
              toolCalls.push(...chunk.message.tool_calls);
            }
          }
        } catch {}
      }
    }
    parser.flush();
    lastFullContent = fullContent;

    // ── Determine active tool calls for this turn ───────────────────────────
    // Deduplicate structured tool calls to prevent infinite loops
    const uniqueToolCalls = toolCalls.map((call) => ({
      ...call,
      function: { ...call.function, arguments: normalizeToolArguments(call.function?.arguments) }
    })).filter((call) => {
      const key = `${call.function.name}:${JSON.stringify(call.function.arguments || {})}`;
      if (executedToolKeys.has(key)) return false;
      executedToolKeys.add(key);
      return true;
    });

    let activeCalls = uniqueToolCalls;

    if (activeCalls.length === 0) {
      // No structured tool calls — check if the model emitted a call as plain text
      const detectedTextToolCalls = extractTextToolCalls(fullContent);
      const textToolCalls = detectedTextToolCalls.filter((call) => {
        const key = `${call.function.name}:${JSON.stringify(call.function.arguments || {})}`;
        if (executedToolKeys.has(key)) return false;
        executedToolKeys.add(key);
        return true;
      });

      if (textToolCalls.length === 0) {
        // A repeated tool call is not a final answer. Ask the model to synthesize
        // from the existing result instead of displaying the duplicate JSON.
        const repeatedToolCall = toolCalls.length > 0 || detectedTextToolCalls.length > 0;
        if (repeatedToolCall) {
          messages.push({ role: 'assistant', content: fullContent });
          messages.push({
            role: 'user',
            content: 'The requested tool call was already completed. Do not call any tool again. Write the complete final answer using the tool results already provided.'
          });
          onStatus({ icon: '🧾', text: 'Preparing the final answer from the retrieved results…' });
          continue;
        }

        // ✅ Genuine final answer — flush buffered tokens to the UI
        for (const t of tokenBuffer) onToken(t);
        onStatus({ icon: '✨', text: 'Final answer synthesized.' });
        return fullContent;
      }

      // Text-based tool calls found — discard buffer so raw JSON stays hidden
      activeCalls = textToolCalls;
    }
    // For structured tool calls the model sends empty content, so the buffer
    // is naturally empty — no discard needed.

    // ── Execute tool calls ──────────────────────────────────────────────────
    messages.push({ role: 'assistant', content: fullContent, tool_calls: activeCalls });

    for (const call of activeCalls) {
      const toolResult = await executeTool(
        call.function.name,
        normalizeToolArguments(call.function.arguments),
        onStatus
      );
      messages.push({ role: 'tool', content: JSON.stringify(toolResult) });
    }

    // ── Inject internal self-reflection prompt ──────────────────────────────
    // This user-role message lives ONLY in the local messages array for this
    // generate() call. It is never streamed to the UI, never saved to the
    // session store, and never appears in future conversation history.
    const reflectionContent = finalWindow
      ? `IMPORTANT: The web research time budget is nearly exhausted. Do NOT call any more tools. ` +
        `Write the complete, accurate, well-structured final answer to the user's question right now. ` +
        `Use only the information found in the tool results above — do not fabricate anything.`
      : `Review the tool results you just received:\n` +
        `1. Do you have ALL the specific names, facts, items, dates, or data the user asked for?\n` +
        `2. Is anything still missing, vague, or unverified?\n\n` +
        `→ If MISSING: call the appropriate tool again with a more targeted query or a specific URL.\n` +
        `→ If COMPLETE: write the full, well-structured final answer now — do not call any more tools.\n\n` +
        `Continue researching only when a specific fact is still missing. Be decisive.`;

    messages.push({ role: 'user', content: reflectionContent });
    onStatus({ icon: '🔍', text: finalWindow ? 'Preparing the final answer…' : `Reviewing findings… (research pass ${step})` });
  }

  // Never expose a tool call if the research time budget expires while
  // repeating one. A clean fallback is safer than leaking raw JSON.
  if (extractTextToolCalls(lastFullContent).length === 0) {
    for (const t of lastTokenBuffer) onToken(t);
  } else {
    onToken('I could not complete the web-assisted answer within the available steps. Please try the request again.');
  }
  onStatus({ icon: '✨', text: 'Final answer synthesized.' });
  return lastFullContent;
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
  ThinkTagStreamParser,
  generate
};
