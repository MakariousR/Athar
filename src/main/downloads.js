// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Downloads in progress (so closing the app can warn about them), and model
 * downloads that haven't finished yet (so they can be continued after a
 * restart — Ollama keeps the part already downloaded and resumes from there).
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ─── In progress (this session) ──────────────────────────────────────────────
const active = new Map(); // id → { kind: 'ollama'|'model', label, phase, percent }

function start(id, info) { active.set(id, { percent: 0, phase: 'download', ...info }); }
function update(id, patch) { if (active.has(id)) active.set(id, { ...active.get(id), ...patch }); }
function end(id) { active.delete(id); }
function list() { return [...active.values()]; }

/** Text for the "close anyway?" question, or null if nothing is running. */
function closeWarning() {
  const jobs = list();
  if (jobs.length === 0) return null;
  const installing = jobs.find((j) => j.kind === 'ollama' && j.phase !== 'download');
  const lines = jobs.map((j) => {
    if (j.kind === 'ollama') {
      return j.phase === 'download'
        ? `Ollama is downloading${j.percent ? ` (${j.percent}%)` : ''}. If you close now, the download starts again next time.`
        : 'Ollama is being installed right now.';
    }
    return `${j.label} is downloading${j.percent ? ` (${j.percent}%)` : ''}. You can continue it next time — the part already downloaded is kept.`;
  });
  return {
    message: installing ? 'Ollama is being installed' : (jobs.length === 1 ? 'A download is in progress' : 'Downloads are in progress'),
    detail: lines.join('\n') + (installing ? '\n\nPlease wait a minute until it finishes — closing now could leave Ollama half-installed.' : '')
  };
}

// ─── Unfinished model downloads (kept across restarts) ───────────────────────
const pendingFile = () => path.join(app.getPath('userData'), 'pending-downloads.json');

function readPending() {
  try {
    const data = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
    return Array.isArray(data.models) ? data.models.filter((m) => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

function writePending(models) {
  try {
    fs.mkdirSync(path.dirname(pendingFile()), { recursive: true });
    fs.writeFileSync(pendingFile(), JSON.stringify({ models: [...new Set(models)] }));
  } catch { /* not critical */ }
}

const addPending = (model) => writePending([...readPending(), model]);
const removePending = (model) => writePending(readPending().filter((m) => m !== model));

module.exports = { start, update, end, list, closeWarning, readPending, addPending, removePending };
