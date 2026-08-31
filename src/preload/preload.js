const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File / imported history
  getFilePath: (file) => webUtils.getPathForFile(file),
  parseExport: (filePath) => ipcRenderer.invoke('file:parse', filePath),
  embedThreads: (threads) => ipcRenderer.invoke('file:embed', threads),
  onEmbedProgress: (cb) => {
    ipcRenderer.removeAllListeners('file:embed-progress');
    ipcRenderer.on('file:embed-progress', (_e, data) => cb(data));
  },

  // Ollama setup
  checkOllama: () => ipcRenderer.invoke('ollama:check'),
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  pullModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
  onPullProgress: (cb) => {
    ipcRenderer.removeAllListeners('ollama:pull-progress');
    ipcRenderer.on('ollama:pull-progress', (_e, status) => cb(status));
  },

  // Chat sessions
  chatList: () => ipcRenderer.invoke('chat:list'),
  chatCreate: () => ipcRenderer.invoke('chat:create'),
  chatGet: (id) => ipcRenderer.invoke('chat:get', id),
  chatDelete: (id) => ipcRenderer.invoke('chat:delete', id),
  chatRename: (id, title) => ipcRenderer.invoke('chat:rename', id, title),
  chatSend: (sessionId, userText, embeddedThreads) =>
    ipcRenderer.invoke('chat:send', sessionId, userText, embeddedThreads),

  // Stable streaming listeners
  onChatToken: (cb) => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.on('chat:token', (_e, token) => cb(token));
  },
  onSessionUpdated: (cb) => {
    ipcRenderer.removeAllListeners('chat:session-updated');
    ipcRenderer.on('chat:session-updated', (_e, data) => cb(data));
  }
});
