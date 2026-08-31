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

  ipcMain.handle('file:parse', async (event, filePath) => {
    try { return { success: true, threads: parseAnyExport(filePath) }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  /**
   * Cache-aware embed handler.
   *
   * Flow:
   *  1. Split threads into cached (already on disk) and uncached (need Ollama)
   *  2. Stream progress only for uncached threads — cached ones are instant
   *  3. Embed only the uncached subset via Ollama
   *  4. Save new embeddings to disk cache
   *  5. Merge cached + newly embedded and return the full set
   */
  ipcMain.handle('file:embed', async (event, threads) => {
    try {
      const { cached, uncached, hashMap } = embeddingStore.splitByCache(threads);

      // Tell the renderer immediately how many are cached vs need embedding
      event.sender.send('file:embed-progress', {
        done: cached.length,
        total: threads.length,
        cached: cached.length,
        toEmbed: uncached.length
      });

      let newlyEmbedded = [];

      if (uncached.length > 0) {
        newlyEmbedded = await ollama.embedThreads(uncached, (done, total) => {
          event.sender.send('file:embed-progress', {
            done: cached.length + done,
            total: threads.length,
            cached: cached.length,
            toEmbed: total,
            embedDone: done
          });
        });

        // Persist new embeddings to disk
        embeddingStore.cacheNewEmbeddings(newlyEmbedded, hashMap);
      }

      // Merge: preserve original thread order
      const embeddedMap = new Map();
      for (const t of cached)        embeddedMap.set(t.id, t);
      for (const t of newlyEmbedded) embeddedMap.set(t.id, t);
      const allEmbedded = threads
        .map((t) => embeddedMap.get(t.id))
        .filter(Boolean);

      return {
        success: true,
        threads: allEmbedded,
        stats: { total: allEmbedded.length, cached: cached.length, new: newlyEmbedded.length }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('embedding:stats', async () => {
    try { return { success: true, ...embeddingStore.getCacheStats() }; }
    catch (err) { return { success: false, error: err.message }; }
  });

  // --- Chat sessions ---
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

  ipcMain.handle('chat:send', async (event, sessionId, userText, embeddedThreads) => {
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

      let fullReply = '';

      if (continuationPrefix) {
        event.sender.send('chat:token', continuationPrefix + '\n');
        fullReply = continuationPrefix + '\n';
      }

      await ollama.generate(
        effectiveUserText,
        ranked,
        conversationHistory,
        ollama.DEFAULT_MODEL,
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
