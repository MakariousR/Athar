const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getStorePath() {
  const dir = path.join(app.getPath('userData'), 'chats');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sessions.json');
}

function loadSessions() {
  const p = getStorePath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  fs.writeFileSync(getStorePath(), JSON.stringify(sessions, null, 2), 'utf-8');
}

function createSession(title = 'New chat') {
  const sessions = loadSessions();
  const session = {
    id: `s_${Date.now()}`,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [] // { role: 'user'|'assistant', text, timestamp }
  };
  sessions.unshift(session);
  saveSessions(sessions);
  return session;
}

function getSession(id) {
  return loadSessions().find((s) => s.id === id) || null;
}

function appendMessage(sessionId, role, text) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const message = { role, text, timestamp: Date.now() };
  session.messages.push(message);
  session.updatedAt = Date.now();

  // Auto-title the session from the first user message if still default
  if (role === 'user' && session.title === 'New chat' && session.messages.length === 1) {
    session.title = text.slice(0, 40) + (text.length > 40 ? '…' : '');
  }

  saveSessions(sessions);
  return message;
}

function deleteSession(id) {
  const sessions = loadSessions().filter((s) => s.id !== id);
  saveSessions(sessions);
}

function renameSession(id, title) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === id);
  if (session) {
    session.title = title;
    saveSessions(sessions);
  }
}

module.exports = {
  loadSessions,
  createSession,
  getSession,
  appendMessage,
  deleteSession,
  renameSession
};
