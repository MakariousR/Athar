const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');

let mainWindow;

function isExternalWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'Chat Memory',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // needed so preload can use webUtils.getPathForFile
    }
  });

  // The preload bridge (window.api) is attached to whatever page this window
  // shows, so it must only ever show our own UI. Model output is rendered as
  // markdown and can contain links (possibly planted by a prompt-injected web
  // page or document) — never let those replace the app. Web links open in
  // the system browser instead; everything else is simply dropped.
  const { webContents } = mainWindow;
  webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (isExternalWebUrl(url)) shell.openExternal(url);
  });
  webContents.on('will-redirect', (event) => event.preventDefault());
  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Uncomment while developing:
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // remove File/Edit/View menu bar entirely
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Node-only backend means there is no subprocess to kill on quit -
// closing the window is enough to free all memory.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
