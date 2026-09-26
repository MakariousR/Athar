const { ipcMain: electronIpcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { parseDocumentFile, parseTextContent } = require('./parser/document-parser');
const ollama = require('./ollama/ollama-client');
const store  = require('./store/chat-store');
const { getMemory } = require('./memory');
const { tokenize } = require('./memory/bm25');

let activeWorkspacePath = null;
const pendingPermissions = new Map();

// Every IPC route can read local files, run tools, or approve its own tool
// permissions, so only our own bundled UI page may call them — never some
// other page that ended up in a window (see the navigation lock in index.js).
const TRUSTED_PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href.toLowerCase();

function isTrustedSender(event) {
  const frame = event.senderFrame;
  if (!frame || !frame.url) return false;
  const url = frame.url.split(/[?#]/)[0].toLowerCase();
  return url === TRUSTED_PAGE_URL;
}

const ipcMain = {
  handle(channel, listener) {
    electronIpcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        console.warn(`Blocked IPC "${channel}" from untrusted sender: ${event.senderFrame && event.senderFrame.url}`);
        return { success: false, error: 'Untrusted sender.' };
      }
      return listener(event, ...args);
    });
  },
  on(channel, listener) {
    electronIpcMain.on(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        console.warn(`Blocked IPC "${channel}" from untrusted sender: ${event.senderFrame && event.senderFrame.url}`);
        return;
      }
      listener(event, ...args);
    });
  }
};

/**
 * "Continue" handling: only when the user explicitly asks to continue AND
 * the previous reply actually looks cut off. Previously single words like
 * "next", "more" or "proceed" were rewritten into "continue your last reply
 * verbatim" — which broke real requests ("proceed" usually means "go ahead
 * with what you proposed", i.e. new work, not more of the same text).
 */
const CONTINUE_TRIGGERS = /^(please\s+)?(continue|go on|keep going|carry on|continue writing|finish it|complete it|finish (the|your) (answer|response|reply))(\s+please)?[.!]?$/i;

function looksCutOff(text) {
  const t = String(text || '').trimEnd();
  if (!t) return false;
  if (((t.match(/```/g) || []).length) % 2 === 1) return true; // unclosed code block
  // Finished replies usually end in punctuation, a closing bracket/quote, a code fence or an emoji.
  return !/[.!?:;)\]}"'`*…؟۔]$|\p{Extended_Pictographic}$/u.test(t);
}

/**
 * What to search the memory for. The user's own message — not the whole
 * recent conversation: mixing in long assistant replies used to push the
 * actual question out of the (length-limited) search query. A very short
 * follow-up ("and the other one?") gets the previous user message for context.
 */
function buildMemoryQuery(userText, history) {
  const text = String(userText || '').trim();
  if (!text) return null;
  const words = text.split(/\s+/).length;
  if (words >= 6) return text;
  const prevUser = [...(history || [])].reverse().find((m) => m.role === 'user' && m.text && m.text.trim());
  return prevUser ? `${prevUser.text.trim().slice(0, 300)} ${text}` : text;
}

function isContinuationRequest(userText, history) {
  if (!CONTINUE_TRIGGERS.test(String(userText || '').trim())) return false;
  const lastAssistant = [...(history || [])].reverse().find((m) => m.role === 'assistant');
  return Boolean(lastAssistant && looksCutOff(lastAssistant.text));
}

function registerIpcHandlers() {

  // Session Resource handlers
  ipcMain.handle('resource:list', async (event, sessionId) => {
    try {
      return { success: true, resources: store.getSessionResources(sessionId) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Parse + store entirely in the main process, from a file path. Only lightweight
  // metadata goes back to the renderer (previously the whole extracted text made a
  // round trip main → renderer → main).
  ipcMain.handle('resource:add', async (event, sessionId, filePath) => {
    try {
      const parsed = await parseDocumentFile(filePath);
      if (!parsed.success) return { success: false, error: parsed.error };
      const { resource, reused } = store.addSessionResource(sessionId, parsed);
      return { success: true, resource, reused, warning: parsed.warning || null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('resource:remove', async (event, sessionId, resourceId) => {
    try {
      store.removeSessionResource(sessionId, resourceId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Workspace handlers
  ipcMain.handle('workspace:select', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Workspace Folder',
        properties: ['openDirectory']
      });
      if (!result.canceled && result.filePaths.length > 0) {
        activeWorkspacePath = result.filePaths[0];
        return { success: true, workspacePath: activeWorkspacePath };
      }
      return { success: false, canceled: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('workspace:get', async () => {
    return { success: true, workspacePath: activeWorkspacePath };
  });

  ipcMain.handle('workspace:clear', async () => {
    activeWorkspacePath = null;
    return { success: true };
  });

  // Tool Permission Response listener from Renderer UI
  ipcMain.on('tool:permission-response', (event, { requestId, approved }) => {
    const resolver = pendingPermissions.get(requestId);
    if (resolver) {
      resolver(Boolean(approved));
      pendingPermissions.delete(requestId);
    }
  });

  ipcMain.handle('ollama:check', async () => {
    const running = await ollama.isOllamaRunning();
    if (!running) return { running: false, chatInstalled: false, embedInstalled: false, allInstalled: false };
    const status = await ollama.checkAllModels();
    return { running: true, ...status };
  });

  ipcMain.handle('ollama:list-models', async () => {
    try { return { success: true, models: await ollama.listModels() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('ollama:pull-model', async (event, modelName) => {
    try {
      await ollama.pullModel(modelName, (status) => {
        event.sender.send('ollama:pull-progress', { model: modelName, ...status });
      });
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('ollama:delete-model', async (event, modelName) => {
    try {
      await ollama.deleteModel(modelName);
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // ─── Memory (imported + in-app conversation history) ───────────────────────
  // The main process owns the memory: exports are parsed and indexed here, and
  // only small results cross IPC (previously every thread WITH its embedding
  // was sent to the renderer and back on every single message).
  const memory = getMemory();
  ollama.setMemorySearch((query, opts) => memory.search(query, opts));
  memory.on('progress', (stats) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('memory:progress', stats);
    }
  });
  const syncAppMemory = () => {
    try { memory.syncAppSessions(store.loadSessions()); } catch (err) { console.warn('Memory sync failed:', err.message); }
  };
  // Load the index + pick up in-app chats shortly after startup (not blocking window creation).
  setTimeout(syncAppMemory, 800);

  ipcMain.handle('memory:import', async (event, filePath) => {
    try {
      const threads = parseAnyExport(filePath);
      if (threads.length === 0) return { success: false, error: 'No conversations found in this file.' };
      const source = threads[0].source || 'unknown';
      const result = memory.importThreads(threads, source);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory:stats', async () => {
    try { return { success: true, ...memory.stats() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('memory:list', async (event, filter = {}) => {
    try { return { success: true, ...memory.listThreads(filter) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('memory:get', async (event, threadId) => {
    try {
      const thread = memory.getThread(threadId);
      return thread ? { success: true, thread } : { success: false, error: 'Conversation not found.' };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('memory:search', async (event, query, filter = {}) => {
    try {
      const opts = { limit: filter.limit || 30 };
      if (filter.source) opts.sources = [filter.source];
      const { passages, note, hints } = await memory.search(String(query || ''), opts);
      return {
        success: true,
        passages,
        note,
        understood: {
          dates: hints.dateRange && !hints.dateRange.soft ? hints.dateRange.label : null,
          sources: hints.sources,
          // topic words only (hint phrases and question words removed) — used for highlighting
          terms: [...new Set(tokenize(hints.text || String(query || '')))]
        }
      };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // "Ask about this conversation": attach a past conversation to a chat as a
  // text resource, so the model can read/search all of it with read_chat_resource.
  ipcMain.handle('memory:attach-to-chat', async (event, sessionId, threadId) => {
    try {
      const thread = memory.getThread(threadId);
      if (!thread) return { success: false, error: 'Conversation not found.' };
      const date = thread.createTime ? new Date(thread.createTime * 1000).toISOString().slice(0, 10) : 'unknown date';
      const text = `# ${thread.title}\n\nPast conversation from ${thread.sourceName} · ${date}\n\n` +
        thread.messages.map((m) => `**${m.role === 'user' ? 'User' : 'Assistant'}:** ${m.text}`).join('\n\n');
      const safeTitle = thread.title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 60) || 'Conversation';
      const parsed = parseTextContent(`${safeTitle} (${thread.sourceName}).md`, text);
      const { resource, reused } = store.addSessionResource(sessionId, parsed);
      return { success: true, resource: { ...resource, reused } };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('memory:delete-source', async (event, source) => {
    try { return { success: true, removed: memory.deleteSource(source) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // Chat sessions
  ipcMain.handle('chat:list', async () => {
    try { return { success: true, sessions: store.loadSessions() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('chat:create', async () => {
    try { return { success: true, session: store.createSession() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('chat:get', async (event, id) => {
    try { return { success: true, session: store.getSession(id, { withImages: true }) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('chat:delete', async (event, id) => {
    try { store.deleteSession(id); syncAppMemory(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('chat:rename', async (event, id, title) => {
    try { store.renameSession(id, title); syncAppMemory(); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // `_workspaceDir` from the renderer is deliberately ignored: the only
  // workspace the tools may touch is the one the user picked in the native
  // folder dialog (workspace:select), tracked here in the main process.
  ipcMain.handle('chat:send', async (event, sessionId, userText, _legacyThreads, modelName, images = [], _workspaceDir = null, documents = []) => {
    // Background memory indexing competes with the chat model for the GPU —
    // pause it while answering, resume (and index this chat) afterwards.
    memory.pause();
    try {
      const session = store.getSession(sessionId);
      const conversationHistory = session ? session.messages : [];

      const isContinuation = isContinuationRequest(userText, conversationHistory);

      let effectiveUserText = userText;

      // Attachment-only message: give the model an actual request to act on
      if (!userText.trim() && documents && documents.length > 0) {
        effectiveUserText = `I attached: ${documents.map((d) => d.name).join(', ')}. ` +
          `Read ${documents.length > 1 ? 'them' : 'it'} and give me a clear summary of what ${documents.length > 1 ? 'they contain' : 'it contains'}.`;
      }

      if (isContinuation) {
        const lastAssistant = [...conversationHistory].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant && lastAssistant.text) {
          effectiveUserText =
            `Please continue exactly from where you left off. ` +
            `Your previous response ended with:\n\n${lastAssistant.text.slice(-500)}\n\n` +
            `Continue from there without repeating anything already written.`;
        }
      }

      store.appendMessage(sessionId, 'user', userText, images, documents);

      // Fetch full active chat history (prior turns + new user message), with
      // image data: a vision model needs the images from earlier turns too.
      const currentSession = store.getSession(sessionId, { withImages: true });
      const activeHistory = currentSession ? currentSession.messages : [];

      const chosenModel = modelName || ollama.DEFAULT_MODEL;
      const effectiveWorkspace = activeWorkspacePath;

      // Memory search: passages from past conversations (imported and in-app,
      // except this chat) relevant to THIS message. The relevance gate means
      // unrelated questions get no memories at all.
      let memoryResult = { passages: [], note: null };
      const memoryQuery = isContinuation ? null : buildMemoryQuery(userText, conversationHistory);
      if (memoryQuery) {
        try {
          memoryResult = await memory.search(memoryQuery, { excludeThreadIds: [sessionId], limit: 6 });
        } catch (err) {
          console.warn('Memory search failed:', err.message);
        }
      }
      const memorySources = memoryResult.passages.map((p, i) => ({
        ref: `M${i + 1}`,
        threadId: p.threadId,
        title: p.title,
        source: p.source,
        sourceName: p.sourceName,
        date: p.date,
        msgStart: p.msgStart,
        score: p.score
      }));

      // Emit sources BEFORE generation so the UI can show them alongside the response
      if (memorySources.length > 0) event.sender.send('chat:sources', memorySources);

      // Mirrors what the renderer is showing: tokens append, a `reset` status
      // clears (a new agent step started, so the earlier text wasn't the answer).
      // Only used as a fallback if generate() somehow returns nothing.
      let visibleReply = '';

      // Real-time user permission prompt handler
      const onRequestPermission = ({ toolName, args }) => {
        return new Promise((resolve) => {
          const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          pendingPermissions.set(requestId, resolve);

          event.sender.send('tool:permission-request', {
            requestId,
            toolName,
            args,
            workspaceDir: effectiveWorkspace
          });

          // 5-minute timeout fallback
          setTimeout(() => {
            if (pendingPermissions.has(requestId)) {
              pendingPermissions.delete(requestId);
              resolve(false);
            }
          }, 5 * 60 * 1000);
        });
      };

      const finalText = await ollama.generate(
        effectiveUserText,
        memoryResult,
        activeHistory,
        chosenModel,
        (token) => {
          visibleReply += token;
          event.sender.send('chat:token', token);
        },
        (statusMessage) => {
          if (statusMessage && statusMessage.type === 'reset') visibleReply = '';
          event.sender.send('chat:status', statusMessage);
        },
        images,
        effectiveWorkspace,
        onRequestPermission,
        documents,
        sessionId
      );

      // generate()'s return value is the authoritative answer: it includes
      // things that are never streamed as tokens (the no-tools fallback reply,
      // backend error messages, recovered tool-call results, the "change may
      // not have been saved" warning) and excludes intermediate step text.
      // The same text is saved AND returned for the renderer to display, so
      // what's stored always matches what the user saw.
      const reply = (typeof finalText === 'string' && finalText.trim())
        ? finalText
        : (visibleReply.trim() ? visibleReply : '(no response)');

      // Remember which memories were offered and which the answer actually
      // cited ([M1]…), so the source chips survive reopening the chat.
      const sources = memorySources.map((s) => ({ ...s, cited: new RegExp(`\\[${s.ref}\\]`).test(reply) }));
      store.appendMessage(sessionId, 'assistant', reply, [], [], { sources });

      const updated = store.getSession(sessionId);
      event.sender.send('chat:session-updated', { id: sessionId, title: updated.title });

      return { success: true, reply, sources };
    } catch (err) {
      console.error('chat:send error:', err);
      return { success: false, error: err.message };
    } finally {
      syncAppMemory(); // this chat becomes searchable from other chats
      memory.resume();
    }
  });
}

module.exports = {
  registerIpcHandlers,
  // exported for tests
  _internals: { isContinuationRequest, looksCutOff, buildMemoryQuery }
};