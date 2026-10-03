const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// The app used to be called "Chat Memory" and kept its data in
// "%APPDATA%/Chat Memory". Move anything there into the new folder before
// the app opens it (entries already in the new folder are left alone).
function moveDataFromOldName() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'Chat Memory');
    const newDir = app.getPath('userData');
    if (path.resolve(oldDir) === path.resolve(newDir) || !fs.existsSync(oldDir)) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const entry of fs.readdirSync(oldDir)) {
      const target = path.join(newDir, entry);
      if (!fs.existsSync(target)) fs.renameSync(path.join(oldDir, entry), target);
    }
    if (fs.readdirSync(oldDir).length === 0) fs.rmdirSync(oldDir);
  } catch (err) {
    console.error('Could not move data from the old "Chat Memory" folder:', err.message);
  }
}
moveDataFromOldName();

// Started by Claude Desktop / Claude Code as an MCP server: no window, memory tools over stdio
const MCP_MODE = process.argv.includes('--mcp');
if (MCP_MODE) require('./mcp').startMcpMode();

const { registerIpcHandlers } = require('./ipc-handlers');
const downloads = require('./downloads');
const { cleanupLeftoverInstallers } = require('./ollama/ollama-installer');

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
    title: 'Athar',
    icon: path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
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

  // A download or the Ollama install in progress: ask before closing
  let closeConfirmed = false;
  mainWindow.on('close', (event) => {
    if (closeConfirmed) return;
    const warning = downloads.closeWarning();
    if (!warning) return;
    event.preventDefault();
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Athar',
      message: warning.message,
      detail: warning.detail,
      buttons: ['Keep Athar open', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(({ response }) => {
      if (response === 1 && mainWindow && !mainWindow.isDestroyed()) {
        closeConfirmed = true;
        mainWindow.close();
      }
    });
  });

  // Uncomment while developing:
  // mainWindow.webContents.openDevTools();
}

if (!MCP_MODE) app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // remove File/Edit/View menu bar entirely
  registerIpcHandlers();
  createWindow();
  cleanupLeftoverInstallers(); // half-downloaded Ollama installers from a closed session

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Node-only backend means there is no subprocess to kill on quit -
// closing the window is enough to free all memory.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
