// ── DOM refs ──────────────────────────────────────────────────────────────────
const setupOverlay     = document.getElementById('setupOverlay');
const setupStatus      = document.getElementById('setupStatus');
const setupSteps       = document.getElementById('setupSteps');
const appShell         = document.getElementById('appShell');
const newChatBtn       = document.getElementById('newChatBtn');
const emptyNewChatBtn  = document.getElementById('emptyNewChatBtn');
const sessionList      = document.getElementById('sessionList');
const importZone       = document.getElementById('importZone');
const importLabel      = document.getElementById('importLabel');
const fileInput        = document.getElementById('fileInput');
const importStatus     = document.getElementById('importStatus');
const emptyState       = document.getElementById('emptyState');
const chatView         = document.getElementById('chatView');
const messageList      = document.getElementById('messageList');
const messageInput     = document.getElementById('messageInput');
const sendBtn          = document.getElementById('sendBtn');

// ── App state ─────────────────────────────────────────────────────────────────
let activeSessionId      = null;
let embeddedThreads      = [];   // threads with .embedding vectors, kept in memory
let isStreaming          = false;
let currentAssistantEl   = null;
let currentAssistantBubble = null;
let currentStreamText    = '';

// ── Stable IPC listeners (registered once at startup) ────────────────────────
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
// Models needed: chat model + embed model
const CHAT_MODEL  = 'qwen3.5:0.8b';
const EMBED_MODEL = 'nomic-embed-text';

async function checkSetup() {
  const result = await window.api.checkOllama();

  if (!result.running) {
    setupStatus.innerHTML =
      `Ollama isn't running. Install it from <strong>ollama.com</strong>, start it, then relaunch this app.`;
    return;
  }

  // Build a list of what's missing and render steps for each
  const missing = [];
  if (!result.chatInstalled) missing.push({ model: CHAT_MODEL, label: 'Chat model', size: '~1 GB' });
  if (!result.embedInstalled) missing.push({ model: EMBED_MODEL, label: 'Embedding model', size: '~274 MB' });

  if (missing.length === 0) {
    enterApp();
    return;
  }

  setupStatus.textContent = `${missing.length === 2 ? 'Two models' : 'One model'} need${missing.length === 1 ? 's' : ''} to be downloaded.`;
  renderSetupSteps(missing);
}

function renderSetupSteps(missing) {
  setupSteps.innerHTML = '';

  missing.forEach(({ model, label, size }) => {
    const row = document.createElement('div');
    row.className = 'setup-step';
    row.id = `step-${model.replace(/[:.]/g, '-')}`;

    row.innerHTML = `
      <div class="step-info">
        <span class="step-label">${label}</span>
        <span class="step-size">${size}</span>
      </div>
      <div class="step-progress hidden">
        <div class="progress-bar"><div class="progress-fill"></div></div>
        <span class="progress-text">0%</span>
      </div>
      <span class="step-status">Waiting…</span>
    `;
    setupSteps.appendChild(row);
  });

  // Pull models sequentially — only the ones that are missing
  pullSequentially(missing, 0);
}

async function pullSequentially(missing, index) {
  if (index >= missing.length) {
    // All done
    setTimeout(enterApp, 500);
    return;
  }

  const { model, label } = missing[index];
  const stepEl    = document.getElementById(`step-${model.replace(/[:.]/g, '-')}`);
  const progressWrap = stepEl.querySelector('.step-progress');
  const progressFill = stepEl.querySelector('.progress-fill');
  const progressText = stepEl.querySelector('.progress-text');
  const statusEl  = stepEl.querySelector('.step-status');

  statusEl.textContent = 'Downloading…';
  statusEl.style.color = 'var(--accent)';
  progressWrap.classList.remove('hidden');

  window.api.onPullProgress((status) => {
    if (status.model !== model) return; // ignore progress for other models
    if (status.total && status.completed) {
      const pct = Math.round((status.completed / status.total) * 100);
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `${pct}%`;
    } else if (status.status) {
      progressText.textContent = status.status;
    }
  });

  const result = await window.api.pullModel(model);

  if (result.success) {
    progressFill.style.width = '100%';
    progressText.textContent = '100%';
    statusEl.textContent = '✓ Done';
    statusEl.style.color = 'var(--success)';
    // Pull the next missing model
    pullSequentially(missing, index + 1);
  } else {
    statusEl.textContent = `Failed: ${result.error}`;
    statusEl.style.color = 'var(--danger)';
  }
}

function enterApp() {
  setupOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
  loadSessionList();
}

// ── Session list ──────────────────────────────────────────────────────────────
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
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });

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
  if (activeSessionId === id) { activeSessionId = null; showEmptyState(); }
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
  if (window.marked && text) return window.marked.parse(text, { breaks: true, gfm: true });
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function renderMessages(messages) {
  messageList.innerHTML = '';
  for (const msg of messages) appendMessageBubble(msg.role, msg.text);
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
  if (role === 'assistant' && text) textEl.innerHTML = renderMarkdown(text);
  else textEl.textContent = text;

  body.appendChild(roleLabel);
  body.appendChild(textEl);
  div.appendChild(avatar);
  div.appendChild(body);
  messageList.appendChild(div);
  return textEl;
}

function scrollToBottom() { messageList.scrollTop = messageList.scrollHeight; }

// ── Sending messages ──────────────────────────────────────────────────────────
async function sendMessage() {
  if (isStreaming || !activeSessionId) return;
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  isStreaming = true;
  sendBtn.disabled = true;

  appendMessageBubble('user', text);

  const assistantTextEl = appendMessageBubble('assistant', '');
  const assistantBubble = assistantTextEl.closest('.message');
  assistantBubble.classList.add('typing-indicator');

  currentAssistantEl     = assistantTextEl;
  currentAssistantBubble = assistantBubble;
  currentStreamText      = '';

  scrollToBottom();

  const result = await window.api.chatSend(activeSessionId, text, embeddedThreads);

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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
});

// ── Import history + embedding ────────────────────────────────────────────────
importZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleImportFile(e.target.files[0]));
importZone.addEventListener('dragover', (e) => { e.preventDefault(); importZone.style.borderColor = 'var(--accent)'; });
importZone.addEventListener('dragleave', () => { importZone.style.borderColor = ''; });
importZone.addEventListener('drop', (e) => {
  e.preventDefault();
  importZone.style.borderColor = '';
  handleImportFile(e.dataTransfer.files[0]);
});

async function handleImportFile(file) {
  if (!file) return;

  // Step 1: parse
  importLabel.textContent = 'Parsing file…';
  importStatus.textContent = '';
  importStatus.classList.remove('hidden');

  const filePath = window.api.getFilePath(file);
  const parseResult = await window.api.parseExport(filePath);

  if (!parseResult.success) {
    importLabel.textContent = '＋ Import chat history';
    importStatus.textContent = `Failed to parse: ${parseResult.error}`;
    return;
  }

  const threads = parseResult.threads;
  importStatus.textContent = `Parsed ${threads.length} conversations. Now embedding — this may take a few minutes…`;
  importLabel.textContent = 'Embedding 0 / ' + threads.length;
  importZone.classList.add('loading');

  // Step 2: embed — streams progress back
  window.api.onEmbedProgress(({ done, total }) => {
    importLabel.textContent = `Embedding ${done} / ${total}`;
    importStatus.textContent = `Generating semantic vectors… ${done} / ${total} conversations`;
  });

  const embedResult = await window.api.embedThreads(threads);

  if (!embedResult.success) {
    importLabel.textContent = '＋ Import chat history';
    importStatus.textContent = `Embedding failed: ${embedResult.error}`;
    importZone.classList.remove('loading');
    return;
  }

  embeddedThreads = embedResult.threads;
  importZone.classList.remove('loading');
  importZone.classList.add('loaded');
  importLabel.textContent = `✓ ${embeddedThreads.length} conversations ready`;
  importStatus.textContent = `Semantic search active — AI will find the most relevant context for each message.`;
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showChatView() { emptyState.classList.add('hidden'); chatView.classList.remove('hidden'); }
function showEmptyState() { chatView.classList.add('hidden'); emptyState.classList.remove('hidden'); }

// ── Init ──────────────────────────────────────────────────────────────────────
checkSetup();
