/**
 * agent-loop.js
 * ─────────────────────────────────────────────────────────────────────────
 * Drop-in replacement for "Phase 2: Agentic model loop" in ollama-client.js
 * (the section that used to run from the `while (step < maxSteps)` loop
 * down through `finalizeAnswer`). Everything BEFORE that phase (pre-research
 * self-checks) and the accuracy layers that wrap the final text
 * (checkAnswerGrounding / reviseAnswerForGrounding) are unaffected and stay
 * exactly where they are in ollama-client.js — this file only replaces the
 * orchestration loop itself.
 *
 * Built on the Vercel AI SDK ("ai" package) + the ai-sdk-ollama provider,
 * talking to Ollama's native tool-calling API instead of hand-parsing NDJSON
 * from /api/chat directly.
 *
 * ── DESIGN, v3 ──────────────────────────────────────────────────────────
 * Earlier versions of this file tried to steer the model with
 * `toolChoice: 'required'` + a narrowed `activeTools` list at various points
 * (forcing a read on step 0, forcing a mutation once a read had happened,
 * etc). Two problems with that, by explicit request:
 *
 *   1. It never actually worked. Ollama's /api/chat has no wire-level
 *      concept of forced tool choice — ai-sdk-ollama's own request builder
 *      only ever sends the `tools` list and silently drops `toolChoice`/
 *      `activeTools` entirely. So all that machinery was dead weight that
 *      LOOKED like enforcement but wasn't.
 *   2. Even if it had worked, narrowing which tools the model is allowed to
 *      pick from at a given step is a restriction the model doesn't get a
 *      say in. The model should be free to use any tool it has, whenever it
 *      judges it needs it — the only real restriction is that workspace/git
 *      tools don't exist in the toolset AT ALL when no workspace is
 *      selected (handled by buildToolSet below, once, before the loop ever
 *      starts — nothing about which tool to call next is ever narrowed).
 *
 * So this version drops toolChoice/activeTools forcing entirely, and
 * replaces the old rules-based "did you skip a read? did you skip a write?"
 * corrective retry (which tried to diagnose exactly what the model missed
 * and tell it which tool to call) with a single, neutral continuation
 * check: when a turn plausibly needed real action and the model stopped
 * without any tool call backing that up, ask it plainly whether the task is
 * actually finished — and if not, let IT decide what to do next and keep
 * going, rather than the code deciding on its behalf. This repeats up to
 * `continueRetriesLeft` times, which is intentionally generous (not
 * literally infinite — an actually-unbounded loop is a real runaway-cost/
 * hung-process risk on a local machine if a model gets stuck restating
 * itself, so this is the pragmatic version of "keep going until done").
 * ───────────────────────────────────────────────────────────────────────── */

const { streamText, tool, stepCountIs } = require('ai');
const { ollama } = require('ai-sdk-ollama');
const { z } = require('zod');

// Still needed: (a) to gate whether it's worth offering the model a
// continuation turn at all (see continueRetriesLeft below) — not to
// restrict which tool it may call — and (b) ollama-client.js's own separate
// copy of this set still drives the real user-facing approval modal for
// destructive actions, which is untouched by any of this.
const PERMISSION_REQUIRED_TOOLS = new Set([
  'write_file', 'edit_file', 'delete_file',
  'git_add', 'git_commit', 'git_checkout', 'git_branch'
]);
const SEARCH_TOOLS = new Set(['web_search', 'fetch_web_page']);
const ALL_KNOWN_TOOLS = [
  'web_search', 'fetch_web_page', 'get_current_time',
  'list_chat_resources', 'read_chat_resource',
  'read_file', 'list_directory', 'search_files', 'write_file', 'edit_file', 'delete_file',
  'git_status', 'git_log', 'git_diff', 'git_add', 'git_commit', 'git_checkout', 'git_branch'
];

/**
 * Short, one-line "what actually happened" summary of a tool result, for
 * the progress log fed back to the model at every follow-up turn (see
 * progressLogSoFar). Truncated hard — this is a running recap, not a
 * transcript; the model already has the full result in its own context
 * from the turn it actually happened in.
 */
function summarizeToolResult(name, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const short = clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
  return `${name} → ${short || '(no output)'}`;
}


/**
 * Wraps every JSON-schema tool definition + its existing executeTool(...)
 * call into an AI-SDK `tool()`. executeTool itself is untouched — this is
 * purely an adapter, so every existing behavior inside it (permission
 * prompts via onRequestPermission, the write_file/edit_file self-checks,
 * normalizeToolArgs) keeps working exactly as before.
 */
function buildToolSet({ executeTool, onStatus, workspaceDir, onRequestPermission, modelName, userText }) {
  const def = (name, description, shape) => tool({
    description,
    inputSchema: z.object(shape),
    // NOTE: no `execute` throws for a denied/errored tool — executeTool()
    // already returns a string like "ERROR: ..." on failure, and we want
    // that string to go back to the MODEL as the tool result (so it can
    // react to it), not to blow up the stream. So we never throw here.
    execute: async (args) => executeTool(name, args, onStatus, workspaceDir, onRequestPermission, modelName, userText)
  });

  const tools = {
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

  // ── The ONLY restriction: workspace/git tools simply don't exist in the
  // toolset unless a workspace folder is selected. Once they do exist,
  // nothing further narrows which of them the model may call, or when.
  if (workspaceDir) {
    Object.assign(tools, {
      read_file: def('read_file',
        'Read a text file inside the selected workspace folder. Big files are returned in parts; ' +
        'the reply tells you the start_line to use for the next part.',
        {
          rel_path: z.string().describe('Relative path of file within workspace folder'),
          start_line: z.coerce.number().int().optional().describe('First line to read (default 1)'),
          end_line: z.coerce.number().int().optional().describe('Last line to read (default: as much as fits)')
        }),
      list_directory: def('list_directory', 'List contents of a directory inside the selected workspace folder.',
        { rel_path: z.string().optional().describe('Relative directory path inside workspace (default ".")') }),
      search_files: def('search_files', 'Search for files by filename or text content within the workspace.',
        { query: z.string().describe('Text or filename pattern to search for') }),
      write_file: def('write_file',
        'Create a NEW file inside the selected workspace folder. Replacing an existing file is only allowed ' +
        'after reading all of it with read_file; to change part of an existing file use edit_file instead.',
        { rel_path: z.string(), content: z.string() }),
      edit_file: def('edit_file', 'Change part of an existing file: replace target_text (copied exactly from read_file output) with replacement_text. target_text must match exactly once unless replace_all is set.',
        { rel_path: z.string(), target_text: z.string(), replacement_text: z.string(), replace_all: z.boolean().optional() }),
      delete_file: def('delete_file', 'Delete a file, or a folder, inside the workspace. Non-empty folders require recursive=true.',
        { rel_path: z.string(), recursive: z.boolean().optional() }),
      git_status: def('git_status', 'Get the status of the workspace Git repository.', {}),
      git_log: def('git_log', 'Get recent commit logs.', { count: z.number().optional() }),
      git_diff: def('git_diff', 'Get uncommitted diff changes.', {}),
      git_add: def('git_add', 'Stage changed files for commit.', { files: z.string().optional() }),
      git_commit: def('git_commit', 'Create a new Git commit with staged changes.', { message: z.string() }),
      git_checkout: def('git_checkout', 'Checkout branch or discard file modifications.', { target: z.string() }),
      git_branch: def('git_branch', 'List or create Git branches.', { name: z.string().optional() })
    });
  }

  return tools;
}

/**
 * Finds the substring of `text` starting at index `start` that is a single,
 * fully-balanced JSON object (matching the { at `start` to its true closing
 * `}`), correctly skipping over braces that appear inside quoted strings.
 * Ported from the original file's fallback parser — same algorithm, still
 * needed for the same reason: models don't always put the JSON at the very
 * start of the response.
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

// Argument keys we know how to recognize across every tool this app
// defines (see buildToolSet above), plus the alias names normalizeToolArgs()
// in ollama-client.js already accepts. Kept short/bare on purpose: unlike
// argument *values* (which can be entire files of HTML/code and often
// contain un-escaped quotes — see looseParseFallbackObject below), a model
// never has a reason to put a quote inside a JSON *key*, so matching on
// this list is reliable even when the surrounding text isn't valid JSON.
const KNOWN_ARG_KEYS = [
  'rel_path', 'path', 'filepath', 'file', 'filename', 'dir', 'directory', 'folder',
  'target_file', 'targetFile', 'query', 'search', 'pattern', 'term', 'q', 'text', 'keyword',
  'url', 'content', 'body', 'code', 'file_content', 'data',
  'target_text', 'target', 'old_text', 'search_text', 'find', 'original',
  'replacement_text', 'replacement', 'new_text', 'replace_with', 'replace', 'with',
  'replace_all', 'recursive', 'files', 'message', 'count', 'name',
  // read_chat_resource
  'file_name', 'pages', 'page', 'page_start', 'page_end', 'start_line', 'end_line', 'char_offset', 'search_query'
];
const KNOWN_ARG_KEY_PATTERN = new RegExp(String.raw`(?:^|[\s{,])"(${KNOWN_ARG_KEYS.join('|')})"\s*:\s*`, 'g');

/**
 * Splits a (possibly JSON-invalid) `{...}` arguments object into key/value
 * pairs by locating each KNOWN key and taking everything up to the START of
 * the next known key (or the end of the object) as that key's raw value —
 * instead of relying on quote-balance, which is exactly what's broken in
 * the text this function is built to handle. Values are unwrapped from a
 * single pair of surrounding quotes when present and have the standard JSON
 * escapes (\n \t \" \\) undone, but any OTHER quote inside the value (e.g.
 * an un-escaped HTML attribute like lang="en") is left completely alone —
 * which is exactly what we want, since it's file content, not JSON syntax.
 */
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

/**
 * Recovers a {"name": ..., "arguments": {...}} tool call from text that
 * FAILED strict JSON.parse — the overwhelmingly common cause being a
 * free-text argument (write_file's content, edit_file's target_text /
 * replacement_text) that contains raw, un-escaped double quotes, e.g. a
 * whole HTML file with `lang="en"`-style attributes. There's no way to
 * represent that as valid JSON without escaping, and small local models
 * routinely just don't — but the call itself is still fully recoverable,
 * since the tool name and every argument KEY are short bare identifiers
 * with no quotes inside them. objStr is expected to be brace-balanced per
 * extractBalancedObject's own (best-effort) counting, so its arguments
 * object is the last property before objStr's own final closing brace.
 */
function looseParseFallbackObject(objStr) {
  const nameMatch = objStr.match(/"name"\s*:\s*"([a-zA-Z0-9_]+)"/);
  if (!nameMatch) return null;

  const argsKeyMatch = objStr.match(/"(arguments|parameters)"\s*:\s*/);
  if (!argsKeyMatch) return { name: nameMatch[1], arguments: {} };

  const braceStart = objStr.indexOf('{', argsKeyMatch.index + argsKeyMatch[0].length);
  if (braceStart === -1) return { name: nameMatch[1], arguments: {} };

  // Trim objStr's own outer closing brace (the last char) so what remains
  // ends with the arguments object's OWN closing brace, as looseParseArguments expects.
  const argsSpan = objStr.slice(braceStart, objStr.length - 1).trimEnd();
  return { name: nameMatch[1], arguments: looseParseArguments(argsSpan) };
}

/**
 * Detects a tool call a model printed as JSON TEXT instead of making a real
 * structured tool call — e.g. "I'll fetch the weather now.\n\n{"name":
 * "web_search", "arguments": {...}}". This happens even with ai-sdk-ollama,
 * particularly on small models (this app's own default, gemma3:4b, does it)
 * — the provider fixes Ollama silently returning empty text after a real
 * tool call, but it can't make a small model reliably CHOOSE to use the
 * structured tool-calling protocol in the first place, and it doesn't
 * always put the JSON at the very start of its response either.
 *
 * Scans the whole text for a balanced {...} object (there can be lead-in
 * prose before it, as above) rather than requiring the ENTIRE text to be
 * JSON — but still only fires when a candidate object structurally looks
 * like a tool call (a `name` matching a real tool, plus an arguments/
 * parameters object), so it doesn't misfire on prose that merely contains
 * unrelated JSON. This is execution repair (the model already decided to
 * call a tool; we're making sure that decision actually runs), not
 * behavioral forcing — it stays regardless of the toolChoice removal above.
 */
/**
 * Detects tool calls a model printed as JSON TEXT instead of making real
 * structured tool calls — e.g. "I'll fetch the weather now.\n\n{"name":
 * "web_search", "arguments": {...}}\n{"name": "fetch_web_page", "arguments": {...}}".
 *
 * Scans the whole text for balanced {...} objects or arrays of tool call objects
 * rather than stopping at the first match. Returns an array of all valid tool calls found.
 */
function tryParseFallbackToolCalls(text, toolNames) {
  if (!text) return [];

  const calls = [];

  function extractCallsFromParsed(parsed) {
    if (!parsed) return;

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        extractCallsFromParsed(item);
      }
      return;
    }

    if (typeof parsed === 'object') {
      const name = parsed.name || parsed.tool || parsed.function?.name;
      let args = parsed.arguments || parsed.parameters || parsed.function?.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }

      if (name && typeof name === 'string' && toolNames.includes(name)) {
        calls.push({
          name,
          args: (typeof args === 'object' && args !== null) ? args : {}
        });
        return;
      }

      const innerList = parsed.tool_calls || parsed.calls || parsed.functions || parsed.tools;
      if (Array.isArray(innerList)) {
        for (const item of innerList) {
          extractCallsFromParsed(item);
        }
      }
    }
  }

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;

    const objStr = extractBalancedObject(text, i);
    if (!objStr) continue;

    let parsed;
    try {
      parsed = JSON.parse(objStr);
    } catch {
      // Strict parse failed — almost always an un-escaped quote inside a
      // free-text argument (see looseParseFallbackObject's comment above).
      // Try to recover the call anyway instead of dumping the broken JSON
      // text straight to the user as if it were the actual answer.
      parsed = looseParseFallbackObject(objStr);
      if (!parsed) continue; // genuinely not shaped like a tool call — keep scanning
    }

    const initialCount = calls.length;
    extractCallsFromParsed(parsed);

    if (calls.length > initialCount) {
      i += objStr.length - 1;
    }
  }

  return calls;
}

function tryParseFallbackToolCall(text, toolNames) {
  const calls = tryParseFallbackToolCalls(text, toolNames);
  return calls.length > 0 ? calls[0] : null;
}

/**
 * Replaces the entire hand-rolled `while (step < maxSteps)` block: NDJSON
 * parsing, tool-call dedup, fallback inline-JSON detection, the
 * consecutive-tool-failure retry, and the gap-based nudge system.
 *
 * @returns {Promise<string>} the final answer text (un-grounding-checked —
 *   callers still run finalizeAnswer/checkAnswerGrounding on the result,
 *   same as before).
 */
async function runAgentLoop({
  modelName,
  systemContent,
  messages,             // prior conversation turns, role/content pairs — same shape buildMessages() already produces
  userText,
  workspaceDir,
  executeTool,
  onToken   = () => {},
  onStatus  = () => {},
  onRequestPermission = null,
  // Generous room for the model to work across many steps within a single
  // streamText call (this only bounds how far the SDK's own automatic
  // tool-call-then-continue loop can run; the model decides every single
  // step, on its own, whether to call another tool or stop).
  maxSteps  = 40,
  maxTotalMs = 600000, // 10 minutes total for the whole agent loop, across all continuation turns
  intendsMutation = false,     // only gates whether a continuation nudge is worth offering (see below) — never restricts tool choice
  needsWorkspaceRead = false,  // same
  model = ollama(modelName), // overridable for tests (see agent-loop.test.js)
  onError = () => {},
  fallbackRetriesLeft = 3,   // bounded retries for the "printed a tool call as text" case below —
                             // bumped from 1: a single budget shared across a long continuation
                             // chain (see continueRetriesLeft) was exhausting on the FIRST
                             // recovery, leaving nothing to catch a later, unrelated instance of
                             // the same problem — see the unconditional safety net near the
                             // bottom of this function for the true last-resort backstop
  continueRetriesLeft = 3,   // bounded "are you actually done?" nudges. Lowered from 6: identical
                             // nudges past the first couple showed diminishing returns (a model
                             // that isn't converging generally isn't converging on try 5 either)
                             // — better to fail fast into the safety net below than burn 6 rounds
  mutationConfirmedSoFar = false, // cumulative, OBJECTIVE record of whether a mutating tool has
                                  // actually succeeded anywhere in this call chain so far — never
                                  // set by trusting the model's own claims, only by a real
                                  // "SUCCESS"-prefixed tool result. See the honesty check below.
  lastMutationResultSoFar = null, // the actual "SUCCESS: ..." text from the most recent
                                  // successful mutation in this chain, if any — used to give the
                                  // user a real, specific confirmation instead of either a vague
                                  // placeholder or (the bug this fixes) a raw file dump, if the
                                  // model wanders off after the real work is already done
  progressLogSoFar = [] // NEW: cumulative "toolName → short result summary" entries across the
                        // whole chain, regardless of recursion depth or which path a call was
                        // recovered through. Fed back into every follow-up message below so the
                        // model gets an automatic, code-generated recap of what it's actually
                        // done so far — the "revise the plan after each tool" the user asked
                        // for, implemented at the code level rather than left to a weak model's
                        // own discipline to remember to do it.
}) {
  const tools = buildToolSet({ executeTool, onStatus, workspaceDir, onRequestPermission, modelName, userText });
  const researchLog = [];

  const result = streamText({
    model,
    system: systemContent,
    messages: [...messages],
    tools,
    stopWhen: stepCountIs(maxSteps),
    timeout: maxTotalMs, // replaces the manual Date.now()-startedAt budget check
    onError,
    prepareStep: async () => {
      // Reset the status line at the START of each step, before the model
      // call — matches the original loop's `onStatus({ type: 'reset' })` at
      // the top of each `while` iteration. The per-tool messages themselves
      // ("Reading file: X", "Requesting permission…") come from inside
      // executeTool() and fire live, in real time, as each tool actually
      // runs — not from here. Nothing else happens here on purpose: no
      // toolChoice, no activeTools narrowing — every tool is available at
      // every step, and the model alone decides what (if anything) to call.
      onStatus({ type: 'reset' });
      return {};
    },
    onStepFinish: (step) => {
      for (const r of step.toolResults || []) {
        if (SEARCH_TOOLS.has(r.toolName) && typeof r.output === 'string') researchLog.push(r.output);
      }
    }
  });

  // FIX: "it's stuck" reports traced to this exact point — there was NO
  // feedback at all between this status line appearing and the entire next
  // model call finishing, which can genuinely take minutes on a local model
  // once the context has grown (a full file's content, the plan, prior tool
  // results and nudges all accumulate turn over turn — see the design note
  // for why continueRetriesLeft/fallbackRetriesLeft are bounded rather than
  // literally infinite). There IS a real, enforced ceiling on this already
  // (maxTotalMs becomes a genuine AbortSignal.timeout inside the AI SDK, not
  // a decorative option — confirmed directly against the installed
  // package), so this was never a true infinite hang, just a long silent
  // wait with nothing telling the user that. This heartbeat doesn't change
  // timing or behavior at all — it just proves the process is still alive
  // while a single (possibly slow) generation is in flight.
  // `type: 'progress'` tells the UI to update ONE live row in place rather
  // than appending a new step every 6 seconds (which used to fill the
  // Thought Process box with dozens of identical lines on long generations).
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

  let streamBuffer = '';
  let streamFlushed = false;

  try {
    for await (const part of result.textStream) {
      if (streamFlushed) {
        onToken(part);
      } else {
        streamBuffer += part;
        if (streamBuffer.length >= 40 || streamBuffer.includes('\n')) {
          const trimmed = streamBuffer.trim();
          const looksLikeToolCall = /^\s*\{\s*"(name|tool|function)"\s*:/i.test(trimmed);
          if (!looksLikeToolCall) {
            streamFlushed = true;
            onToken(streamBuffer);
            streamBuffer = '';
          }
        }
      }
    }
    if (!streamFlushed && streamBuffer) {
      const fakeTest = tryParseFallbackToolCalls(streamBuffer, Object.keys(tools));
      if (fakeTest.length === 0) {
        onToken(streamBuffer);
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  const finalText = await result.text;
  // Full accumulated trace across every step of THIS call — assistant tool
  // calls and their tool-result messages included. Used as the base for any
  // retry below so the model never loses ground (e.g. a file it already
  // read) it made earlier in this same turn.
  const stepMessages = await result.responseMessages;
  const toolCallsSoFar = await result.toolCalls;
  const toolResultsSoFar = await result.toolResults;

  // Real (SDK-driven) tool calls from THIS round, folded into the running
  // progress log fed back to the model on every follow-up turn.
  const progressLog = [
    ...progressLogSoFar,
    ...toolResultsSoFar.map((r) => summarizeToolResult(r.toolName, r.output))
  ];

  const thisRoundMutationResult = toolResultsSoFar.find(
    (r) => PERMISSION_REQUIRED_TOOLS.has(r.toolName) && typeof r.output === 'string' && r.output.startsWith('SUCCESS')
  );
  const mutationConfirmed = mutationConfirmedSoFar || Boolean(thisRoundMutationResult);
  const lastMutationResult = thisRoundMutationResult ? thisRoundMutationResult.output : lastMutationResultSoFar;

  // Recover tool call(s) the model printed as plain JSON text instead of a
  // real structured call.
  const fakes = fallbackRetriesLeft > 0
    ? tryParseFallbackToolCalls(finalText, ALL_KNOWN_TOOLS)
    : [];

  if (fakes.length > 0) {
    onStatus({ type: 'reset' });
    onStatus({
      icon: '🛠️',
      text: fakes.length === 1
        ? `Model printed a "${fakes[0].name}" call as plain text instead of a real tool call — running it directly and asking for a real answer…`
        : `Model printed ${fakes.length} tool calls as plain text — running them directly…`
    });

    const executedResults = [];
    const progressLogWithFake = [...progressLog];
    let fakeMutationSucceededAny = false;

    for (const fake of fakes) {
      onStatus({
        icon: '🛠️',
        text: `Running recovered tool: ${fake.name}…`
      });
      const toolResultText = await executeTool(fake.name, fake.args, onStatus, workspaceDir, onRequestPermission, modelName, userText);
      const resultAsText = typeof toolResultText === 'string' ? toolResultText : JSON.stringify(toolResultText);
      if (SEARCH_TOOLS.has(fake.name)) researchLog.push(resultAsText);
      const fakeMutationSucceeded = PERMISSION_REQUIRED_TOOLS.has(fake.name) && resultAsText.startsWith('SUCCESS');
      if (fakeMutationSucceeded) fakeMutationSucceededAny = true;
      progressLogWithFake.push(summarizeToolResult(fake.name, resultAsText));
      executedResults.push({ name: fake.name, result: resultAsText });
    }

    const resultsSummary = executedResults.map(r => `Result of ${r.name}:\n${r.result}`).join('\n\n');
    const lastFakeMutation = [...executedResults].reverse().find(r => PERMISSION_REQUIRED_TOOLS.has(r.name) && r.result.startsWith('SUCCESS'));
    const newLastMutationResult = lastFakeMutation ? lastFakeMutation.result : lastMutationResult;

    const followUpPrompt = intendsMutation
      ? `That was printed as plain text, not a real tool call, so nothing ran automatically from it. ` +
        `I ran the tool(s) for you directly — here are the actual results:\n\n${resultsSummary}\n\n` +
        `Progress so far on this task:\n${progressLogWithFake.map((e) => `- ${e}`).join('\n')}\n\n` +
        `Check that against your plan: what's actually done, and what's genuinely still left? Continue from here ` +
        `using any tool you still need. Once everything requested is genuinely done (any file changes really saved), give me a short final answer.`
      : `That was printed as plain text, not a real tool call. ` +
        `I ran the tool(s) for you directly — here are the actual results:\n\n${resultsSummary}\n\n` +
        `Now, answer the user's request: "${userText}" clearly and directly using the results above.`;

    const followUpMessages = [
      ...messages,
      ...stepMessages,
      {
        role: 'user',
        content: followUpPrompt
      }
    ];

    const retryResult = await runAgentLoop({
      modelName, systemContent, messages: followUpMessages, userText, workspaceDir, executeTool,
      onToken, onStatus, onRequestPermission, maxSteps, maxTotalMs, intendsMutation, needsWorkspaceRead,
      model, onError,
      fallbackRetriesLeft: fallbackRetriesLeft - 1,
      continueRetriesLeft,
      mutationConfirmedSoFar: mutationConfirmed || fakeMutationSucceededAny,
      lastMutationResultSoFar: newLastMutationResult,
      progressLogSoFar: progressLogWithFake
    });
    return { text: retryResult.text, researchLog: [...researchLog, ...retryResult.researchLog] };
  }

  // ── The single continuation check (replaces the old rules-based forced
  // retry system) ────────────────────────────────────────────────────────
  const anyToolCalled = toolCallsSoFar.length > 0 || progressLog.length > 0;
  const plausiblyUnfinished =
    (needsWorkspaceRead && !anyToolCalled) ||
    (intendsMutation && !mutationConfirmed);

  if (continueRetriesLeft > 0 && plausiblyUnfinished && finalText && finalText.trim()) {
    onStatus({ icon: '🔁', text: 'Checking whether the task is actually finished…' });

    const progressRecap = progressLog.length > 0
      ? `Progress so far on this task:\n${progressLog.map((e) => `- ${e}`).join('\n')}\n\n`
      : '';

    let continuationInstruction;
    if (intendsMutation) {
      continuationInstruction = `Check that against your plan: before you finish, has everything I actually asked for been DONE — meaning any file changes were really saved through a real tool call? If yes, give your short final confirmation. If no, call whatever tool(s) you judge necessary yourself right now.`;
    } else if (needsWorkspaceRead && !anyToolCalled) {
      continuationInstruction = `You have not read or inspected any workspace files yet for the request: "${userText}". Please call the appropriate workspace tool (such as read_file or list_directory) right now to read the actual project files before providing your final answer.`;
    } else {
      continuationInstruction = `Now, please answer the user's request: "${userText}" directly using the information gathered above.`;
    }

    const followUpMessages = [
      ...messages,
      ...stepMessages,
      {
        role: 'user',
        content: `${progressRecap}${continuationInstruction}`
      }
    ];

    const retryResult = await runAgentLoop({
      modelName, systemContent, messages: followUpMessages, userText, workspaceDir, executeTool,
      onToken, onStatus, onRequestPermission, maxSteps, maxTotalMs, intendsMutation, needsWorkspaceRead,
      model, onError,
      fallbackRetriesLeft,
      continueRetriesLeft: continueRetriesLeft - 1,
      mutationConfirmedSoFar: mutationConfirmed,
      lastMutationResultSoFar: lastMutationResult,
      progressLogSoFar: progressLog
    });
    return { text: retryResult.text, researchLog: [...researchLog, ...retryResult.researchLog] };
  }

  const { text: finalizedText, mutationConfirmed: mutationConfirmedAfterStranded } = await finalizeStrandedToolCall(
    finalText, tools, researchLog, mutationConfirmed, lastMutationResult,
    { executeTool, onStatus, workspaceDir, onRequestPermission, modelName, userText }
  );

  // FIX: the actual honesty backstop. If the task genuinely needed a
  // mutation and NOTHING in this entire chain (any recursion depth, any
  // recovery path) ever confirmed one succeeding, don't let the model's own
  // "yes, it's done" — or any other unverified final text — go to the user
  // unchallenged. This doesn't rewrite or second-guess what the model said;
  // it appends an objective, factual note alongside it, since silently
  // reporting success on a change that never happened is worse than being
  // upfront that it didn't.
  const finalMutationConfirmed = mutationConfirmedAfterStranded;
  const dishonestSuccessRisk = intendsMutation && !finalMutationConfirmed && finalizedText && finalizedText.trim();

  return {
    text: dishonestSuccessRisk
      ? `${finalizedText}\n\n⚠️ Heads up: I can't confirm a file-changing tool call actually succeeded during this — ` +
        `despite the reply above, the change may NOT have been saved. Worth checking the file yourself, or asking ` +
        `again more directly.`
      : finalizedText,
    researchLog
  };
}

/**
 * Unconditional last-resort safety net, deliberately independent of
 * fallbackRetriesLeft/continueRetriesLeft entirely — it runs no matter which
 * budget ran out or why. This is what problem #1 in this app's early
 * debugging was originally about: a raw, un-run `{"name": ..., "arguments":
 * {...}}` blob must never be the literal text shown to the user. The
 * bounded recovery above (the `fake` branch) is the FIRST line of defense
 * and gives the model a real follow-up turn to keep working afterward; this
 * is the backstop for when that budget was already spent earlier in a long
 * continuation chain and a later, unrelated instance of the same mistake
 * slipped through uncaught. No further recursion here on purpose — this is
 * the end of the line, so it just runs the call once and folds the result
 * into the text rather than looping again.
 *
 * FIX: this used to show the RECOVERED CALL'S RAW OUTPUT as the final
 * answer unconditionally — fine for a mutating tool (its result IS a short,
 * meaningful confirmation like `SUCCESS: File "index.html" updated
 * successfully.`), but genuinely bad for a read/list/search/git-info tool,
 * whose output is meant for the MODEL to reason over, not for a user to
 * read directly (a stray recovered read_file could dump an entire file's
 * contents as the "answer" — exactly what was happening here). So this now
 * branches on what kind of tool was stranded:
 *   - a MUTATING tool → still show its (short) real result directly, same as before.
 *   - an INFORMATIONAL tool (read_file, list_directory, search_files, any
 *     git_* read, get_current_time, etc.) → never dump its raw output.
 *     If a mutation already succeeded earlier in this chain, surface THAT
 *     real result instead (the user gets an honest, specific confirmation
 *     of the actual completed work, not noise from an incidental extra
 *     read). If nothing ever mutated, say so plainly and briefly — the
 *     honesty check in runAgentLoop appends the fuller warning on top of this.
 */
async function finalizeStrandedToolCall(finalText, tools, researchLog, mutationConfirmedSoFar, lastMutationResultSoFar, ctx) {
  const strandedList = tryParseFallbackToolCalls(finalText, ALL_KNOWN_TOOLS);
  if (strandedList.length === 0) return { text: finalText, mutationConfirmed: mutationConfirmedSoFar };

  let mutationConfirmed = mutationConfirmedSoFar;
  let lastMutationResult = lastMutationResultSoFar;
  const executedList = [];
  let hasMutation = false;

  for (const stranded of strandedList) {
    ctx.onStatus({ type: 'reset' });
    ctx.onStatus({
      icon: '🛠️',
      text: `Recovering a stranded "${stranded.name}" call that slipped through as plain text — running it now…`
    });
    const strandedResult = await ctx.executeTool(
      stranded.name, stranded.args, ctx.onStatus, ctx.workspaceDir, ctx.onRequestPermission, ctx.modelName, ctx.userText
    );
    const strandedResultText = typeof strandedResult === 'string' ? strandedResult : JSON.stringify(strandedResult);
    if (SEARCH_TOOLS.has(stranded.name)) researchLog.push(strandedResultText);

    const strandedIsMutation = PERMISSION_REQUIRED_TOOLS.has(stranded.name);
    const strandedMutationSucceeded = strandedIsMutation && strandedResultText.startsWith('SUCCESS');
    if (strandedMutationSucceeded) {
      mutationConfirmed = true;
      lastMutationResult = strandedResultText;
    }
    if (strandedIsMutation) hasMutation = true;
    executedList.push({ name: stranded.name, isMutation: strandedIsMutation, resultText: strandedResultText });
  }

  if (hasMutation) {
    const combined = executedList.map(e => e.resultText).join('\n\n');
    return {
      text: `${combined}\n\n(Note: ran automatically — the model's own final reply printed call(s) ` +
        `as text instead of real tool calls, so they were recovered here rather than shown as-is.)`,
      mutationConfirmed
    };
  }

  // Informational tools: never surface raw output as the answer.
  if (mutationConfirmed) {
    const confirmation = lastMutationResult || 'The requested change was saved successfully.';
    return {
      text: `${confirmation}\n\n(Note: the model went on to perform additional check(s) afterward ` +
        `— the change above had already been completed.)`,
      mutationConfirmed
    };
  }

  return {
    text: `I wasn't able to finish this — the last action was informational checking, but no file ` +
      `change was ever actually saved.`,
    mutationConfirmed
  };
}

module.exports = {
  runAgentLoop,
  buildToolSet,
  PERMISSION_REQUIRED_TOOLS,
  tryParseFallbackToolCall,
  tryParseFallbackToolCalls,
  looseParseFallbackObject,
  looseParseArguments
};