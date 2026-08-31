const { ipcMain } = require('electron');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { rankThreadsSemantic } = require('./search/semantic-ranker');
const ollama = require('./ollama/ollama-client');
const store = require('./store/chat-store');

function registerIpcHandlers() {

  // --- Ollama status: checks both models, returns what's missing ---
  ipcMain.handle('ollama:check', async () => {
    const running = await ollama.isOllamaRunning();
    if (!running) return { running: false, chatInstalled: false, embedInstalled: false, allInstalled: false };
    const status = await ollama.checkAllModels();
    return { running: true, ...status };
  });

  ipcMain.handle('ollama:list-models', async () => {
    try {
      const models = await ollama.listModels();
      return { success: true, models };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Pull only a specific model (renderer decides which ones are missing) ---
  ipcMain.handle('ollama:pull-model', async (event, modelName) => {
    try {
      await ollama.pullModel(modelName, (status) => {
        event.sender.send('ollama:pull-progress', { model: modelName, ...status });
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- File parsing ---
  ipcMain.handle('file:parse', async (event, filePath) => {
    try {
      const threads = parseAnyExport(filePath);
      return { success: true, threads };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Embed all threads (called after import, streams progress back) ---
  ipcMain.handle('file:embed', async (event, threads) => {
    try {
      const embedded = await ollama.embedThreads(threads, (done, total) => {
        event.sender.send('file:embed-progress', { done, total });
      });
      return { success: true, threads: embedded };
    } catch (err) {
      return { success: false, error: err.message };
    }
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

  // --- Send a message ---
  ipcMain.handle('chat:send', async (event, sessionId, userText, embeddedThreads) => {
    try {
      // Load history BEFORE saving new message
      const session = store.getSession(sessionId);
      const conversationHistory = session ? session.messages : [];

      // Save user message
      store.appendMessage(sessionId, 'user', userText);

      // Build combined query: recent conversation turns + new message
      // This keeps imported context relevant across the whole chat
      const combinedQuery = [
        ...conversationHistory.slice(-6).map((m) => m.text),
        userText
      ].join(' ');

      // Semantic ranking — finds threads by meaning, not keyword overlap
      const ranked = embeddedThreads && embeddedThreads.length > 0
        ? await rankThreadsSemantic(embeddedThreads, combinedQuery, 8)
        : [];

      let fullReply = '';

      await ollama.generate(
        userText,
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
