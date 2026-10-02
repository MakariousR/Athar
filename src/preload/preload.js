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

  // Portable memory profile
  profileGet: () => ipcRenderer.invoke('profile:get'),
  profileGenerate: (options) => ipcRenderer.invoke('profile:generate', options),
  profileCancel: () => ipcRenderer.invoke('profile:cancel'),
  profileSave: (patch) => ipcRenderer.invoke('profile:save', patch),
  onProfileProgress: (cb) => {
    ipcRenderer.removeAllListeners('profile:progress');
    ipcRenderer.on('profile:progress', (_e, progress) => cb(progress));
  },
  onMemoryProgress: (cb) => {
    ipcRenderer.removeAllListeners('memory:progress');
    ipcRenderer.on('memory:progress', (_e, stats) => cb(stats));
  },

  appVersion: () => ipcRenderer.invoke('app:version'),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  licenseActivate: (key) => ipcRenderer.invoke('license:activate', key),
  onLicenseChanged: (cb) => {
    ipcRenderer.removeAllListeners('license:changed');
    ipcRenderer.on('license:changed', (_e, status) => cb(status));
  },
  appDocument: (name) => ipcRenderer.invoke('app:document', name),
  checkOllama: () => ipcRenderer.invoke('ollama:check'),
  findOllama: () => ipcRenderer.invoke('ollama:find'),
  startOllama: () => ipcRenderer.invoke('ollama:start'),
  installOllama: () => ipcRenderer.invoke('ollama:install'),
  cancelOllamaInstall: () => ipcRenderer.invoke('ollama:install-cancel'),
  openOllamaDownloadPage: () => ipcRenderer.invoke('ollama:open-download-page'),
  onOllamaInstallProgress: (cb) => {
    ipcRenderer.removeAllListeners('ollama:install-progress');
    ipcRenderer.on('ollama:install-progress', (_e, progress) => cb(progress));
  },
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  modelCanSearch: (modelName) => ipcRenderer.invoke('model:can-search', modelName),
  // Cloud models (Gemini, ChatGPT, Claude) with the user's own API keys: a key is sent once to be saved, never read back
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudSetKey: (provider, key) => ipcRenderer.invoke('cloud:set-key', provider, key),
  cloudClearKey: (provider) => ipcRenderer.invoke('cloud:clear-key', provider),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  mcpConnectDesktop: () => ipcRenderer.invoke('mcp:connect-desktop'),
  mcpDisconnectDesktop: () => ipcRenderer.invoke('mcp:disconnect-desktop'),
  pullModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
  pendingDownloads: () => ipcRenderer.invoke('downloads:pending'),
  discardPendingDownload: (modelName) => ipcRenderer.invoke('downloads:discard', modelName),
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
  chatSend: (sessionId, userText, modelName, images = [], documents = [], options = {}) =>
    ipcRenderer.invoke('chat:send', sessionId, userText, null, modelName, images, null, documents, options),

  chatStop: (sessionId) => ipcRenderer.invoke('chat:stop', sessionId),
  // Streamed updates carry { sessionId, … } so they reach the right chat
  onChatToken: (cb) => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.on('chat:token', (_e, data) => cb(data));
  },
  onSessionUpdated: (cb) => {
    ipcRenderer.removeAllListeners('chat:session-updated');
    ipcRenderer.on('chat:session-updated', (_e, data) => cb(data));
  },
  onChatSources: (cb) => {
    ipcRenderer.removeAllListeners('chat:sources');
    ipcRenderer.on('chat:sources', (_e, data) => cb(data));
  },
  onChatStatus: (cb) => {
    ipcRenderer.removeAllListeners('chat:status');
    ipcRenderer.on('chat:status', (_e, data) => cb(data));
  }
});
