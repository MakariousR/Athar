const { ipcMain } = require('electron');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { rankThreads } = require('./search/keyword-ranker');
const ollama = require('./ollama/ollama-client');
const store = require('./store/chat-store');

function registerIpcHandlers() {

  // --- Imported history (background context) ---
  ipcMain.handle('file:parse', async (event, filePath) => {
    try {
      const threads = parseAnyExport(filePath);
      return { success: true, threads };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('search:rank', async (event, threads, query, topN) => {
    try {
      const ranked = rankThreads(threads, query, topN || 12);
      return { success: true, ranked };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Ollama status ---
  ipcMain.handle('ollama:check', async () => {
    const running = await ollama.isOllamaRunning();
    if (!running) return { running: false, modelInstalled: false };
    const modelInstalled = await ollama.isModelInstalled();
    return { running: true, modelInstalled };
  });

  ipcMain.handle('ollama:list-models', async () => {
    try {
      const models = await ollama.listModels();
      return { success: true, models };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ollama:pull-model', async (event) => {
    try {
      await ollama.pullModel(ollama.DEFAULT_MODEL, (status) => {
        event.sender.send('ollama:pull-progress', status);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Chat sessions (local, persistent) ---
  ipcMain.handle('chat:list', async () => {
    try {
      return { success: true, sessions: store.loadSessions() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('chat:create', async () => {
    try {
      const session = store.createSession();
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('chat:get', async (event, id) => {
    try {
      const session = store.getSession(id);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('chat:delete', async (event, id) => {
    try {
      store.deleteSession(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('chat:rename', async (event, id, title) => {
    try {
      store.renameSession(id, title);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Send a message (saves both turns, streams reply) ---
  ipcMain.handle('chat:send', async (event, sessionId, userText, importedThreads) => {
    try {
      // Save user message
      store.appendMessage(sessionId, 'user', userText);

      // Load full session for conversation history
      const session = store.getSession(sessionId);
      const history = session.messages.slice(0, -1); // all except the one we just added

      // Rank imported history against the user's message (silent background context)
      const ranked = importedThreads && importedThreads.length > 0
        ? rankThreads(importedThreads, userText, 8)
        : [];

      let fullReply = '';

      const result = await ollama.generate(
        userText,
        ranked,
        history,
        ollama.DEFAULT_MODEL,
        (token) => {
          fullReply += token;
          event.sender.send('chat:token', token);
        }
      );

      // Save assistant reply
      store.appendMessage(sessionId, 'assistant', fullReply);

      // Send updated session title back (may have changed on first message)
      const updated = store.getSession(sessionId);
      event.sender.send('chat:session-updated', { id: sessionId, title: updated.title });

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIpcHandlers };
