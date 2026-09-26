/**
 * The app-wide memory instance (lazily created on first use, after Electron is ready).
 */
const path = require('path');
const { app } = require('electron');
const { MemoryIndex } = require('./memory-index');
const ollama = require('../ollama/ollama-client');

let memory = null;

function getMemory() {
  if (!memory) {
    const userData = app.getPath('userData');
    memory = new MemoryIndex({
      dir: path.join(userData, 'memory'),
      embedTexts: ollama.embedTexts,
      embedModel: ollama.EMBED_MODEL,
      legacyDir: userData
    });
  }
  return memory;
}

module.exports = { getMemory };
