// ── DOM refs ──────────────────────────────────────────────────────────────────
const setupOverlay     = document.getElementById('setupOverlay');
const setupStatus      = document.getElementById('setupStatus');
const setupSteps       = document.getElementById('setupSteps');
const appShell         = document.getElementById('appShell');
const newChatBtn       = document.getElementById('newChatBtn');
const emptyNewChatBtn  = document.getElementById('emptyNewChatBtn');
const sessionList      = document.getElementById('sessionList');
const historyList      = document.getElementById('historyList');
const importZone       = document.getElementById('importZone');
const importLabel      = document.getElementById('importLabel');
const fileInput        = document.getElementById('fileInput');
const importStatus     = document.getElementById('importStatus');
const emptyState       = document.getElementById('emptyState');
const chatView         = document.getElementById('chatView');
const messageList      = document.getElementById('messageList');
const messageInput     = document.getElementById('messageInput');
const sendBtn          = document.getElementById('sendBtn');
const modelSelect           = document.getElementById('modelSelect');
const modelAction           = document.getElementById('modelAction');
const modelDownloadBtn      = document.getElementById('modelDownloadBtn');
const modelDownloadProgress = document.getElementById('modelDownloadProgress');
const modelDlFill           = document.getElementById('modelDlFill');
const modelDlText           = document.getElementById('modelDlText');

// ── App state ─────────────────────────────────────────────────────────────────
let activeSessionId      = null;
let embeddedThreads      = [];   // all threads from ALL imports merged, with embeddings
let importedSources      = [];   // [{ source, label, count, importedAt }] for history tab
let isStreaming          = false;
let currentAssistantEl   = null;
let currentAssistantBubble = null;
let currentStreamText    = '';
let pendingSources       = null; // sources received before stream starts

const CHAT_MODEL  = 'qwen2.5:3b';
const EMBED_MODEL = 'bge-m3';

let activeModel = CHAT_MODEL; // the model currently used for generation

// Curated catalog of popular Ollama chat models, lightest → heaviest.
// sizeBytes is approximate — used for sorting uninstalled entries.
const MODEL_CATALOG = [
  { name: 'qwen2.5:0.5b',   label: 'Qwen 2.5 · 0.5B',    sizeBytes:   397_000_000 },
  { name: 'gemma3:1b',      label: 'Gemma 3 · 1B',         sizeBytes:   815_000_000 },
  { name: 'qwen2.5:1.5b',   label: 'Qwen 2.5 · 1.5B',     sizeBytes:   986_000_000 },
  { name: 'llama3.2:1b',    label: 'Llama 3.2 · 1B',       sizeBytes: 1_321_000_000 },
  { name: 'qwen2.5:3b',     label: 'Qwen 2.5 · 3B',        sizeBytes: 1_900_000_000 },
  { name: 'llama3.2:3b',    label: 'Llama 3.2 · 3B',       sizeBytes: 2_020_000_000 },
  { name: 'phi4-mini',      label: 'Phi 4 Mini · 3.8B',    sizeBytes: 2_500_000_000 },
  { name: 'gemma3:4b',      label: 'Gemma 3 · 4B',         sizeBytes: 3_300_000_000 },
  { name: 'mistral',        label: 'Mistral · 7B',          sizeBytes: 4_100_000_000 },
  { name: 'llama3.1:8b',    label: 'Llama 3.1 · 8B',       sizeBytes: 4_700_000_000 },
  { name: 'qwen2.5:7b',     label: 'Qwen 2.5 · 7B',        sizeBytes: 4_700_000_000 },
  { name: 'gemma3:12b',     label: 'Gemma 3 · 12B',        sizeBytes: 8_100_000_000 },
  { name: 'qwen2.5:14b',    label: 'Qwen 2.5 · 14B',       sizeBytes: 9_000_000_000 },
  { name: 'phi4',           label: 'Phi 4 · 14B',           sizeBytes: 9_100_000_000 },
  { name: 'llama3.3:70b',   label: 'Llama 3.3 · 70B',      sizeBytes: 43_000_000_000 },
  { name: 'qwen2.5:72b',    label: 'Qwen 2.5 · 72B',       sizeBytes: 47_000_000_000 },
];

const SOURCE_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', unknown: 'Unknown' };
const SOURCE_COLORS = { chatgpt: '#10a37f', claude: '#cc785c', unknown: '#6c8cff' };

// ── Stable IPC listeners ──────────────────────────────────────────────────────
window.api.onChatToken((token) => {
  if (!currentAssistantEl) return;
  currentAssistantBubble.classList.remove('typing-indicator');
  currentStreamText += token;
  currentAssistantEl.innerHTML = renderMarkdown(currentStreamText);

  // Render source chips once the first token arrives
  if (pendingSources) {
    renderSourceChips(currentAssistantBubble, pendingSources);
    pendingSources = null;
  }
  scrollToBottom();
});

window.api.onSessionUpdated(({ id, title }) => {
  if (id !== activeSessionId) return;
  const item = sessionList.querySelector(`[data-id="${id}"] .session-title`);
  if (item) item.textContent = title;
});

window.api.onChatSources((sources) => {
  // Store until first token arrives so we can attach chips to the right bubble
  pendingSources = sources;
});

// ── Setup flow ────────────────────────────────────────────────────────────────
async function checkSetup() {
  const result = await window.api.checkOllama();
  if (!result.running) {
    setupStatus.innerHTML = `Ollama isn't running. Install it from <strong>ollama.com</strong>, start it, then relaunch this app.`;
    return;
  }
  const missing = [];
  if (!result.chatInstalled)  missing.push({ model: CHAT_MODEL,  label: 'Default Chat model (Qwen 2.5 3B)', size: '~1.9 GB' });
  if (!result.embedInstalled) missing.push({ model: EMBED_MODEL, label: 'Multilingual Embedding Model (bge-m3)', size: '~560 MB' });
  if (missing.length === 0) { enterApp(); return; }
  setupStatus.textContent = `${missing.length} model${missing.length > 1 ? 's' : ''} need${missing.length === 1 ? 's' : ''} to be downloaded.`;
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
      <span class="step-status">Waiting…</span>`;
    setupSteps.appendChild(row);
  });
  pullSequentially(missing, 0);
}

async function pullSequentially(missing, index) {
  if (index >= missing.length) { setTimeout(enterApp, 500); return; }
  const { model } = missing[index];
  const stepEl       = document.getElementById(`step-${model.replace(/[:.]/g, '-')}`);
  const progressWrap = stepEl.querySelector('.step-progress');
  const progressFill = stepEl.querySelector('.progress-fill');
  const progressText = stepEl.querySelector('.progress-text');
  const statusEl     = stepEl.querySelector('.step-status');

  statusEl.textContent = 'Downloading…';
  statusEl.style.color = 'var(--accent)';
  progressWrap.classList.remove('hidden');

  window.api.onPullProgress((status) => {
    if (status.model !== model) return;
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
    statusEl.textContent = '✓ Done';
    statusEl.style.color = 'var(--success)';
    pullSequentially(missing, index + 1);
  } else {
    statusEl.textContent = `Failed: ${result.error}`;
    statusEl.style.color = 'var(--danger)';
  }
}

async function enterApp() {
  setupOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
  loadSessionList();
  loadModelSelector();
  await initSavedHistory();
}

async function initSavedHistory() {
  try {
    const res = await window.api.loadSavedHistory();
    if (res.success && res.threads && res.threads.length > 0) {
      embeddedThreads = res.threads;
      importZone.classList.add('loaded');
      importLabel.textContent = `✓ ${embeddedThreads.length} total conversations`;
      importStatus.classList.remove('hidden');
      importStatus.textContent = `Loaded ${embeddedThreads.length} conversations from disk.`;
      renderHistoryTab();
    }
  } catch (err) {
    console.warn('Could not load saved history:', err);
  }
}

// ── Model selector ────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return '?';
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

async function loadModelSelector() {
  try {
    const result = await window.api.listModels();
    const installed = (result.success && result.models) ? result.models : [];

    // Helper: does the catalog name match an installed model?
    function findInstalled(catalogName) {
      return installed.find(
        (m) => m.name === catalogName || m.name.startsWith(catalogName + ':')
      );
    }

    // Build list: catalog entries merged with any extra installed chat models
    const catalogNameSet = new Set(MODEL_CATALOG.map((m) => m.name));
    const extras = installed
      .filter((m) => !/embed/i.test(m.name))
      .filter((m) => !MODEL_CATALOG.some((c) => m.name === c.name || m.name.startsWith(c.name + ':')))
      .map((m) => ({ name: m.name, label: m.name.replace(/:latest$/, ''), sizeBytes: m.size || 0, _extra: true }));

    const allEntries = [...MODEL_CATALOG, ...extras]
      .sort((a, b) => a.sizeBytes - b.sizeBytes);

    modelSelect.innerHTML = '';
    for (const entry of allEntries) {
      const inst = findInstalled(entry.name);
      const opt  = document.createElement('option');
      opt.value  = entry.name;
      opt.dataset.installed = inst ? 'true' : 'false';
      const sizeStr = inst ? formatBytes(inst.size) : `~${formatBytes(entry.sizeBytes)}`;
      opt.textContent = inst
        ? `✓  ${entry.label}  (${sizeStr})`
        : `⬇  ${entry.label}  (${sizeStr})`;
      modelSelect.appendChild(opt);
    }

    // Select activeModel if present, else first installed entry
    const activeOpt = [...modelSelect.options].find(
      (o) => o.value === activeModel || o.value.startsWith(activeModel + ':')
    );
    if (activeOpt) {
      modelSelect.value = activeOpt.value;
    } else {
      const firstInstalled = [...modelSelect.options].find((o) => o.dataset.installed === 'true');
      if (firstInstalled) { modelSelect.value = firstInstalled.value; activeModel = firstInstalled.value; }
    }

    refreshModelAction();
  } catch (err) {
    console.warn('Could not load model list:', err);
  }
}

function refreshModelAction() {
  const opt = modelSelect.options[modelSelect.selectedIndex];
  if (!opt) { modelAction.classList.add('hidden'); return; }
  const isInstalled = opt.dataset.installed === 'true';
  modelAction.classList.toggle('hidden', isInstalled);
  if (!isInstalled) {
    modelDownloadProgress.classList.add('hidden');
    modelDownloadBtn.classList.remove('hidden');
    modelDownloadBtn.disabled = false;
    modelDownloadBtn.textContent = '⬇ Download';
  }
}

modelSelect.addEventListener('change', () => {
  const opt = modelSelect.options[modelSelect.selectedIndex];
  if (opt && opt.dataset.installed === 'true') activeModel = modelSelect.value;
  refreshModelAction();
});

modelDownloadBtn.addEventListener('click', async () => {
  const modelName = modelSelect.value;

  modelDownloadBtn.classList.add('hidden');
  modelDownloadProgress.classList.remove('hidden');
  modelDlFill.style.width = '0%';
  modelDlText.textContent = 'Starting…';

  window.api.onPullProgress((status) => {
    if (status.model !== modelName) return;
    if (status.total && status.completed) {
      const pct = Math.round((status.completed / status.total) * 100);
      modelDlFill.style.width = `${pct}%`;
      modelDlText.textContent = `${pct}%`;
    } else if (status.status) {
      modelDlText.textContent = status.status;
    }
  });

  const result = await window.api.pullModel(modelName);

  if (result.success) {
    modelDlFill.style.width = '100%';
    modelDlText.textContent = '✓ Done';
    activeModel = modelName;
    // Refresh the list so the entry flips to ✓ installed
    setTimeout(() => loadModelSelector(), 800);
  } else {
    modelDlText.textContent = 'Failed';
    modelDownloadBtn.classList.remove('hidden');
    modelDownloadBtn.disabled = false;
    modelDownloadBtn.textContent = '⬇ Retry';
  }
});

// ── Sidebar tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.sidebar-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`tab${tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)}`).classList.remove('hidden');
  });
});

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

// ── History tab ───────────────────────────────────────────────────────────────
function renderHistoryTab() {
  if (importedSources.length === 0) {
    historyList.innerHTML = '<p class="history-empty">No history imported yet.<br/>Use the import button below.</p>';
    return;
  }

  historyList.innerHTML = '';

  // Group threads by source
  const groups = {};
  for (const t of embeddedThreads) {
    const src = t.source || 'unknown';
    if (!groups[src]) groups[src] = [];
    groups[src].push(t);
  }

  for (const [source, threads] of Object.entries(groups)) {
    const section = document.createElement('div');
    section.className = 'history-section';

    const header = document.createElement('div');
    header.className = 'history-source-header';
    header.innerHTML = `
      <span class="source-dot" style="background:${SOURCE_COLORS[source] || SOURCE_COLORS.unknown}"></span>
      <span class="source-name">${SOURCE_LABELS[source] || source}</span>
      <span class="source-count">${threads.length} conversations</span>`;

    const list = document.createElement('ul');
    list.className = 'history-thread-list';

    // Sort by date descending, show up to 100
    const sorted = [...threads]
      .sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      .slice(0, 100);

    for (const t of sorted) {
      const li = document.createElement('li');
      li.className = 'history-thread-item';
      const date = t.createTime
        ? new Date(t.createTime * 1000).toLocaleDateString()
        : 'Unknown date';
      li.innerHTML = `
        <span class="history-thread-title">${escapeHtml(t.title)}</span>
        <span class="history-thread-date">${date}</span>`;
      list.appendChild(li);
    }

    section.appendChild(header);
    section.appendChild(list);
    historyList.appendChild(section);
  }
}

// ── Message rendering ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  // Collapse multiple blank lines before numbered headers, bold lines, and bullet points
  let cleaned = text
    .replace(/\n\s*\n+(\s*(\d+\.|\*\*|[\u2022\u25E6\u25CB\u2023\u2013\-\*]))/g, '\n$1')
    .replace(/(\n\s*){3,}/g, '\n\n'); // Never allow more than 2 consecutive newlines anywhere
  if (window.marked) return window.marked.parse(cleaned, { breaks: false, gfm: true });
  const d = document.createElement('div');
  d.textContent = cleaned;
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

function renderSourceChips(bubbleEl, sources) {
  if (!sources || sources.length === 0) return;

  // Remove any existing chips on this bubble
  const existing = bubbleEl.querySelector('.source-chips');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = 'source-chips';

  const label = document.createElement('span');
  label.className = 'source-chips-label';
  label.textContent = 'Sources:';
  wrap.appendChild(label);

  for (const s of sources) {
    const chip = document.createElement('span');
    chip.className = 'source-chip';
    chip.style.borderColor = SOURCE_COLORS[s.source] || SOURCE_COLORS.unknown;
    chip.style.color = SOURCE_COLORS[s.source] || SOURCE_COLORS.unknown;
    chip.title = `${SOURCE_LABELS[s.source] || s.source} · similarity ${(s.score * 100).toFixed(0)}%${s.date ? ` · ${s.date}` : ''}`;
    chip.textContent = `${SOURCE_LABELS[s.source] || s.source}: ${s.title.slice(0, 35)}${s.title.length > 35 ? '…' : ''}`;
    wrap.appendChild(chip);
  }

  // Append to the message body, not the text element
  const body = bubbleEl.querySelector('.message-body');
  if (body) body.appendChild(wrap);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
  pendingSources = null;

  appendMessageBubble('user', text);

  const assistantTextEl = appendMessageBubble('assistant', '');
  const assistantBubble = assistantTextEl.closest('.message');
  assistantBubble.classList.add('typing-indicator');

  currentAssistantEl     = assistantTextEl;
  currentAssistantBubble = assistantBubble;
  currentStreamText      = '';

  scrollToBottom();

  const result = await window.api.chatSend(activeSessionId, text, embeddedThreads, activeModel);

  currentAssistantEl     = null;
  currentAssistantBubble = null;
  assistantBubble.classList.remove('typing-indicator');

  // If sources arrived but no tokens came (error case), still render chips
  if (pendingSources) {
    renderSourceChips(assistantBubble, pendingSources);
    pendingSources = null;
  }

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

// ── Import history ────────────────────────────────────────────────────────────
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

  const { threads, source } = parseResult;
  importLabel.textContent = `Checking cache for ${threads.length} conversations…`;
  importZone.classList.add('loading');

  window.api.onEmbedProgress(({ done, total, cached, toEmbed, embedDone }) => {
    if (toEmbed === 0) {
      importLabel.textContent = `✓ All ${total} from cache`;
    } else if (embedDone !== undefined) {
      importLabel.textContent = `${cached} cached · ${embedDone}/${toEmbed} new`;
    } else {
      importLabel.textContent = `${cached} cached · ${toEmbed} to embed…`;
    }
  });

  // Pass existing embedded threads so the handler can merge
  const embedResult = await window.api.embedThreads(threads, embeddedThreads);

  importZone.classList.remove('loading');

  if (!embedResult.success) {
    importLabel.textContent = '＋ Import chat history';
    importStatus.textContent = `Embedding failed: ${embedResult.error}`;
    return;
  }

  // Merge into app state
  embeddedThreads = embedResult.threads;

  // Track this import in sources list
  const sourceLabel = SOURCE_LABELS[source] || source;
  importedSources.push({
    source,
    label: sourceLabel,
    count: threads.length,
    importedAt: new Date().toLocaleString()
  });

  importZone.classList.add('loaded');
  const { stats } = embedResult;
  importLabel.textContent = `✓ ${embeddedThreads.length} total conversations`;

  if (stats.new === 0) {
    importStatus.textContent = `${sourceLabel}: all ${stats.thisImport} from cache. Total: ${stats.total} conversations.`;
  } else {
    importStatus.textContent = `${sourceLabel}: ${stats.cached} from cache + ${stats.new} new. Total: ${stats.total} conversations.`;
  }

  // Update history tab
  renderHistoryTab();

  // Switch to history tab to show the user what was imported
  document.querySelector('[data-tab="history"]').click();
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showChatView() { emptyState.classList.add('hidden'); chatView.classList.remove('hidden'); }
function showEmptyState() { chatView.classList.add('hidden'); emptyState.classList.remove('hidden'); }

// ── Init ──────────────────────────────────────────────────────────────────────
checkSetup();
