// chat.js — full renderer logic for the chat interface

// ── DOM refs ──────────────────────────────────────────────────────────────────
const setupOverlay    = document.getElementById('setupOverlay');
const setupMessage    = document.getElementById('setupMessage');
const pullModelBtn    = document.getElementById('pullModelBtn');
const pullProgressWrap= document.getElementById('pullProgressWrap');
const pullProgressFill= document.getElementById('pullProgressFill');
const pullProgressText= document.getElementById('pullProgressText');

const appShell        = document.getElementById('appShell');
const newChatBtn      = document.getElementById('newChatBtn');
const emptyNewChatBtn = document.getElementById('emptyNewChatBtn');
const sessionList     = document.getElementById('sessionList');

const importZone      = document.getElementById('importZone');
const importLabel     = document.getElementById('importLabel');
const fileInput       = document.getElementById('fileInput');
const importStatus    = document.getElementById('importStatus');

const emptyState      = document.getElementById('emptyState');
const chatView        = document.getElementById('chatView');
const messageList     = document.getElementById('messageList');
const messageInput    = document.getElementById('messageInput');
const sendBtn         = document.getElementById('sendBtn');

// ── App state ─────────────────────────────────────────────────────────────────
let activeSessionId  = null;
let importedThreads  = [];
let isStreaming      = false;

// Mutable refs updated by sendMessage so the stable listeners below
// always write to the correct current bubble.
let currentAssistantEl     = null;
let currentAssistantBubble = null;
let currentStreamText      = '';

// ── Register IPC listeners ONCE at startup ────────────────────────────────────
// This is the key fix: listeners are never re-registered per message,
// so they never accumulate and never fire into stale bubbles.
window.api.onChatToken((token) => {
  if (!currentAssistantEl) return;
  currentAssistantBubble.classList.remove('typing-indicator');
  currentStreamText += token;
  currentAssistantEl.innerHTML = renderMarkdown(currentStreamText);
  scrollToBottom();
});

window.api.onSessionUpdated(({ id, title }) => {
  if (id !== activeSessionId) return;
  const item = sessionList.querySelector(`[data-id="${id}"] .session-title`);
  if (item) item.textContent = title;
});

// ── Setup flow ────────────────────────────────────────────────────────────────
async function checkSetup() {
  const { running, modelInstalled } = await window.api.checkOllama();

  if (!running) {
    setupMessage.innerHTML =
      `Ollama isn't running. Install it from <strong>ollama.com</strong>, ` +
      `start it, then relaunch this app.`;
    return;
  }

  if (!modelInstalled) {
    setupMessage.textContent = 'Download the AI model to get started (one-time, ~1 GB).';
    pullModelBtn.classList.remove('hidden');
    return;
  }

  enterApp();
}

pullModelBtn.addEventListener('click', async () => {
  pullModelBtn.disabled = true;
  pullModelBtn.textContent = 'Downloading…';
  pullProgressWrap.classList.remove('hidden');

  window.api.onPullProgress((status) => {
    if (status.total && status.completed) {
      const pct = Math.round((status.completed / status.total) * 100);
      pullProgressFill.style.width = `${pct}%`;
      pullProgressText.textContent = `${pct}%`;
    } else if (status.status) {
      pullProgressText.textContent = status.status;
    }
  });

  const result = await window.api.pullModel();
  if (result.success) {
    setTimeout(enterApp, 400);
  } else {
    setupMessage.textContent = `Download failed: ${result.error}`;
    pullModelBtn.disabled = false;
    pullModelBtn.textContent = 'Retry download';
  }
});

function enterApp() {
  setupOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
  loadSessionList();
}

// ── Session list (sidebar) ────────────────────────────────────────────────────
async function loadSessionList() {
  const { sessions } = await window.api.chatList();
  renderSessionList(sessions || []);
}

function renderSessionList(sessions) {
  sessionList.innerHTML = '';

  if (sessions.length === 0) {
    const li = document.createElement('li');
    li.className = 'session-item';
    li.style.cssText = 'justify-content:center;font-size:12px;cursor:default';
    li.textContent = 'No chats yet';
    sessionList.appendChild(li);
    return;
  }

  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
    li.dataset.id = s.id;

    const title = document.createElement('span');
    title.className = 'session-title';
    title.textContent = s.title;

    const del = document.createElement('button');
    del.className = 'session-delete';
    del.textContent = '✕';
    del.title = 'Delete chat';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    li.appendChild(title);
    li.appendChild(del);
    li.addEventListener('click', () => openSession(s.id));
    sessionList.appendChild(li);
  }
}

async function createNewChat() {
  const { session } = await window.api.chatCreate();
  await loadSessionList();
  openSession(session.id);
}

async function deleteSession(id) {
  await window.api.chatDelete(id);
  if (activeSessionId === id) {
    activeSessionId = null;
    showEmptyState();
  }
  await loadSessionList();
}

async function openSession(id) {
  activeSessionId = id;

  document.querySelectorAll('.session-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  const { session } = await window.api.chatGet(id);
  renderMessages(session.messages || []);
  showChatView();
  scrollToBottom();
  messageInput.focus();
}

// ── Message rendering ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (window.marked && text) {
    return window.marked.parse(text, { breaks: true, gfm: true });
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMessages(messages) {
  messageList.innerHTML = '';
  for (const msg of messages) {
    appendMessageBubble(msg.role, msg.text);
  }
}

function appendMessageBubble(role, text) {
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'Y' : 'AI';

  const body = document.createElement('div');
  body.className = 'message-body';

  const roleLabel = document.createElement('div');
  roleLabel.className = 'message-role';
  roleLabel.textContent = role === 'user' ? 'You' : 'Assistant';

  const textEl = document.createElement('div');
  textEl.className = 'message-text';

  if (role === 'assistant' && text) {
    textEl.innerHTML = renderMarkdown(text);
  } else {
    textEl.textContent = text;
  }

  body.appendChild(roleLabel);
  body.appendChild(textEl);
  div.appendChild(avatar);
  div.appendChild(body);
  messageList.appendChild(div);

  return textEl;
}

function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
}

// ── Sending messages ──────────────────────────────────────────────────────────
async function sendMessage() {
  if (isStreaming || !activeSessionId) return;
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  isStreaming = true;
  sendBtn.disabled = true;

  // User bubble
  appendMessageBubble('user', text);

  // Assistant bubble — point the stable listeners at this new element
  const assistantTextEl    = appendMessageBubble('assistant', '');
  const assistantBubble    = assistantTextEl.closest('.message');
  assistantBubble.classList.add('typing-indicator');

  // Update mutable refs so the top-level onChatToken listener writes here
  currentAssistantEl     = assistantTextEl;
  currentAssistantBubble = assistantBubble;
  currentStreamText      = '';

  scrollToBottom();

  const result = await window.api.chatSend(activeSessionId, text, importedThreads);

  // Clean up
  currentAssistantEl     = null;
  currentAssistantBubble = null;
  assistantBubble.classList.remove('typing-indicator');

  if (!result.success) {
    assistantTextEl.textContent = `Error: ${result.error}`;
    assistantTextEl.style.color = 'var(--danger)';
  }

  isStreaming = false;
  sendBtn.disabled = false;
  messageInput.focus();
  scrollToBottom();
}

newChatBtn.addEventListener('click', createNewChat);
emptyNewChatBtn.addEventListener('click', createNewChat);
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
});

// ── Import history ────────────────────────────────────────────────────────────
importZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleImportFile(e.target.files[0]));

importZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  importZone.style.borderColor = 'var(--accent)';
});
importZone.addEventListener('dragleave', () => {
  importZone.style.borderColor = '';
});
importZone.addEventListener('drop', (e) => {
  e.preventDefault();
  importZone.style.borderColor = '';
  handleImportFile(e.dataTransfer.files[0]);
});

async function handleImportFile(file) {
  if (!file) return;
  importLabel.textContent = 'Parsing…';

  const filePath = window.api.getFilePath(file);
  const result = await window.api.parseExport(filePath);

  if (!result.success) {
    importLabel.textContent = '＋ Import chat history';
    importStatus.textContent = `Failed: ${result.error}`;
    importStatus.classList.remove('hidden');
    return;
  }

  importedThreads = result.threads;
  importZone.classList.add('loaded');
  importLabel.textContent = `✓ ${importedThreads.length} conversations loaded`;
  importStatus.textContent = `History loaded — AI will use it as background context.`;
  importStatus.classList.remove('hidden');
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showChatView() {
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
}

function showEmptyState() {
  chatView.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkSetup();
