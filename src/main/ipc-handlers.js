const { ipcMain: electronIpcMain, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { parseDocumentFile, toMetadata } = require('./parser/document-parser');
const { rankThreadsSemantic } = require('./search/semantic-ranker');
const ollama = require('./ollama/ollama-client');
const { WORKSPACE_KEYWORDS } = ollama;
const store  = require('./store/chat-store');
const embeddingStore = require('./store/embedding-store');

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

function isContinuationRequest(userText, history) {
  if (!CONTINUE_TRIGGERS.test(String(userText || '').trim())) return false;
  const lastAssistant = [...(history || [])].reverse().find((m) => m.role === 'assistant');
  return Boolean(lastAssistant && looksCutOff(lastAssistant.text));
}

function registerIpcHandlers() {

  // Document parsing (metadata only — page text stays in the main process)
  ipcMain.handle('document:parse', async (event, filePath) => {
    try {
      return toMetadata(await parseDocumentFile(filePath));
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

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

  // Returns threads + detected source label ('chatgpt' | 'claude' | 'unknown')
  ipcMain.handle('file:parse', async (event, filePath) => {
    try {
      const threads = parseAnyExport(filePath);
      const source = threads.length > 0 ? (threads[0].source || 'unknown') : 'unknown';
      return { success: true, threads, source };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('history:load', async () => {
    try {
      const imported = embeddingStore.loadPersistedThreads();
      const appThreads = await embeddingStore.getEmbeddedAppThreads(ollama);
      const combined = embeddingStore.mergeThreads(imported, appThreads);
      return { success: true, threads: combined };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Cache-aware & incremental embed — merges incoming threads, checks missing prompts, persists to disk
  ipcMain.handle('file:embed', async (event, incomingThreads, existingEmbedded) => {
    try {
      // 1. Smart incremental merge: merge incoming with existing history, updating threads with new prompts
      const mergedThreads = embeddingStore.mergeThreads(existingEmbedded || [], incomingThreads);

      // 2. Split into cached vs uncached (new threads or threads with new content)
      const { cached, uncached, hashMap } = embeddingStore.splitByCache(mergedThreads);

      event.sender.send('file:embed-progress', {
        done: cached.length,
        total: mergedThreads.length,
        cached: cached.length,
        toEmbed: uncached.length
      });

      let newlyEmbedded = [];

      if (uncached.length > 0) {
        newlyEmbedded = await ollama.embedThreads(uncached, (done, total) => {
          event.sender.send('file:embed-progress', {
            done: cached.length + done,
            total: mergedThreads.length,
            cached: cached.length,
            toEmbed: total,
            embedDone: done
          });
        });
        embeddingStore.cacheNewEmbeddings(newlyEmbedded, hashMap);
      }

      // Build full set
      const embeddedMap = new Map();
      for (const t of cached)        embeddedMap.set(t.id, t);
      for (const t of newlyEmbedded) embeddedMap.set(t.id, t);
      const allEmbedded = mergedThreads.map((t) => embeddedMap.get(t.id)).filter(Boolean);

      // 3. Persist the updated history to disk so it reloads on restart
      embeddingStore.savePersistedThreads(allEmbedded);

      return {
        success: true,
        threads: allEmbedded,
        stats: {
          total: allEmbedded.length,
          thisImport: incomingThreads.length,
          cached: cached.length,
          new: newlyEmbedded.length
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('embedding:stats', async () => {
    try { return { success: true, ...embeddingStore.getCacheStats() }; }
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
    try { store.deleteSession(id); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('chat:rename', async (event, id, title) => {
    try { store.renameSession(id, title); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // `_workspaceDir` from the renderer is deliberately ignored: the only
  // workspace the tools may touch is the one the user picked in the native
  // folder dialog (workspace:select), tracked here in the main process.
  ipcMain.handle('chat:send', async (event, sessionId, userText, embeddedThreads, modelName, images = [], _workspaceDir = null, documents = []) => {
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

      // Check if user request is targeting local workspace project files or git repository.
      const isWorkspaceOperation = Boolean(effectiveWorkspace) && WORKSPACE_KEYWORDS.test(userText);

      // Combine imported threads with all embedded in-app chat session threads
      const appThreads = await embeddingStore.getEmbeddedAppThreads(ollama);
      const allCandidateThreads = embeddingStore.mergeThreads(embeddedThreads || [], appThreads);
      const searchableThreads = allCandidateThreads.filter((t) => t.id !== sessionId);

      const combinedQuery = [
        ...activeHistory.slice(-6).map((m) => m.text),
        userText
      ].join(' ');

      // Priority 1: Current Chat & Active Workspace Project
      // Only query background imported history (Priority 2) if this is NOT a local workspace project action
      const ranked = (!isWorkspaceOperation && searchableThreads.length > 0)
        ? await rankThreadsSemantic(searchableThreads, combinedQuery, 3)
        : [];

      // Emit sources BEFORE generation so the UI can show them alongside the response
      if (ranked.length > 0) {
        event.sender.send('chat:sources', ranked.map((t) => ({
          id: t.id,
          title: t.title,
          source: t.source || 'unknown',
          score: t.score,
          date: t.createTime ? new Date(t.createTime * 1000).toISOString().slice(0, 10) : null
        })));
      }

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
        ranked,
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

      store.appendMessage(sessionId, 'assistant', reply);

      const updated = store.getSession(sessionId);
      event.sender.send('chat:session-updated', { id: sessionId, title: updated.title });

      return { success: true, reply };
    } catch (err) {
      console.error('chat:send error:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = {
  registerIpcHandlers,
  // exported for tests
  _internals: { isContinuationRequest, looksCutOff }
};