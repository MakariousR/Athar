const { ipcMain, dialog } = require('electron');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { parseDocumentFile, toMetadata } = require('./parser/document-parser');
const { rankThreadsSemantic } = require('./search/semantic-ranker');
const ollama = require('./ollama/ollama-client');
const { WORKSPACE_KEYWORDS } = ollama;
const store  = require('./store/chat-store');
const embeddingStore = require('./store/embedding-store');

let activeWorkspacePath = null;
const pendingPermissions = new Map();

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
    try { return { success: true, session: store.getSession(id) }; }
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

  ipcMain.handle('chat:send', async (event, sessionId, userText, embeddedThreads, modelName, images = [], workspaceDir = null, documents = []) => {
    try {
      const session = store.getSession(sessionId);
      const conversationHistory = session ? session.messages : [];

      const CONTINUE_TRIGGERS = /^(continue|go on|keep going|more|next|finish|complete it|proceed|and\??)\.?$/i;
      const isContinuation = CONTINUE_TRIGGERS.test(userText.trim());

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

      // Fetch full active chat history (prior turns + new user message)
      const currentSession = store.getSession(sessionId);
      const activeHistory = currentSession ? currentSession.messages : [];

      const chosenModel = modelName || ollama.DEFAULT_MODEL;
      const effectiveWorkspace = workspaceDir || activeWorkspacePath;

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

      let fullReply = '';

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

      await ollama.generate(
        effectiveUserText,
        ranked,
        activeHistory,
        chosenModel,
        (token) => {
          fullReply += token;
          event.sender.send('chat:token', token);
        },
        (statusMessage) => {
          event.sender.send('chat:status', statusMessage);
        },
        images,
        effectiveWorkspace,
        onRequestPermission,
        documents,
        sessionId
      );

      store.appendMessage(sessionId, 'assistant', fullReply || '(no response)');

      const updated = store.getSession(sessionId);
      event.sender.send('chat:session-updated', { id: sessionId, title: updated.title });

      return { success: true };
    } catch (err) {
      console.error('chat:send error:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIpcHandlers };