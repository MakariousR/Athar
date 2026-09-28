/**
 * agent-loop.js
 * ─────────────────────────────────────────────────────────────────────────
 * The tool-using answer loop, built on the Vercel AI SDK ("ai") + the
 * ai-sdk-ollama provider (Ollama's native tool-calling API).
 *
 * Every tool the model can call is READ-ONLY: web search/fetch, the time,
 * the chat's attached files, and — when the user has picked a project
 * folder — reading/listing/searching that folder and viewing git history.
 * Nothing here can change the user's files.
 *
 * Small local models often PRINT a tool call as JSON text instead of making
 * a real structured call. That is recovered here (the call is run and the
 * model is asked again with the result), and raw tool-call JSON is never
 * shown to the user as if it were the answer.
 * ───────────────────────────────────────────────────────────────────────── */

const { streamText, tool, stepCountIs } = require('ai');
const { ollama } = require('ai-sdk-ollama');
const { z } = require('zod');

const SEARCH_TOOLS = new Set(['web_search', 'fetch_web_page']);
// Only real web results count as research — not errors, and not the tools refusing
// (Search off, or a question about the user's own chats)
const isWebResult = (text) => typeof text === 'string' && text.trim() &&
  !/^(ERROR:|Web access is turned OFF|This question is about the user)/.test(text.trim());
const ALL_KNOWN_TOOLS = [
  'search_memory', 'web_search', 'fetch_web_page', 'get_current_time',
  'list_chat_resources', 'read_chat_resource',
  'read_file', 'list_directory', 'search_files',
  'git_status', 'git_log', 'git_diff'
];

/** One-line recap of a tool result for the progress log fed back to the model on retries. */
function summarizeToolResult(name, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const short = clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
  return `${name} → ${short || '(no output)'}`;
}

/**
 * Wraps each tool definition around executeTool(). executeTool returns
 * "ERROR: …" strings instead of throwing, so the model sees failures as
 * tool results it can react to rather than the stream blowing up.
 */
function buildToolSet({ executeTool, onStatus, workspaceDir, onRequestPermission, modelName, userText }) {
  const def = (name, description, shape) => tool({
    description,
    inputSchema: z.object(shape),
    execute: async (args) => executeTool(name, args, onStatus, workspaceDir, onRequestPermission, modelName, userText)
  });

  const tools = {
    search_memory: def('search_memory',
      'Search the user\'s own past conversations (imported ChatGPT/Claude/Gemini history and earlier chats in this app). ' +
      'Use when they ask what they discussed, decided, or asked before. Time and source hints in the query work, e.g. "database choice last spring" or "python tips in Claude".',
      { query: z.string().describe('What to look for, in a few words') }),
    web_search: def('web_search',
      'Search the internet for current facts, news, updates, and real-time data.',
      { query: z.string().describe('Concise search query') }),
    fetch_web_page: def('fetch_web_page',
      'Fetch and read the full content of a specific web page URL.',
      { url: z.string().describe('Full https:// URL of the page to fetch') }),
    get_current_time: def('get_current_time', 'Returns the current local date and time.', {}),
    list_chat_resources: def('list_chat_resources',
      'List the files attached to this chat (PDFs, text, code) with page counts and an outline of each.',
      {}),
    // z.coerce.number(): small models often send "2" instead of 2 — accept both instead of failing the call.
    read_chat_resource: def('read_chat_resource',
      'Read an attached file on demand. Give file_name plus ONE of: pages (e.g. "1-5" or "1-3,7,10-12" or "all" — read SEVERAL pages in one call) or page for documents/PDFs; ' +
      'start_line+end_line for code/text; search_query to find the most relevant passages (searches all attached files if file_name is omitted). ' +
      'With none of these you get the whole file if it is small, otherwise an outline and the first pages. ' +
      'Each call returns a limited amount; the reply says how to continue.',
      {
        file_name: z.string().optional().describe('Attached file name, e.g. "report.pdf". Optional if only one file is attached.'),
        pages: z.union([z.string(), z.number()]).optional().describe('Pages to read in ONE call: "1-5", "1-3,7,10-12", "all", or a single number. Prefer this for multi-page reading.'),
        page: z.coerce.number().int().optional().describe('1-based single page to read'),
        page_start: z.coerce.number().int().optional().describe('First page of a range'),
        page_end: z.coerce.number().int().optional().describe('Last page of a range'),
        start_line: z.coerce.number().int().optional().describe('First line to read (code/text files)'),
        end_line: z.coerce.number().int().optional().describe('Last line to read (code/text files)'),
        char_offset: z.coerce.number().int().optional().describe('Continue a long page from this character offset (given in the previous reply)'),
        search_query: z.string().optional().describe('Words or a question describing what to find inside the file(s)')
      })
  };

  // Project-folder tools exist only when the user has picked a folder. All read-only.
  if (workspaceDir) {
    Object.assign(tools, {
      read_file: def('read_file',
        'Read a text file inside the selected project folder. Big files are returned in parts; ' +
        'the reply tells you the start_line to use for the next part.',
        {
          rel_path: z.string().describe('Relative path of file within the project folder'),
          start_line: z.coerce.number().int().optional().describe('First line to read (default 1)'),
          end_line: z.coerce.number().int().optional().describe('Last line to read (default: as much as fits)')
        }),
      list_directory: def('list_directory', 'List the contents of a directory inside the selected project folder.',
        { rel_path: z.string().optional().describe('Relative directory path inside the project folder (default ".")') }),
      search_files: def('search_files', 'Search for files by filename or text content within the project folder.',
        { query: z.string().describe('Text or filename pattern to search for') }),
      git_status: def('git_status', 'Show the git status of the project folder (read-only).', {}),
      git_log: def('git_log', 'Show recent git commits of the project folder.', { count: z.coerce.number().int().optional() }),
      git_diff: def('git_diff', 'Show uncommitted changes in the project folder.', {})
    });
  }

  return tools;
}

// ─── Recovery of tool calls printed as text ──────────────────────────────────

/**
 * Finds the substring of `text` starting at `start` that is one balanced
 * JSON object, skipping braces inside quoted strings.
 */
function extractBalancedObject(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // never closed
}

// Argument keys recognised across all tools (plus the aliases normalizeToolArgs
// accepts). Keys never contain quotes, so matching on them works even when a
// value contains un-escaped quotes that break strict JSON.
const KNOWN_ARG_KEYS = [
  'rel_path', 'path', 'filepath', 'file', 'filename', 'dir', 'directory', 'folder',
  'query', 'search', 'pattern', 'term', 'q', 'text', 'keyword', 'url', 'link', 'count',
  'file_name', 'pages', 'page', 'page_start', 'page_end', 'start_line', 'end_line', 'char_offset', 'search_query'
];
const KNOWN_ARG_KEY_PATTERN = new RegExp(String.raw`(?:^|[\s{,])"(${KNOWN_ARG_KEYS.join('|')})"\s*:\s*`, 'g');

/** Splits a possibly JSON-invalid `{...}` arguments object on known keys. */
function looseParseArguments(argsObjStr) {
  const inner = argsObjStr.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  const matches = [...inner.matchAll(KNOWN_ARG_KEY_PATTERN)];
  const result = {};

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1];
    const valueStart = matches[i].index + matches[i][0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : inner.length;
    let raw = inner.slice(valueStart, valueEnd).replace(/[,}\s]+$/, '').trim();

    if (raw.startsWith('"')) {
      raw = raw.slice(1);
      if (raw.endsWith('"')) raw = raw.slice(0, -1);
      raw = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (raw === 'true' || raw === 'false') {
      raw = raw === 'true';
    } else if (raw !== '' && !isNaN(Number(raw))) {
      raw = Number(raw);
    }
    result[key] = raw;
  }
  return result;
}

/** Recovers {"name": ..., "arguments": {...}} from text that failed strict JSON.parse. */
function looseParseFallbackObject(objStr) {
  const nameMatch = objStr.match(/"name"\s*:\s*"([a-zA-Z0-9_]+)"/);
  if (!nameMatch) return null;

  const argsKeyMatch = objStr.match(/"(arguments|parameters)"\s*:\s*/);
  if (!argsKeyMatch) return { name: nameMatch[1], arguments: {} };

  const braceStart = objStr.indexOf('{', argsKeyMatch.index + argsKeyMatch[0].length);
  if (braceStart === -1) return { name: nameMatch[1], arguments: {} };

  const argsSpan = objStr.slice(braceStart, objStr.length - 1).trimEnd();
  return { name: nameMatch[1], arguments: looseParseArguments(argsSpan) };
}

/**
 * Finds every tool call a model printed as JSON text (objects, arrays of
 * calls, or {"tool_calls": [...]}) — only for names that are real tools, so
 * unrelated JSON in an answer is left alone.
 */
function tryParseFallbackToolCalls(text, toolNames) {
  if (!text) return [];
  const calls = [];

  function extractCallsFromParsed(parsed) {
    if (!parsed) return;
    if (Array.isArray(parsed)) { parsed.forEach(extractCallsFromParsed); return; }
    if (typeof parsed !== 'object') return;

    const name = parsed.name || parsed.tool || (parsed.function && parsed.function.name);
    let args = parsed.arguments || parsed.parameters || (parsed.function && parsed.function.arguments);
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    if (name && typeof name === 'string' && toolNames.includes(name)) {
      calls.push({ name, args: (typeof args === 'object' && args !== null) ? args : {} });
      return;
    }
    const innerList = parsed.tool_calls || parsed.calls || parsed.functions || parsed.tools;
    if (Array.isArray(innerList)) innerList.forEach(extractCallsFromParsed);
  }

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const objStr = extractBalancedObject(text, i);
    if (!objStr) continue;

    let parsed;
    try {
      parsed = JSON.parse(objStr);
    } catch {
      parsed = looseParseFallbackObject(objStr);
      if (!parsed) continue;
    }

    const before = calls.length;
    extractCallsFromParsed(parsed);
    if (calls.length > before) i += objStr.length - 1;
  }
  return calls;
}

function tryParseFallbackToolCall(text, toolNames) {
  const calls = tryParseFallbackToolCalls(text, toolNames);
  return calls.length > 0 ? calls[0] : null;
}

/** Removes printed tool-call JSON objects from text, leaving any real prose. */
function stripToolCallJson(text, toolNames) {
  let out = String(text || '');
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== '{') continue;
    const objStr = extractBalancedObject(out, i);
    if (!objStr) continue;
    if (tryParseFallbackToolCalls(objStr, toolNames).length > 0) {
      out = out.slice(0, i) + out.slice(i + objStr.length);
      i -= 1;
    }
  }
  return out.replace(/```(?:json)?\s*```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── The loop ────────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{ text: string, researchLog: string[] }>} the final answer
 *   (callers run the grounding check on it) and raw web research gathered.
 */
async function runAgentLoop({
  modelName,
  systemContent,
  messages,               // prior turns as ModelMessages
  userText,
  workspaceDir,
  executeTool,
  onToken   = () => {},
  onStatus  = () => {},
  onRequestPermission = null,
  maxSteps  = 40,         // bounds the SDK's own tool-call → continue loop within one call
  maxTotalMs = 600000,    // hard time limit per call (becomes an AbortSignal inside the SDK)
  needsWorkspaceRead = false, // question is explicitly about the project folder → nudge once if no tool was used
  useTools = true,            // false for models without tool calling (Ollama rejects tools for them)
  model = ollama(modelName),  // overridable for tests
  onError = () => {},
  fallbackRetriesLeft = 3,    // retries for "printed a tool call as text"
  continueRetriesLeft = 1,    // nudges when a project question was answered without looking
  progressLogSoFar = []       // "tool → result" recap across retries, fed back to the model
}) {
  const tools = useTools ? buildToolSet({ executeTool, onStatus, workspaceDir, onRequestPermission, modelName, userText }) : {};
  const toolNames = Object.keys(tools);
  const researchLog = [];

  // The SDK reports stream failures (e.g. Ollama's "model does not support
  // tools") only through onError and then a generic "No output generated".
  // Keep the real error so the caller — and the user — see what went wrong.
  let streamError = null;

  // Text streaming: tokens are held back until it's clear the step's output
  // isn't a printed tool call, so raw JSON doesn't flash up as the answer.
  // Reset at the start of EVERY step: an earlier step's prose must not let a
  // later step's printed JSON straight through.
  let streamBuffer = '';
  let streamFlushed = false;

  const result = streamText({
    model,
    system: systemContent,
    messages: [...messages],
    ...(useTools ? { tools } : {}),
    stopWhen: stepCountIs(maxSteps),
    timeout: maxTotalMs,
    onError: (event) => {
      streamError = (event && event.error) || event;
      onError(event);
    },
    prepareStep: async () => {
      onStatus({ type: 'reset' }); // UI clears text from the previous step
      streamBuffer = '';
      streamFlushed = false;
      return {};
    },
    onStepFinish: (step) => {
      for (const r of step.toolResults || []) {
        if (SEARCH_TOOLS.has(r.toolName) && isWebResult(r.output)) researchLog.push(r.output);
      }
    }
  });

  // Heartbeat so a slow local generation doesn't look frozen. `type: 'progress'`
  // makes the UI update one row in place instead of appending a new one.
  let heartbeatSeconds = 0;
  const heartbeat = setInterval(() => {
    heartbeatSeconds += 6;
    onStatus({
      type: 'progress',
      icon: '⏳',
      text: `Still generating… ${heartbeatSeconds}s on this step (local models are slower on long inputs; ` +
        `stops automatically after ${Math.round(maxTotalMs / 60000)} min if stuck)`
    });
  }, 6000);

  try {
    for await (const part of result.textStream) {
      if (streamFlushed) {
        onToken(part);
        continue;
      }
      streamBuffer += part;
      if (streamBuffer.length >= 40 || streamBuffer.includes('\n')) {
        const looksLikeToolCall = /^\s*(```(?:json)?\s*)?[[{]\s*"?(name|tool|function|tool_calls)"?\s*:/i.test(streamBuffer);
        if (!looksLikeToolCall) {
          streamFlushed = true;
          onToken(streamBuffer);
          streamBuffer = '';
        }
      }
    }
    if (!streamFlushed && streamBuffer && tryParseFallbackToolCalls(streamBuffer, ALL_KNOWN_TOOLS).length === 0) {
      onToken(streamBuffer);
    }
  } finally {
    clearInterval(heartbeat);
  }

  let finalText, stepMessages, toolCallsSoFar, toolResultsSoFar;
  try {
    finalText = await result.text;
    stepMessages = await result.responseMessages;
    toolCallsSoFar = await result.toolCalls;
    toolResultsSoFar = await result.toolResults;
  } catch (err) {
    // Replace the SDK's generic "No output generated" with the actual cause.
    if (streamError) {
      const cause = streamError.responseBody || streamError.message || String(streamError);
      throw new Error(typeof cause === 'string' ? cause.replace(/^\{"error":"(.*)"\}$/, '$1') : String(cause));
    }
    throw err;
  }

  const progressLog = [
    ...progressLogSoFar,
    ...toolResultsSoFar.map((r) => summarizeToolResult(r.toolName, r.output))
  ];

  const retry = (followUpContent, overrides) => runAgentLoop({
    modelName, systemContent, userText, workspaceDir, executeTool,
    onToken, onStatus, onRequestPermission, maxSteps, maxTotalMs, needsWorkspaceRead, useTools,
    model, onError, fallbackRetriesLeft, continueRetriesLeft,
    messages: [...messages, ...stepMessages, { role: 'user', content: followUpContent }],
    ...overrides
  });

  // Recover tool calls the model printed as plain JSON text.
  const fakes = fallbackRetriesLeft > 0 ? tryParseFallbackToolCalls(finalText, toolNames) : [];
  if (fakes.length > 0) {
    onStatus({ type: 'reset' });
    onStatus({
      icon: '🛠️',
      text: fakes.length === 1
        ? `Model printed a "${fakes[0].name}" call as plain text instead of a real tool call — running it directly…`
        : `Model printed ${fakes.length} tool calls as plain text — running them directly…`
    });

    const executed = [];
    for (const fake of fakes) {
      const out = await executeTool(fake.name, fake.args, onStatus, workspaceDir, onRequestPermission, modelName, userText);
      const outText = typeof out === 'string' ? out : JSON.stringify(out);
      if (SEARCH_TOOLS.has(fake.name) && isWebResult(outText)) researchLog.push(outText);
      executed.push({ name: fake.name, result: outText });
    }

    const progressWithFakes = [...progressLog, ...executed.map((e) => summarizeToolResult(e.name, e.result))];
    const resultsSummary = executed.map((e) => `Result of ${e.name}:\n${e.result}`).join('\n\n');
    const retryResult = await retry(
      `That was printed as plain text, not a real tool call. I ran it for you — here are the actual results:\n\n` +
      `${resultsSummary}\n\nNow answer the user's request: "${userText}" clearly and directly using these results. ` +
      `If you truly need another tool, call it properly.`,
      { fallbackRetriesLeft: fallbackRetriesLeft - 1, progressLogSoFar: progressWithFakes }
    );
    return { text: retryResult.text, researchLog: [...researchLog, ...retryResult.researchLog] };
  }

  // A question explicitly about the project folder answered without looking at
  // it: nudge once to actually read the files instead of guessing.
  const anyToolCalled = toolCallsSoFar.length > 0 || progressLog.length > 0;
  if (continueRetriesLeft > 0 && needsWorkspaceRead && !anyToolCalled && finalText && finalText.trim()) {
    onStatus({ icon: '🔁', text: 'Checking the project files before answering…' });
    const retryResult = await retry(
      `You have not looked at the project folder yet for the request: "${userText}". ` +
      `Call list_directory, read_file or search_files now to read the actual files, then answer.`,
      { continueRetriesLeft: continueRetriesLeft - 1, progressLogSoFar: progressLog }
    );
    return { text: retryResult.text, researchLog: [...researchLog, ...retryResult.researchLog] };
  }

  // Retry budget spent but the reply still contains printed tool calls:
  // never show raw JSON as the answer. Keep any real prose around it.
  if (tryParseFallbackToolCalls(finalText, ALL_KNOWN_TOOLS).length > 0) {
    const prose = stripToolCallJson(finalText, ALL_KNOWN_TOOLS);
    return {
      text: prose || 'Sorry — I couldn\'t finish working this out. Please try asking again, a bit more specifically.',
      researchLog
    };
  }

  return { text: finalText, researchLog };
}

module.exports = {
  runAgentLoop,
  buildToolSet,
  tryParseFallbackToolCall,
  tryParseFallbackToolCalls,
  stripToolCallJson,
  looseParseFallbackObject,
  looseParseArguments
};
