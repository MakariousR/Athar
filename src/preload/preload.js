const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFilePath: (file) => webUtils.getPathForFile(file),
  parseExport: (filePath) => ipcRenderer.invoke('file:parse', filePath),
  embedThreads: (threads, existing) => ipcRenderer.invoke('file:embed', threads, existing),
  loadSavedHistory: () => ipcRenderer.invoke('history:load'),
  getEmbeddingStats: () => ipcRenderer.invoke('embedding:stats'),
  onEmbedProgress: (cb) => {
    ipcRenderer.removeAllListeners('file:embed-progress');
    ipcRenderer.on('file:embed-progress', (_e, data) => cb(data));
  },

  checkOllama: () => ipcRenderer.invoke('ollama:check'),
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  pullModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
  onPullProgress: (cb) => {
    ipcRenderer.removeAllListeners('ollama:pull-progress');
    ipcRenderer.on('ollama:pull-progress', (_e, status) => cb(status));
  },

  chatList: () => ipcRenderer.invoke('chat:list'),
  chatCreate: () => ipcRenderer.invoke('chat:create'),
  chatGet: (id) => ipcRenderer.invoke('chat:get', id),
  chatDelete: (id) => ipcRenderer.invoke('chat:delete', id),
  chatRename: (id, title) => ipcRenderer.invoke('chat:rename', id, title),
  chatSend: (sessionId, userText, embeddedThreads, modelName) =>
    ipcRenderer.invoke('chat:send', sessionId, userText, embeddedThreads, modelName),

  onChatToken: (cb) => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.on('chat:token', (_e, token) => cb(token));
  },
  onSessionUpdated: (cb) => {
    ipcRenderer.removeAllListeners('chat:session-updated');
    ipcRenderer.on('chat:session-updated', (_e, data) => cb(data));
  },
  onChatSources: (cb) => {
    ipcRenderer.removeAllListeners('chat:sources');
    ipcRenderer.on('chat:sources', (_e, sources) => cb(sources));
  }
});
