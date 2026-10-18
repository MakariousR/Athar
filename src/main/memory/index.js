// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The app-wide memory instance and profile store (lazily created on first
 * use, after Electron is ready).
 */
const path = require('path');
const { app } = require('electron');
const { MemoryIndex } = require('./memory-index');
const { ProfileStore } = require('./profile');
const ollama = require('../ollama/ollama-client');

let memory = null;
let profileStore = null;

function memoryDir() {
  return path.join(app.getPath('userData'), 'memory');
}

function getMemory() {
  if (!memory) {
    memory = new MemoryIndex({
      dir: memoryDir(),
      embedTexts: ollama.embedTexts,
      embedModel: ollama.EMBED_MODEL
    });
  }
  return memory;
}

function getProfileStore() {
  if (!profileStore) profileStore = new ProfileStore(memoryDir());
  return profileStore;
}

module.exports = { getMemory, getProfileStore };
