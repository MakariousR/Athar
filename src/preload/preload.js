const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFilePath: (file) => webUtils.getPathForFile(file),
  listResources: (sessionId) => ipcRenderer.invoke('resource:list', sessionId),
  addResource: (sessionId, filePath) => ipcRenderer.invoke('resource:add', sessionId, filePath),
  removeResource: (sessionId, resourceId) => ipcRenderer.invoke('resource:remove', sessionId, resourceId),

  // Memory (imported + in-app conversation history)
  importHistory: (filePath) => ipcRenderer.invoke('memory:import', filePath),
  memoryStats: () => ipcRenderer.invoke('memory:stats'),
  memoryList: (filter) => ipcRenderer.invoke('memory:list', filter),
  memoryGet: (threadId) => ipcRenderer.invoke('memory:get', threadId),
  memorySearch: (query, filter) => ipcRenderer.invoke('memory:search', query, filter),
  memoryDeleteSource: (source) => ipcRenderer.invoke('memory:delete-source', source),
  memoryAttachToChat: (sessionId, threadId) => ipcRenderer.invoke('memory:attach-to-chat', sessionId, threadId),
  onMemoryProgress: (cb) => {
    ipcRenderer.removeAllListeners('memory:progress');
    ipcRenderer.on('memory:progress', (_e, stats) => cb(stats));
  },

  checkOllama: () => ipcRenderer.invoke('ollama:check'),
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  pullModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
  deleteModel: (modelName) => ipcRenderer.invoke('ollama:delete-model', modelName),
  onPullProgress: (cb) => {
    ipcRenderer.removeAllListeners('ollama:pull-progress');
    ipcRenderer.on('ollama:pull-progress', (_e, status) => cb(status));
  },

  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  clearWorkspace: () => ipcRenderer.invoke('workspace:clear'),

  onToolPermissionRequest: (cb) => {
    ipcRenderer.removeAllListeners('tool:permission-request');
    ipcRenderer.on('tool:permission-request', (_e, data) => cb(data));
  },
  respondToolPermission: (requestId, approved) => {
    ipcRenderer.send('tool:permission-response', { requestId, approved });
  },

  chatList: () => ipcRenderer.invoke('chat:list'),
  chatCreate: () => ipcRenderer.invoke('chat:create'),
  chatGet: (id) => ipcRenderer.invoke('chat:get', id),
  chatDelete: (id) => ipcRenderer.invoke('chat:delete', id),
  chatRename: (id, title) => ipcRenderer.invoke('chat:rename', id, title),
  // The main process owns the memory and the project folder; only the message goes over IPC.
  chatSend: (sessionId, userText, modelName, images = [], documents = []) =>
    ipcRenderer.invoke('chat:send', sessionId, userText, null, modelName, images, null, documents),

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
  },
  onChatStatus: (cb) => {
    ipcRenderer.removeAllListeners('chat:status');
    ipcRenderer.on('chat:status', (_e, status) => cb(status));
  }
});
