const { ipcMain } = require('electron');
const { parseAnyExport } = require('./parser/chatgpt-parser');
const { rankThreads } = require('./search/keyword-ranker');
const ollama = require('./ollama/ollama-client');

function registerIpcHandlers() {
  // --- File parsing ---
  ipcMain.handle('file:parse', async (event, filePath) => {
    try {
      const threads = parseAnyExport(filePath);
      return { success: true, threads };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Search / ranking ---
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

  // --- Model pull (streams progress back to the renderer) ---
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

  // --- Ask a question against the ranked threads (streams tokens back) ---
  ipcMain.handle('ollama:generate', async (event, question, threads) => {
    try {
      const full = await ollama.generate(question, threads, ollama.DEFAULT_MODEL, (token) => {
        event.sender.send('ollama:generate-token', token);
      });
      return { success: true, full };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIpcHandlers };
