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

  // --- Chat sessions ---
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

  // --- Send a message ---
  ipcMain.handle('chat:send', async (event, sessionId, userText, importedThreads) => {
    try {
      // 1. Load session BEFORE saving the new message so we have clean history
      const session = store.getSession(sessionId);
      const conversationHistory = session ? session.messages : [];

      // 2. Save the user message now
      store.appendMessage(sessionId, 'user', userText);

      // 3. Build a combined query from the full conversation so far + new message.
      //    This means imported context stays relevant across the whole chat,
      //    not just the first message.
      const combinedQuery = [
        ...conversationHistory.slice(-6).map((m) => m.text), // last 3 turns of context
        userText
      ].join(' ');

      // 4. Rank imported threads against the combined query
      const ranked = importedThreads && importedThreads.length > 0
        ? rankThreads(importedThreads, combinedQuery, 8)
        : [];

      // 5. Pass the full conversation history (all prior turns) to the model.
      //    ollama-client slices to last 10 turns internally to avoid context overflow.
      let fullReply = '';

      await ollama.generate(
        userText,
        ranked,
        conversationHistory, // full history — model sees the whole chat
        ollama.DEFAULT_MODEL,
        (token) => {
          fullReply += token;
          event.sender.send('chat:token', token);
        }
      );

      // 6. Save assistant reply
      store.appendMessage(sessionId, 'assistant', fullReply || '(no response)');

      // 7. Send updated title back (auto-titled on first message)
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
