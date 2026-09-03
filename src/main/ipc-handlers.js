const { ipcMain } = require('electron');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { rankThreadsSemantic } = require('./search/semantic-ranker');
const ollama = require('./ollama/ollama-client');
const store  = require('./store/chat-store');
const embeddingStore = require('./store/embedding-store');

function registerIpcHandlers() {

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
      const threads = embeddingStore.loadPersistedThreads();
      return { success: true, threads };
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

  ipcMain.handle('chat:send', async (event, sessionId, userText, embeddedThreads, modelName) => {
    try {
      const session = store.getSession(sessionId);
      const conversationHistory = session ? session.messages : [];

      const CONTINUE_TRIGGERS = /^(continue|go on|keep going|more|next|finish|complete it|proceed|and\??)\.?$/i;
      const isContinuation = CONTINUE_TRIGGERS.test(userText.trim());

      let effectiveUserText = userText;
      let continuationPrefix = '';

      if (isContinuation) {
        const lastAssistant = [...conversationHistory].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant && lastAssistant.text) {
          continuationPrefix = lastAssistant.text;
          effectiveUserText =
            `Please continue exactly from where you left off. ` +
            `Your previous response ended with:\n\n${lastAssistant.text.slice(-500)}\n\n` +
            `Continue from there without repeating anything already written.`;
        }
      }

      store.appendMessage(sessionId, 'user', userText);

      const combinedQuery = [
        ...conversationHistory.slice(-6).map((m) => m.text),
        userText
      ].join(' ');

      const ranked = embeddedThreads && embeddedThreads.length > 0
        ? await rankThreadsSemantic(embeddedThreads, combinedQuery, 5)
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

      if (continuationPrefix) {
        event.sender.send('chat:token', continuationPrefix + '\n');
        fullReply = continuationPrefix + '\n';
      }

      // Use the model chosen by the user, falling back to the default
      const chosenModel = modelName || ollama.DEFAULT_MODEL;

      await ollama.generate(
        effectiveUserText,
        ranked,
        conversationHistory,
        chosenModel,
        (token) => {
          fullReply += token;
          event.sender.send('chat:token', token);
        }
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
