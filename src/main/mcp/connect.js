/**
 * Connecting Athar to Claude Desktop: adds (or removes) an "athar" entry in
 * Claude Desktop's claude_desktop_config.json, which starts "Athar --mcp".
 * Everything else in that file is kept as it is. Claude Code is connected
 * with a command the user runs (shown in Settings).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWrite } = require('../utils/fs-utils');

const ENTRY = 'athar';
const CONFIG_FILE = 'claude_desktop_config.json';

/** Claude Desktop's settings folders that exist on this computer (the installer's, and the Microsoft Store app's). */
function claudeDesktopDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const dirs = [];
  if (platform === 'win32') {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'Claude'));
    const packages = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages');
    try {
      for (const name of fs.readdirSync(packages)) {
        if (/^Claude_/i.test(name)) dirs.push(path.join(packages, name, 'LocalCache', 'Roaming', 'Claude'));
      }
    } catch { /* no Store apps folder */ }
  } else if (platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'Claude'));
  } else {
    dirs.push(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude'));
  }
  return dirs.filter((d) => fs.existsSync(d));
}

/** How Claude starts Athar's MCP server: this program, with --mcp. */
function launchCommand({ execPath = process.execPath, isPackaged = true, appPath = '' } = {}) {
  return { command: execPath, args: isPackaged ? ['--mcp'] : [appPath, '--mcp'] };
}

/** A command line for Claude Code (or any terminal), quoted for PowerShell / cmd / sh. */
function claudeCodeCommand(launch) {
  const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return `claude mcp add --scope user ${ENTRY} -- ${[launch.command, ...launch.args].map(q).join(' ')}`;
}

function readConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  if (!text.trim()) return {};
  try {
    const config = JSON.parse(text.replace(/^﻿/, ''));
    if (config && typeof config === 'object' && !Array.isArray(config)) return config;
  } catch { /* below */ }
  // Never overwrite a settings file we can't read: it may hold the user's other servers
  throw new Error(`Claude Desktop's settings file couldn't be read, so it was left unchanged:\n${file}`);
}

const sameLaunch = (entry, launch) => !!entry && entry.command === launch.command &&
  JSON.stringify(entry.args || []) === JSON.stringify(launch.args);

/**
 * @returns {{ installed: boolean, connected: boolean, outdated: boolean, files: string[] }}
 *   outdated: an "athar" entry that starts a different copy of Athar (e.g. it was moved)
 */
function desktopStatus(launch, dirs = claudeDesktopDirs()) {
  let connected = false;
  let outdated = false;
  for (const dir of dirs) {
    try {
      const entry = (readConfig(path.join(dir, CONFIG_FILE)).mcpServers || {})[ENTRY];
      if (sameLaunch(entry, launch)) connected = true;
      else if (entry) outdated = true;
    } catch { /* unreadable: shown as not connected */ }
  }
  return { installed: dirs.length > 0, connected, outdated: outdated && !connected, files: dirs.map((d) => path.join(d, CONFIG_FILE)) };
}

function connectDesktop(launch, dirs = claudeDesktopDirs()) {
  if (dirs.length === 0) throw new Error('Claude Desktop isn\'t installed on this computer. Install it from claude.ai/download, open it once, then try again.');
  for (const dir of dirs) {
    const file = path.join(dir, CONFIG_FILE);
    const config = readConfig(file);
    const servers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {};
    config.mcpServers = { ...servers, [ENTRY]: { command: launch.command, args: launch.args } };
    atomicWrite(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  return desktopStatus(launch, dirs);
}

function disconnectDesktop(launch, dirs = claudeDesktopDirs()) {
  for (const dir of dirs) {
    const file = path.join(dir, CONFIG_FILE);
    const config = readConfig(file);
    if (!config.mcpServers || !config.mcpServers[ENTRY]) continue;
    delete config.mcpServers[ENTRY];
    atomicWrite(file, `${JSON.stringify(config, null, 2)}\n`);
  }
  return desktopStatus(launch, dirs);
}

module.exports = { claudeDesktopDirs, launchCommand, claudeCodeCommand, desktopStatus, connectDesktop, disconnectDesktop, ENTRY, CONFIG_FILE };
