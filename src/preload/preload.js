const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File handling
  getFilePath: (file) => webUtils.getPathForFile(file),
  parseExport: (filePath) => ipcRenderer.invoke('file:parse', filePath),

  // Search
  rankThreads: (threads, query, topN) => ipcRenderer.invoke('search:rank', threads, query, topN),

  // Ollama lifecycle
  checkOllama: () => ipcRenderer.invoke('ollama:check'),
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  pullModel: () => ipcRenderer.invoke('ollama:pull-model'),
  onPullProgress: (callback) => {
    ipcRenderer.removeAllListeners('ollama:pull-progress');
    ipcRenderer.on('ollama:pull-progress', (_event, status) => callback(status));
  },

  // Ask a question
  ask: (question, threads) => ipcRenderer.invoke('ollama:generate', question, threads),
  onGenerateToken: (callback) => {
    ipcRenderer.removeAllListeners('ollama:generate-token');
    ipcRenderer.on('ollama:generate-token', (_event, token) => callback(token));
  }
});
