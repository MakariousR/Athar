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
const attachImgBtn     = document.getElementById('attachImgBtn');
const imageFileInput   = document.getElementById('imageFileInput');
const imagePreviewBar  = document.getElementById('imagePreviewBar');
const attachDocBtn     = document.getElementById('attachDocBtn');
const documentFileInput = document.getElementById('documentFileInput');
const docPreviewBar    = document.getElementById('docPreviewBar');
const inputContainer   = document.getElementById('inputContainer');
const sessionResourcesBar  = document.getElementById('sessionResourcesBar');
const sessionResourcesList = document.getElementById('sessionResourcesList');
const modelSelect           = document.getElementById('modelSelect');
const modelAction           = document.getElementById('modelAction');
const modelDownloadBtn      = document.getElementById('modelDownloadBtn');
const modelDeleteBtn        = document.getElementById('modelDeleteBtn');
const modelDownloadProgress = document.getElementById('modelDownloadProgress');
const modelDlFill           = document.getElementById('modelDlFill');
const modelDlText           = document.getElementById('modelDlText');
const sidebarCapCard        = document.getElementById('sidebarCapCard');

const setupChoices          = document.getElementById('setupChoices');
const setupDefaultBtn       = document.getElementById('setupDefaultBtn');
const setupSelectedBtn      = document.getElementById('setupSelectedBtn');
const setupModelSelect      = document.getElementById('setupModelSelect');
const setupCapCard          = document.getElementById('setupCapCard');

const workspaceZone         = document.getElementById('workspaceZone');
const workspaceText         = document.getElementById('workspaceText');
const clearWorkspaceBtn     = document.getElementById('clearWorkspaceBtn');

const permissionModal       = document.getElementById('permissionModal');
const permSub               = document.getElementById('permSub');
const permToolName          = document.getElementById('permToolName');
const permTarget            = document.getElementById('permTarget');
const permPreviewBlock      = document.getElementById('permPreviewBlock');
const permContent           = document.getElementById('permContent');
const permDenyBtn           = document.getElementById('permDenyBtn');
const permApproveBtn        = document.getElementById('permApproveBtn');

const settingsModal         = document.getElementById('settingsModal');
const settingsBtn           = document.getElementById('settingsBtn');
const sidebarSettingsBtn    = document.getElementById('sidebarSettingsBtn');
const closeSettingsBtn      = document.getElementById('closeSettingsBtn');
const settingsBackdrop      = document.querySelector('.settings-backdrop');

const sidebarToggleBtn      = document.getElementById('sidebarToggleBtn');
const headerChatTitle       = document.getElementById('headerChatTitle');
const headerModelPill       = document.getElementById('headerModelPill');
const headerModelName       = document.getElementById('headerModelName');

// ── App state ─────────────────────────────────────────────────────────────────
let activeSessionId      = null;
let activeWorkspaceDir   = null;
let currentPermissionReqId = null;
const permissionQueue    = [];   // requests waiting behind the one on screen (tools can run in parallel)
let memoryStats          = null; // latest stats from the main process (counts per source, indexing progress)
let lastImportNote       = '';   // summary of the most recent import, kept visible in the status line
let isStreaming          = false;
let currentAssistantEl   = null;
let currentAssistantBubble = null;
let currentStreamText    = '';
let pendingSources       = null; // sources received before stream starts
let attachedImages       = [];   // [{ name, dataUrl, base64 }]
let attachedDocuments    = [];   // metadata only: [{ id, name, ext, size, pageCount, lineCount, charCount, noText, reused }] — text stays in the main process

const CHAT_MODEL  = 'qwen2.5-coder:7b';
const EMBED_MODEL = 'bge-m3';
const CHAT_MODEL_LABEL  = 'Qwen 2.5 Coder 7B';
const CHAT_MODEL_SIZE   = '~4.7 GB';
const EMBED_MODEL_SIZE  = '~1.2 GB';
const ACTIVE_MODEL_KEY  = 'activeModel';

function loadSavedModel() {
  try { return localStorage.getItem(ACTIVE_MODEL_KEY); } catch { return null; }
}
function saveActiveModel(name) {
  try { localStorage.setItem(ACTIVE_MODEL_KEY, name); } catch { /* storage unavailable */ }
}

// The model currently used for generation — remembered across launches, so a
// model picked during setup (or later) stays selected.
let activeModel = loadSavedModel() || CHAT_MODEL;
let setupNeedsEmbed = false;

// Curated catalog of popular Ollama chat models with rich capability metadata.
const MODEL_CATALOG = [
  { name: 'qwen2.5:0.5b',      label: 'Qwen 2.5 · 0.5B',        sizeBytes:   397_000_000, ram: '~1.5 GB', vision: false, desc: 'Ultra-fast & lightweight. Best for quick answers on low-spec hardware.' },
  { name: 'gemma3:1b',         label: 'Gemma 3 · 1B',           sizeBytes:   815_000_000, ram: '~2.0 GB', vision: false, desc: 'Google lightweight model. Fast response, low resource footprint.' },
  { name: 'qwen2.5:1.5b',      label: 'Qwen 2.5 · 1.5B',       sizeBytes:   986_000_000, ram: '~2.2 GB', vision: false, desc: 'Great balance of speed and multilingual comprehension.' },
  { name: 'llama3.2:1b',       label: 'Llama 3.2 · 1B',         sizeBytes: 1_321_000_000, ram: '~2.5 GB', vision: false, desc: 'Meta lightweight model. Quick summary and chat completion.' },
  { name: 'qwen2.5:3b',        label: 'Qwen 2.5 · 3B',          sizeBytes: 1_900_000_000, ram: '~3.5 GB', vision: false, desc: 'Strong multilingual reasoning, tool calling & history search on modest hardware.' },
  { name: 'qwen2.5vl:3b',      label: 'Qwen 2.5 VL · 3B',       sizeBytes: 3_200_000_000, ram: '~5.0 GB', vision: true,  desc: '🖼️ Compact vision model: understands images and screenshots.' },
  { name: 'llama3.2:3b',       label: 'Llama 3.2 · 3B',         sizeBytes: 2_020_000_000, ram: '~4.0 GB', vision: false, desc: 'Meta efficient model. Good instruction following & text generation.' },
  { name: 'phi4-mini',         label: 'Phi 4 Mini · 3.8B',      sizeBytes: 2_500_000_000, ram: '~4.5 GB', vision: false, desc: 'Microsoft compact reasoning model. Strong math & logic abilities.' },
  { name: 'gemma3:4b',         label: 'Gemma 3 · 4B',           sizeBytes: 3_300_000_000, ram: '~5.0 GB', vision: true,  desc: '🖼️ Includes Vision & 140+ languages. Can analyze uploaded images & screenshots.' },
  { name: 'mistral',           label: 'Mistral · 7B',            sizeBytes: 4_100_000_000, ram: '~7.0 GB', vision: false, desc: 'Classic 7B benchmark model. Excellent code & text writing.' },
  { name: 'llama3.1:8b',       label: 'Llama 3.1 · 8B',         sizeBytes: 4_700_000_000, ram: '~8.0 GB', vision: false, desc: 'Meta flagship 8B model. Deep reasoning & complex task handling.' },
  { name: 'qwen2.5:7b',        label: 'Qwen 2.5 · 7B',          sizeBytes: 4_700_000_000, ram: '~8.0 GB', vision: false, desc: 'World-class 7B coding & reasoning. Exceptional multilingual & tool calling.' },
  { name: 'qwen2.5-coder:7b',  label: 'Qwen 2.5 Coder · 7B',    sizeBytes: 4_700_000_000, ram: '~8.0 GB', vision: false, desc: '⭐ Default Recommended. Code-focused 7B with reliable tool calling for workspace file & Git tasks.' },
  { name: 'qwen2.5vl:7b',      label: 'Qwen 2.5 VL · 7B',       sizeBytes: 5_970_000_000, ram: '~9.0 GB', vision: true,  desc: '🖼️ Stronger vision model: image understanding, document reading and reasoning.' },
  { name: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision · 11B', sizeBytes: 7_900_000_000, ram: '~11 GB',  vision: true,  desc: '🖼️ Meta flagship vision model. High-res image understanding, document OCR & tools.' },
  { name: 'gemma3:12b',        label: 'Gemma 3 · 12B',          sizeBytes: 8_100_000_000, ram: '~12 GB',  vision: true,  desc: '🖼️ Powerful multimodal model. Deep reasoning, coding & visual document analysis.' },
  { name: 'qwen2.5:14b',       label: 'Qwen 2.5 · 14B',         sizeBytes: 9_000_000_000, ram: '~14 GB',  vision: false, desc: 'High-tier reasoning & long-document analysis for powerful PCs.' },
  { name: 'phi4',              label: 'Phi 4 · 14B',             sizeBytes: 9_100_000_000, ram: '~14 GB',  vision: false, desc: 'Microsoft flagship 14B logic & math model.' },
  { name: 'llama3.3:70b',      label: 'Llama 3.3 · 70B',        sizeBytes: 43_000_000_000, ram: '~48 GB',  vision: false, desc: 'Enterprise-grade 70B model. Requires high-end GPU / VRAM workstation.' },
  { name: 'qwen2.5:72b',       label: 'Qwen 2.5 · 72B',         sizeBytes: 47_000_000_000, ram: '~52 GB',  vision: false, desc: 'Top-of-the-line 72B model. Maximum capability for workstation hardware.' }
];

// What Ollama reports each INSTALLED model can do, e.g. ["completion","tools","vision"].
// Authoritative when present; the catalog's `vision` flag is only a fallback.
const installedCapabilities = new Map();

function getModelInfo(modelName) {
  const info = MODEL_CATALOG.find((m) => m.name === modelName || m.name.startsWith(modelName + ':')) || {
    name: modelName,
    label: modelName,
    ram: 'Unknown',
    vision: false,
    desc: 'Custom installed model.'
  };
  const caps = installedCapabilities.get(modelName);
  if (!caps) return info;
  return { ...info, vision: caps.includes('vision'), tools: caps.includes('tools') };
}

function renderCapCard(modelName, containerEl) {
  if (!containerEl) return;
  const info = getModelInfo(modelName);
  const toolsRow = info.tools === undefined ? '' : info.tools
    ? '<div class="cap-row"><span>Tools:</span> <span class="cap-val">✓ web search, memory search, files</span></div>'
    : '<div class="cap-row cap-warn"><span>Tools:</span> <span class="cap-val">✗ not supported — can\'t search or read files on its own (memory and automatic web research still work)</span></div>';
  containerEl.innerHTML = `
    <div class="cap-title">
      <span>${escapeHtml(info.label)}</span>
      <span class="cap-badge ${info.vision ? 'vision' : ''}">${info.vision ? '🖼️ Vision + Text' : '⚡ Text Only'}</span>
    </div>
    <div class="cap-row"><span>RAM Required:</span> <span class="cap-val">${info.ram}</span></div>
    ${toolsRow}
    <div class="cap-desc">${escapeHtml(info.desc)}</div>
  `;
  containerEl.classList.remove('hidden');
}

const SOURCE_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', app: 'This app', unknown: 'Imported' };
const SOURCE_COLORS = { chatgpt: '#10a37f', claude: '#cc785c', gemini: '#4285f4', app: '#ab68ff', unknown: '#6c8cff' };

// ── Stable IPC listeners ──────────────────────────────────────────────────────

// FIX: rendering full markdown on every single token was O(n^2) over a long
// response (re-parsing the whole accumulated string each time) and caused
// visible jank on longer answers. Batch DOM updates to at most once per
// animation frame instead of once per token — still feels live, far cheaper.
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled || !currentAssistantEl) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (currentAssistantEl) currentAssistantEl.innerHTML = renderMarkdown(currentStreamText);
    scrollToBottom();
  });
}

window.api.onChatToken((token) => {
  if (!currentAssistantEl) return;
  currentAssistantBubble.classList.remove('typing-indicator');
  currentStreamText += token;
  scheduleRender();

  // Render source chips once the first token arrives
  if (pendingSources) {
    renderSourceChips(currentAssistantBubble, pendingSources);
    pendingSources = null;
  }
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

window.api.onChatStatus((statusData) => {
  if (!currentAssistantBubble) return;

  const info = typeof statusData === 'object'
    ? statusData
    : { icon: '⚡', text: statusData };

  // FIX: the backend agent loop can run several internal steps before it has
  // a real final answer (e.g. a step that streams "let me search for that…"
  // and then turns out to just be a tool call). Previously every step's
  // tokens kept getting appended to the same `currentStreamText`, with
  // nothing to say "that text wasn't the answer, throw it away." That let
  // leftover thinking text and even raw fallback tool-call JSON get stuck in
  // front of the real answer. The backend now emits `{ type: 'reset' }`
  // right before each new step starts (and immediately once it detects a
  // step ended in a tool call), and we clear the visible/accumulated text
  // here in response.
  if (info.type === 'reset') {
    currentStreamText = '';
    if (currentAssistantEl) currentAssistantEl.innerHTML = '';
    return;
  }

  const body = currentAssistantBubble.querySelector('.message-body');
  if (!body) return;

  let box = currentAssistantBubble.querySelector('.thought-box');
  if (!box) {
    box = document.createElement('div');
    box.className = 'thought-box';
    box.innerHTML = `
      <div class="thought-header">
        <span class="thought-title"><span class="thought-chevron">${svgIcon('<path d="M6 9l6 6 6-6"/>')}</span><span class="thought-label">Thinking…</span></span>
        <span class="thought-count">1 step</span>
      </div>
      <div class="thought-content">
        <ul class="thought-steps"></ul>
      </div>`;

    body.insertBefore(box, body.firstChild);

    // Toggle collapse on click
    const header = box.querySelector('.thought-header');
    header.addEventListener('click', () => {
      box.classList.toggle('collapsed');
    });
  }

  const stepsList = box.querySelector('.thought-steps');
  const progressItem = stepsList.querySelector('.thought-step-item.progress');

  // Live progress (e.g. the "still generating… 42s" heartbeat): one row, updated in place.
  if (info.type === 'progress') {
    const item = progressItem || document.createElement('li');
    item.className = 'thought-step-item progress';
    item.innerHTML = `<span class="thought-step-dot"></span><span class="thought-step-text">${escapeHtml(info.text)}</span>`;
    stepsList.appendChild(item); // (re)attach at the end
    const steps = stepsList.querySelectorAll('li:not(.progress)').length;
    box.querySelector('.thought-count').textContent = `${steps} step${steps === 1 ? '' : 's'}`;
    scrollToBottom();
    return;
  }
  // A real step happened, so the live progress row is stale.
  if (progressItem) progressItem.remove();

  const stepItem  = document.createElement('li');
  stepItem.className = 'thought-step-item';
  stepItem.innerHTML = `<span class="thought-step-dot"></span><span class="thought-step-text">${escapeHtml(info.text)}</span>`;
  stepsList.appendChild(stepItem);

  const countEl = box.querySelector('.thought-count');
  const total = stepsList.querySelectorAll('li:not(.progress)').length;
  countEl.textContent = `${total} step${total > 1 ? 's' : ''}`;

  scrollToBottom();
});

// ── Setup flow ────────────────────────────────────────────────────────────────
async function checkSetup() {
  const result = await window.api.checkOllama();
  if (!result.running) { showOllamaSetup(); return; }
  stopOllamaWatch();
  setupOllama.classList.add('hidden');
  // chatInstalled is true when ANY chat model is installed (not only the default)
  if (result.chatInstalled && result.embedInstalled) { enterApp(); return; }

  setupNeedsEmbed = !result.embedInstalled;

  // If no chat model is installed, let the user choose default or another model
  if (!result.chatInstalled) {
    setupStatus.textContent = `No chat AI model found. Install the recommended default or pick a model from the list.` +
      (setupNeedsEmbed ? ` The search/embedding model (bge-m3, ${EMBED_MODEL_SIZE}) will be downloaded too.` : '');
    setupChoices.classList.remove('hidden');
    populateSetupModelSelect();
  } else {
    // Only embed model is missing — auto download
    setupStatus.textContent = `1 system embedding model needs to be downloaded.`;
    renderSetupSteps([embedSetupStep()]);
  }
}

// ── Getting Ollama: start it if installed, otherwise install it ──────────────
const setupOllama             = document.getElementById('setupOllama');
const setupOllamaBtn          = document.getElementById('setupOllamaBtn');
const setupOllamaManualBtn    = document.getElementById('setupOllamaManualBtn');
const setupOllamaProgress     = document.getElementById('setupOllamaProgress');
const setupOllamaProgressBar  = setupOllamaProgress.querySelector('.progress-bar');
const setupOllamaProgressFill = setupOllamaProgress.querySelector('.progress-fill');
const setupOllamaProgressText = document.getElementById('setupOllamaProgressText');
const setupOllamaCancelBtn    = document.getElementById('setupOllamaCancelBtn');
let setupOllamaAction = null; // what the main button does right now
let ollamaWatchTimer = null;
let ollamaInstalling = false;

async function showOllamaSetup() {
  setupStatus.textContent = 'Looking for Ollama, the free program Athar uses to run AI on your computer…';
  const found = await window.api.findOllama();

  if (found.installed) {
    setupStatus.textContent = 'Starting Ollama…';
    const res = await window.api.startOllama();
    if (res.success) { checkSetup(); return; }
    setupStatus.textContent = `Ollama is installed but didn't start: ${res.error}`;
    showOllamaButtons('Try again', checkSetup);
    return;
  }

  setupStatus.innerHTML = 'Athar runs AI privately on your own computer using <strong>Ollama</strong>, a free program. ' +
    "It isn't installed yet.";
  if (found.canInstall) {
    const size = found.size ? ` (${formatBytes(found.size)} download)` : '';
    showOllamaButtons(`Install Ollama${size}`, installOllama);
  } else {
    showOllamaButtons('Download Ollama', () => window.api.openOllamaDownloadPage(), { manual: false });
  }
  watchForOllama(); // continue by itself if Ollama gets installed another way
}

function showOllamaButtons(label, action, { manual = true } = {}) {
  setupOllama.classList.remove('hidden');
  setupOllamaProgress.classList.add('hidden');
  setupOllamaBtn.classList.remove('hidden');
  setupOllamaBtn.textContent = label;
  setupOllamaAction = action;
  setupOllamaManualBtn.classList.toggle('hidden', !manual);
}

function watchForOllama() {
  stopOllamaWatch();
  ollamaWatchTimer = setInterval(async () => {
    if (ollamaInstalling) return;
    const res = await window.api.checkOllama();
    if (res.running) { stopOllamaWatch(); checkSetup(); }
  }, 4000);
}

function stopOllamaWatch() {
  if (ollamaWatchTimer) clearInterval(ollamaWatchTimer);
  ollamaWatchTimer = null;
}

async function installOllama() {
  stopOllamaWatch();
  ollamaInstalling = true;
  setupOllamaBtn.classList.add('hidden');
  setupOllamaManualBtn.classList.add('hidden');
  setupOllamaProgress.classList.remove('hidden');
  setupOllamaCancelBtn.classList.remove('hidden');
  setupOllamaProgressBar.classList.remove('indeterminate');
  setupOllamaProgressFill.style.width = '0%';
  setupOllamaProgressText.textContent = 'Starting the download…';
  setupStatus.textContent = 'Installing Ollama. You can keep using your computer meanwhile.';

  window.api.onOllamaInstallProgress((p) => {
    if (p.phase === 'download') {
      const pct = p.total ? Math.round((p.received / p.total) * 100) : 0;
      setupOllamaProgressFill.style.width = `${pct}%`;
      setupOllamaProgressText.textContent = p.total
        ? `Downloading… ${formatBytes(p.received)} of ${formatBytes(p.total)} (${pct}%)`
        : 'Downloading…';
      return;
    }
    // After the download, stopping halfway could leave a broken install
    setupOllamaCancelBtn.classList.add('hidden');
    setupOllamaProgressBar.classList.add('indeterminate');
    setupOllamaProgressText.textContent = {
      verify: 'Checking the download is the genuine Ollama…',
      install: 'Installing… this takes a minute or two',
      start: 'Starting Ollama…'
    }[p.phase] || '';
  });

  const res = await window.api.installOllama();
  ollamaInstalling = false;
  setupOllamaProgressBar.classList.remove('indeterminate');
  if (res.success) {
    setupOllama.classList.add('hidden');
    checkSetup();
    return;
  }
  setupStatus.textContent = res.cancelled ? 'Installation cancelled.' : `Couldn't install Ollama: ${res.error}`;
  showOllamaButtons('Try again', installOllama);
  watchForOllama();
}

setupOllamaBtn.addEventListener('click', () => { if (setupOllamaAction) setupOllamaAction(); });
setupOllamaManualBtn.addEventListener('click', () => window.api.openOllamaDownloadPage());
setupOllamaCancelBtn.addEventListener('click', () => {
  setupOllamaCancelBtn.classList.add('hidden');
  setupOllamaProgressText.textContent = 'Cancelling…';
  window.api.cancelOllamaInstall();
});

function embedSetupStep() {
  return { model: EMBED_MODEL, label: 'Multilingual Embedding Model (bge-m3)', size: EMBED_MODEL_SIZE };
}

function startSetupInstall(modelName) {
  const info = getModelInfo(modelName);
  const steps = [{
    model: modelName,
    label: modelName === CHAT_MODEL ? `Default Chat model (${CHAT_MODEL_LABEL})` : `Chat model (${info.label})`,
    size: modelName === CHAT_MODEL ? CHAT_MODEL_SIZE : `~${formatBytes(info.sizeBytes)}`
  }];
  if (setupNeedsEmbed) steps.push(embedSetupStep());

  activeModel = modelName;
  saveActiveModel(modelName);
  setupChoices.classList.add('hidden');
  setupCapCard.classList.add('hidden');
  setupStatus.textContent = `Downloading ${info.label || modelName}…`;
  renderSetupSteps(steps);
}

function populateSetupModelSelect() {
  setupModelSelect.innerHTML = '';
  for (const m of MODEL_CATALOG) {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.label} (~${formatBytes(m.sizeBytes)})`;
    setupModelSelect.appendChild(opt);
  }
  setupModelSelect.value = CHAT_MODEL;
  renderCapCard(CHAT_MODEL, setupCapCard);

  setupModelSelect.addEventListener('change', () => {
    renderCapCard(setupModelSelect.value, setupCapCard);
  });
}

setupDefaultBtn.addEventListener('click', () => startSetupInstall(CHAT_MODEL));
if (setupSelectedBtn) {
  setupSelectedBtn.addEventListener('click', () => startSetupInstall(setupModelSelect.value || CHAT_MODEL));
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
  await initWorkspace();
  setupPermissionModal();
}

async function initWorkspace() {
  try {
    const res = await window.api.getWorkspace();
    if (res.success && res.workspacePath) {
      setWorkspaceUI(res.workspacePath);
    } else {
      setWorkspaceUI(null);
    }
  } catch (e) {
    setWorkspaceUI(null);
  }
}

function setWorkspaceUI(folderPath) {
  activeWorkspaceDir = folderPath;
  if (folderPath) {
    const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
    workspaceText.textContent = `📁 ${folderName}`;
    workspaceZone.title = `Project folder (read-only): ${folderPath}`;
    workspaceZone.classList.add('active');
    clearWorkspaceBtn.classList.remove('hidden');
  } else {
    workspaceText.textContent = '📁 Project folder';
    workspaceZone.title = 'Let the assistant read a project folder (read-only — it can never change your files)';
    workspaceZone.classList.remove('active');
    clearWorkspaceBtn.classList.add('hidden');
  }
  if (typeof updateCapabilityUI === 'function' && modelLimits) updateCapabilityUI();
}

if (workspaceZone) {
  workspaceZone.addEventListener('click', async (e) => {
    if (e.target.closest('#clearWorkspaceBtn')) return;
    if (!modelSupport().tools) { updateCapabilityUI(); return; } // note explains why it's off
    const res = await window.api.selectWorkspace();
    if (res.success && res.workspacePath) {
      setWorkspaceUI(res.workspacePath);
    }
  });
}

if (clearWorkspaceBtn) {
  clearWorkspaceBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.clearWorkspace();
    setWorkspaceUI(null);
  });
}

function buildPermissionPreview(toolName, args) {
  // Explanation written by the main process (e.g. why an unfamiliar web address needs approval).
  return args.preview || '';
}

function showPermissionRequest(data) {
  const { requestId, toolName, args = {} } = data;
  currentPermissionReqId = requestId;

  const waiting = permissionQueue.length;
  const baseSub = toolName === 'fetch_web_page'
    ? 'The AI model wants to open a web address:'
    : 'The AI model is asking for permission:';
  permSub.textContent = waiting > 0 ? `${baseSub} (${waiting} more request${waiting > 1 ? 's' : ''} waiting)` : baseSub;

  permToolName.textContent = toolName;
  permTarget.textContent = args.url || args.rel_path || args.files || args.target || args.name || args.message || 'Workspace Repository';

  const previewContent = buildPermissionPreview(toolName, args);
  if (previewContent) {
    permContent.textContent = previewContent;
    permPreviewBlock.classList.remove('hidden');
  } else {
    permPreviewBlock.classList.add('hidden');
  }

  permissionModal.classList.remove('hidden');
}

function answerPermission(approved) {
  if (currentPermissionReqId) {
    window.api.respondToolPermission(currentPermissionReqId, approved);
    currentPermissionReqId = null;
  }
  // Tools can run in parallel, so several requests may be waiting: show the next one.
  const next = permissionQueue.shift();
  if (next) showPermissionRequest(next);
  else permissionModal.classList.add('hidden');
}

function setupPermissionModal() {
  window.api.onToolPermissionRequest((data) => {
    if (currentPermissionReqId) {
      permissionQueue.push(data);
      const waiting = permissionQueue.length;
      permSub.textContent = permSub.textContent.replace(/ \(\d+ more requests? waiting\)$/, '') +
        ` (${waiting} more request${waiting > 1 ? 's' : ''} waiting)`;
      return;
    }
    showPermissionRequest(data);
  });

  permDenyBtn.addEventListener('click', () => answerPermission(false));
  permApproveBtn.addEventListener('click', () => answerPermission(true));
}

async function initSavedHistory() {
  window.api.onMemoryProgress((stats) => {
    memoryStats = stats;
    renderMemoryStatus();
  });
  try {
    const res = await window.api.memoryStats();
    if (res.success) {
      memoryStats = res;
      renderMemoryStatus();
      renderHistoryTab();
    }
  } catch (err) {
    console.warn('Could not load memory stats:', err);
  }
}

/** Import-zone label + status line: how much history is remembered and whether it's still being indexed. */
function renderMemoryStatus() {
  if (!memoryStats) return;
  const imported = Object.entries(memoryStats.sources || {}).filter(([src]) => src !== 'app');
  const importedCount = imported.reduce((n, [, s]) => n + s.count, 0);
  if (importedCount > 0) {
    importZone.classList.add('loaded');
    importLabel.textContent = `✓ ${importedCount.toLocaleString()} imported conversation${importedCount === 1 ? '' : 's'}`;
  }
  const parts = lastImportNote ? [lastImportNote] : [];
  if (memoryStats.pending > 0) {
    const pct = memoryStats.passages ? Math.floor((memoryStats.embedded / memoryStats.passages) * 100) : 0;
    parts.push(memoryStats.error
      ? `⚠ Indexing paused (${memoryStats.error.slice(0, 80)}). Keyword search still works; it resumes automatically.`
      : `Indexing memory… ${pct}% (${memoryStats.embedded.toLocaleString()} / ${memoryStats.passages.toLocaleString()} passages). You can chat meanwhile.`);
  } else if (memoryStats.threads > 0) {
    parts.push(`Memory ready: ${memoryStats.threads.toLocaleString()} conversations, ${memoryStats.passages.toLocaleString()} passages.`);
  }
  importStatus.textContent = parts.join(' ');
  importStatus.classList.toggle('hidden', parts.length === 0);
  if (!memoryView.classList.contains('hidden')) renderMemorySummary();
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
    const installedRaw = (result.success && result.models) ? result.models : [];

    // Filter out bge-m3 and embedding models — chat selector ONLY shows language models
    const EMBED_FILTER = /bge-m3|embed|nomic-embed/i;
    const installed = installedRaw.filter((m) => !EMBED_FILTER.test(m.name));

    // Helper: does the catalog name match an installed model?
    function findInstalled(catalogName) {
      return installed.find(
        (m) => m.name === catalogName || m.name.startsWith(catalogName + ':')
      );
    }

    // Build list: catalog entries merged with any extra installed chat models
    const extras = installed
      .filter((m) => !MODEL_CATALOG.some((c) => m.name === c.name || m.name.startsWith(c.name + ':')))
      .map((m) => ({ name: m.name, label: m.name.replace(/:latest$/, ''), sizeBytes: m.size || 0, _extra: true }));

    const allEntries = [...MODEL_CATALOG, ...extras]
      .sort((a, b) => a.sizeBytes - b.sizeBytes);

    modelSelect.innerHTML = '';
    installedCapabilities.clear();
    for (const entry of allEntries) {
      const inst = findInstalled(entry.name);
      if (inst && Array.isArray(inst.capabilities)) {
        installedCapabilities.set(entry.name, inst.capabilities);
        installedCapabilities.set(inst.name, inst.capabilities);
      }
      const opt  = document.createElement('option');
      opt.value  = entry.name;
      opt.dataset.installed = inst ? 'true' : 'false';
      const sizeStr = inst ? formatBytes(inst.size) : `~${formatBytes(entry.sizeBytes)}`;
      const noTools = inst && Array.isArray(inst.capabilities) && !inst.capabilities.includes('tools');
      opt.textContent = inst
        ? `✓  ${entry.label}  (${sizeStr})${noTools ? '  · no tools' : ''}`
        : `⬇  ${entry.label}  (${sizeStr})`;
      modelSelect.appendChild(opt);
    }

    // Select activeModel if present, else first installed entry
    // Must be installed: a saved/remembered model may since have been uninstalled.
    const activeOpt = [...modelSelect.options].find(
      (o) => o.dataset.installed === 'true' && (o.value === activeModel || o.value.startsWith(activeModel + ':'))
    );
    if (activeOpt) {
      modelSelect.value = activeOpt.value;
    } else {
      const firstInstalled = [...modelSelect.options].find((o) => o.dataset.installed === 'true');
      if (firstInstalled) {
        modelSelect.value = firstInstalled.value;
        activeModel = firstInstalled.value;
        saveActiveModel(activeModel);
      }
    }

    refreshModelAction();
  } catch (err) {
    console.warn('Could not load model list:', err);
  }
}

// ── Model capabilities → which features are available ─────────────────────────
// Decided from what Ollama reports for the selected model (/api/show
// "capabilities"), so any model — including ones installed later — gets the
// right features without a hand-maintained list.
//   vision → images            tools → project folder, opening links,
//                                       reading files on demand, deeper memory search
// If Ollama doesn't report capabilities (older versions), assume tools work
// and use the catalog's vision flag.

function modelSupport(modelName = activeModel) {
  const caps = installedCapabilities.get(modelName);
  if (!caps) {
    const info = getModelInfo(modelName);
    return { known: false, vision: Boolean(info.vision), tools: true };
  }
  return { known: true, vision: caps.includes('vision'), tools: caps.includes('tools') };
}

const modelLimits    = document.getElementById('modelLimits');
const composerNotice = document.getElementById('composerNotice');
const workspaceNote  = document.getElementById('workspaceNote');
let composerNoticeTimer = null;

/** A short-lived message under the composer (e.g. "this model can't see images"). */
function showComposerNotice(text) {
  composerNotice.textContent = text;
  composerNotice.classList.remove('hidden');
  clearTimeout(composerNoticeTimer);
  composerNoticeTimer = setTimeout(() => composerNotice.classList.add('hidden'), 6000);
}

function modelDisplayName(modelName = activeModel) {
  return getModelInfo(modelName).label || modelName;
}

/** Applies the selected model's capabilities everywhere in the UI. Call after switching model. */
function updateCapabilityUI() {
  const support = modelSupport();
  const name = modelDisplayName();

  // Images need vision
  attachImgBtn.classList.toggle('hidden', !support.vision);
  attachImgBtn.title = `Attach an image for ${name}`;
  if (!support.vision && attachedImages.length > 0) {
    clearAttachedImages();
    showComposerNotice(`${name} can't see images, so the attached image was removed.`);
  }

  // Everything below needs tool calling
  if (support.tools) {
    modelLimits.classList.add('hidden');
    modelLimits.innerHTML = '';
  } else {
    modelLimits.innerHTML =
      `<span class="model-limits-text"><strong>${escapeHtml(name)}</strong> has limited features: ` +
      'web search is automatic only (it can\'t open links), attached files are read as excerpts, ' +
      'the project folder is off.</span> ' +
      '<button type="button" class="model-limits-link">Change model</button>';
    modelLimits.title = 'This model does not support tool calling. It still gets your memories, your profile ' +
      'and automatic web research for up-to-date questions. For full features, choose a model marked with tool support.';
    modelLimits.querySelector('.model-limits-link').addEventListener('click', openSettingsModal);
    modelLimits.classList.remove('hidden');
  }

  // Project folder (in Settings)
  workspaceZone.classList.toggle('disabled', !support.tools);
  if (support.tools) {
    workspaceNote.classList.add('hidden');
  } else {
    workspaceNote.textContent = activeWorkspaceDir
      ? `Not used with ${name}: it can't read files (no tool support). Your folder stays selected for when you switch back.`
      : `Not available with ${name}: it can't read files (no tool support). Choose a model with tool support to use a project folder.`;
    workspaceNote.classList.remove('hidden');
  }
}

function clearAttachedImages() {
  queueMicrotask(updateSendState); // attachments changed
  attachedImages = [];
  if (imagePreviewBar) {
    imagePreviewBar.innerHTML = '';
    imagePreviewBar.classList.add('hidden');
  }
  if (imageFileInput) imageFileInput.value = '';
}

function removeAttachedImage(index) {
  attachedImages.splice(index, 1);
  renderImagePreviews();
}

function renderImagePreviews() {
  queueMicrotask(updateSendState); // attachments changed
  if (!imagePreviewBar) return;
  if (attachedImages.length === 0) {
    imagePreviewBar.innerHTML = '';
    imagePreviewBar.classList.add('hidden');
    return;
  }
  imagePreviewBar.innerHTML = '';
  imagePreviewBar.classList.remove('hidden');

  attachedImages.forEach((img, idx) => {
    const chip = document.createElement('div');
    chip.className = 'image-preview-chip';
    chip.innerHTML = `
      <img src="${img.dataUrl}" alt="" />
      <div class="image-preview-info">
        <span class="image-preview-name">${escapeHtml(img.name)}</span>
      </div>
      <button type="button" class="image-preview-remove" title="Remove image" aria-label="Remove">${ICONS.close}</button>
    `;
    chip.querySelector('.image-preview-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeAttachedImage(idx);
    });
    imagePreviewBar.appendChild(chip);
  });
}

function addImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64 = dataUrl.split(',')[1];
    attachedImages.push({
      name: file.name || 'Pasted Image',
      dataUrl,
      base64
    });
    renderImagePreviews();
  };
  reader.readAsDataURL(file);
}

if (attachImgBtn && imageFileInput) {
  attachImgBtn.addEventListener('click', () => imageFileInput.click());
  imageFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      addImageFile(e.target.files[0]);
    }
  });
}

function clearAttachedDocuments() {
  queueMicrotask(updateSendState); // attachments changed
  attachedDocuments = [];
  if (docPreviewBar) {
    docPreviewBar.innerHTML = '';
    docPreviewBar.classList.add('hidden');
  }
  if (documentFileInput) documentFileInput.value = '';
}

async function removeAttachedDocument(index) {
  const [doc] = attachedDocuments.splice(index, 1);
  renderDocumentPreviews();
  // Un-attaching a file that was only just added (not pre-existing in this chat) also
  // removes it from the session, so cancelled attachments don't linger as resources.
  if (doc && doc.id && !doc.reused && activeSessionId) {
    await window.api.removeResource(activeSessionId, doc.id);
    renderSessionResourcesUI(activeSessionId);
  }
}

// Simple line icons (inherit the text colour via stroke="currentColor").
const svgIcon = (paths) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const FILE_OUTLINE = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';
const ICONS = {
  file: svgIcon(`${FILE_OUTLINE}<path d="M9 13h6M9 17h4"/>`),
  code: svgIcon(`${FILE_OUTLINE}<path d="M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"/>`),
  data: svgIcon(`${FILE_OUTLINE}<path d="M8.5 12h7v6h-7zM8.5 15h7M12 12v6"/>`),
  pdf: svgIcon(`${FILE_OUTLINE}<path d="M9 17v-4h1.5a1.25 1.25 0 0 1 0 2.5H9"/>`),
  close: svgIcon('<path d="M6 6l12 12M18 6L6 18"/>')
};

function getDocumentIcon(ext) {
  if (ext === '.pdf') return ICONS.pdf;
  if (['.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.c', '.cpp', '.h', '.java', '.rs', '.go', '.sh', '.sql'].includes(ext)) return ICONS.code;
  if (['.json', '.csv', '.yaml', '.yml', '.xml', '.toml'].includes(ext)) return ICONS.data;
  return ICONS.file;
}

function renderDocumentPreviews() {
  queueMicrotask(updateSendState); // attachments changed
  if (!docPreviewBar) return;
  if (attachedDocuments.length === 0) {
    docPreviewBar.innerHTML = '';
    docPreviewBar.classList.add('hidden');
    return;
  }
  docPreviewBar.innerHTML = '';
  docPreviewBar.classList.remove('hidden');

  attachedDocuments.forEach((doc, idx) => {
    const chip = document.createElement('div');
    chip.className = 'doc-preview-chip';
    const icon = getDocumentIcon(doc.ext);
    const sizeStr = doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : '';
    const details = [
      doc.noText ? '⚠ no readable text (scanned?)' : null,
      sizeStr,
      doc.pageCount ? `${doc.pageCount} page${doc.pageCount > 1 ? 's' : ''}` : null,
      doc.ext !== '.pdf' && doc.lineCount ? `${doc.lineCount} line${doc.lineCount > 1 ? 's' : ''}` : null
    ].filter(Boolean).join(' · ');

    chip.innerHTML = `
      <span class="doc-preview-icon">${icon}</span>
      <div class="doc-preview-info">
        <span class="doc-preview-name">${escapeHtml(doc.name)}</span>
        <span class="doc-preview-meta">${escapeHtml(details)}</span>
      </div>
      <button type="button" class="doc-preview-remove" title="Remove document" aria-label="Remove">${ICONS.close}</button>
    `;
    chip.querySelector('.doc-preview-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeAttachedDocument(idx);
    });
    docPreviewBar.appendChild(chip);
  });
}

async function renderSessionResourcesUI(sessionId) {
  if (!sessionId || !sessionResourcesBar || !sessionResourcesList) return;
  const res = await window.api.listResources(sessionId);
  const resources = (res && res.success && res.resources) ? res.resources : [];

  if (resources.length === 0) {
    sessionResourcesList.innerHTML = '';
    sessionResourcesBar.classList.add('hidden');
    return;
  }

  sessionResourcesList.innerHTML = '';
  sessionResourcesBar.classList.remove('hidden');

  resources.forEach((r) => {
    const chip = document.createElement('div');
    chip.className = 'resource-chip-item';
    const icon = getDocumentIcon(r.ext);
    const sizeStr = r.size ? `${(r.size / 1024).toFixed(1)} KB` : '';
    const details = r.noText ? '⚠ no readable text' : (r.pageCount ? `${r.pageCount} page(s)` : sizeStr);

    chip.innerHTML = `
      <span class="resource-chip-icon">${icon}</span>
      <span class="resource-chip-name">${escapeHtml(r.name)}</span>
      <span class="resource-chip-meta">(${escapeHtml(details)})</span>
      <button type="button" class="resource-chip-remove" title="Remove resource from session" aria-label="Remove">${ICONS.close}</button>
    `;

    chip.querySelector('.resource-chip-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Remove resource "${r.name}" from this chat session?`)) {
        await window.api.removeResource(sessionId, r.id);
        renderSessionResourcesUI(sessionId);
      }
    });

    sessionResourcesList.appendChild(chip);
  });
}

async function addDocumentFile(file) {
  if (!file) return;
  try {
    const filePath = window.api.getFilePath(file);
    if (!filePath) return;
    if (!activeSessionId) return;
    const result = await window.api.addResource(activeSessionId, filePath);
    if (result.success) {
      // Identical content already attached → don't show it twice
      if (!attachedDocuments.some((d) => d.id === result.resource.id)) {
        attachedDocuments.push({ ...result.resource, reused: result.reused });
      }
      renderSessionResourcesUI(activeSessionId);
      renderDocumentPreviews();
    } else {
      alert(`Failed to read document: ${result.error}`);
    }
  } catch (err) {
    alert(`Document processing error: ${err.message}`);
  }
}

if (attachDocBtn && documentFileInput) {
  attachDocBtn.addEventListener('click', () => documentFileInput.click());
  documentFileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      for (const file of e.target.files) {
        await addDocumentFile(file);
      }
      documentFileInput.value = '';
    }
  });
}

// Drag & drop support for both documents and images on input container
if (inputContainer) {
  ['dragenter', 'dragover'].forEach((eventName) => {
    inputContainer.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      inputContainer.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    inputContainer.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      inputContainer.classList.remove('drag-over');
    });
  });

  inputContainer.addEventListener('drop', async (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      if (file.type && file.type.startsWith('image/')) {
        if (modelSupport().vision) addImageFile(file);
        else showComposerNotice(`${modelDisplayName()} can't see images. Choose a vision model (marked "Vision + Text") in Settings to send images.`);
      } else {
        await addDocumentFile(file);
      }
    }
  });
}

function refreshModelAction() {
  const opt = modelSelect.options[modelSelect.selectedIndex];
  if (!opt) {
    modelAction.classList.add('hidden');
    sidebarCapCard.classList.add('hidden');
    return;
  }
  const isInstalled = opt.dataset.installed === 'true';

  renderCapCard(opt.value, sidebarCapCard);
  modelAction.classList.remove('hidden');

  if (isInstalled) {
    modelDownloadProgress.classList.add('hidden');
    modelDownloadBtn.classList.add('hidden');
    modelDeleteBtn.classList.remove('hidden');
    modelDeleteBtn.disabled = false;
    modelDeleteBtn.textContent = '🗑️ Uninstall Model';
  } else {
    modelDownloadProgress.classList.add('hidden');
    modelDeleteBtn.classList.add('hidden');
    modelDownloadBtn.classList.remove('hidden');
    modelDownloadBtn.disabled = false;
    modelDownloadBtn.textContent = '⬇ Download';
  }

  updateCapabilityUI();
  updateHeaderModelDisplay();
}

modelSelect.addEventListener('change', () => {
  const opt = modelSelect.options[modelSelect.selectedIndex];
  if (opt && opt.dataset.installed === 'true') {
    activeModel = modelSelect.value;
    saveActiveModel(activeModel);
  }
  refreshModelAction();
});

modelDownloadBtn.addEventListener('click', async () => {
  const modelName = modelSelect.value;

  modelDownloadBtn.classList.add('hidden');
  modelDownloadProgress.classList.remove('hidden');
  modelDlFill.style.width = '0%';
  modelDlText.classList.remove('error');
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
    saveActiveModel(modelName);
    // Refresh the list so the entry flips to ✓ installed
    setTimeout(() => loadModelSelector(), 800);
  } else {
    modelDlFill.style.width = '0%';
    modelDlText.classList.add('error');
    modelDlText.textContent = `Failed: ${result.error || 'unknown error'}`;
    modelDlText.title = result.error || '';
    modelDownloadBtn.classList.remove('hidden');
    modelDownloadBtn.disabled = false;
    modelDownloadBtn.textContent = '⬇ Retry';
  }
});

modelDeleteBtn.addEventListener('click', async () => {
  const modelName = modelSelect.value;
  if (!confirm(`Are you sure you want to uninstall and remove "${modelName}" from your storage?`)) return;

  modelDeleteBtn.disabled = true;
  modelDeleteBtn.textContent = 'Deleting…';

  const result = await window.api.deleteModel(modelName);
  if (result.success) {
    setTimeout(() => loadModelSelector(), 500);
  } else {
    alert(`Failed to delete model: ${result.error}`);
    modelDeleteBtn.disabled = false;
    modelDeleteBtn.textContent = '🗑️ Uninstall Model';
  }
});

// ── Sidebar tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.sidebar-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`tab${tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)}`).classList.remove('hidden');
    if (tab.dataset.tab === 'history') {
      renderHistoryTab();
    }
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
    title.dir = 'auto';
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
  if (headerChatTitle && session) {
    headerChatTitle.textContent = session.title || 'Athar';
  }
  renderMessages(session ? session.messages || [] : []);
  clearAttachedDocuments();
  clearAttachedImages();
  renderSessionResourcesUI(id);
  showChatView();
  scrollToBottom();
  messageInput.focus();
}

// ── History tab ───────────────────────────────────────────────────────────────
async function renderHistoryTab() {
  const res = await window.api.memoryList({ limit: 100 });
  if (!res.success || res.total === 0) {
    historyList.innerHTML = '<p class="history-empty">No history imported yet.<br/>Use the import button below.</p>';
    return;
  }

  historyList.innerHTML = '';
  const sources = (memoryStats && memoryStats.sources) || {};
  const summary = document.createElement('div');
  summary.className = 'history-section';
  for (const [source, info] of Object.entries(sources)) {
    const header = document.createElement('div');
    header.className = 'history-source-header';
    header.innerHTML = `
      <span class="source-dot" style="background:${SOURCE_COLORS[source] || SOURCE_COLORS.unknown}"></span>
      <span class="source-name">${escapeHtml(SOURCE_LABELS[source] || info.name || source)}</span>
      <span class="source-count">${info.count.toLocaleString()} conversation${info.count === 1 ? '' : 's'}</span>`;
    summary.appendChild(header);
  }
  historyList.appendChild(summary);

  const list = document.createElement('ul');
  list.className = 'history-thread-list';
  for (const t of res.items) {
    const li = document.createElement('li');
    li.className = 'history-thread-item';
    li.title = 'Open this conversation';
    li.innerHTML = `
      <span class="history-thread-title" dir="auto">${escapeHtml(t.title)}</span>
      <span class="history-thread-date">${escapeHtml(SOURCE_LABELS[t.source] || t.sourceName)} · ${t.date || 'unknown date'}</span>`;
    li.addEventListener('click', () => openMemoryThread(t.id));
    list.appendChild(li);
  }
  historyList.appendChild(list);
}

// ── Message rendering ─────────────────────────────────────────────────────────

// FIX: the model's context can include raw scraped web page content (from
// the pre-research pipeline / web_search tool). If a page contained
// something like an <img onerror=...> payload or a <script> tag and the
// model echoed it back verbatim, `marked.parse` would happily pass that
// straight through and it would execute as live HTML once written via
// innerHTML below. This is a minimal, dependency-free scrub — strip
// <script>/<style> tags, on* event-handler attributes, and javascript:
// URLs — applied to the rendered HTML right before it's inserted into the
// DOM. It's not a full sanitizer; if a proper one (e.g. DOMPurify) is
// available in the app bundle already, prefer wiring that in instead.
function sanitizeHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;

  const walk = (node) => {
    for (const el of Array.from(node.querySelectorAll('*'))) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      }
    }
  };
  walk(container);
  return container.innerHTML;
}

function renderMarkdown(text) {
  if (!text) return '';
  // Collapse multiple blank lines before numbered headers, bold lines, and bullet points
  let cleaned = text
    .replace(/\n\s*\n+(\s*(\d+\.|\*\*|[\u2022\u25E6\u25CB\u2023\u2013\-\*]))/g, '\n$1')
    .replace(/(\n\s*){3,}/g, '\n\n'); // Never allow more than 2 consecutive newlines anywhere
  if (window.marked) return sanitizeHtml(window.marked.parse(cleaned, { breaks: true, gfm: true }));
  const d = document.createElement('div');
  d.textContent = cleaned;
  return d.innerHTML;
}

function renderMessages(messages) {
  messageList.innerHTML = '';
  for (const msg of messages) {
    const textEl = appendMessageBubble(msg.role, msg.text, msg.images || [], msg.documents || []);
    if (msg.role === 'assistant' && msg.sources && msg.sources.length) {
      renderSourceChips(textEl.closest('.message'), msg.sources);
    }
  }
  updateEmptyChatState();
}

function appendMessageBubble(role, text, images = [], documents = []) {
  const div = createMessageBubble(role, text, images, documents);
  messageList.appendChild(div);
  return div.querySelector('.message-text');
}

/** Builds (but doesn't insert) a message bubble — shared by the chat and the memory viewer. */
function createMessageBubble(role, text, images = [], documents = [], { markdown = role === 'assistant' } = {}) {
  // Minimal layout: your messages are a soft bubble on the right; the
  // assistant's answer is plain text across the column (no avatar, no label).
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.setAttribute('aria-label', role === 'user' ? 'You said' : 'Assistant replied');

  const body = document.createElement('div');
  body.className = 'message-body';

  const textEl = document.createElement('div');
  textEl.className = 'message-text';
  textEl.dir = 'auto'; // Arabic (right-to-left) and English messages each lay out correctly
  if (markdown && text) {
    textEl.innerHTML = renderMarkdown(text);
    textEl.classList.add('markdown'); // line breaks come from the HTML, not pre-wrap
  } else textEl.textContent = text;
  if (role === 'user' && !text) textEl.classList.add('hidden'); // attachment-only message: no empty bubble

  body.appendChild(textEl);

  if (documents && documents.length > 0) {
    const docWrap = document.createElement('div');
    docWrap.className = 'msg-doc-badges';
    for (const doc of documents) {
      const chip = document.createElement('div');
      chip.className = 'msg-doc-chip';
      const icon = getDocumentIcon(doc.ext);
      const sizeStr = doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : '';
      const meta = doc.ext === '.pdf' || (doc.pageCount > 1 && !doc.lineCount)
        ? `${doc.pageCount} page${doc.pageCount > 1 ? 's' : ''}`
        : (doc.lineCount ? `${doc.lineCount} lines` : sizeStr);
      chip.innerHTML = `
        <span class="msg-doc-icon">${icon}</span>
        <span class="msg-doc-name">${escapeHtml(doc.name)}</span>
        ${meta ? `<span class="msg-doc-meta">${escapeHtml(meta)}</span>` : ''}
      `;
      docWrap.appendChild(chip);
    }
    body.insertBefore(docWrap, textEl); // attachments above the message text
  }

  if (images && images.length > 0) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'msg-images';
    for (const imgStr of images) {
      const imgEl = document.createElement('img');
      imgEl.className = 'msg-image-thumb';
      imgEl.src = imgStr.startsWith('data:') ? imgStr : `data:image/png;base64,${imgStr}`;
      imgWrap.appendChild(imgEl);
    }
    body.insertBefore(imgWrap, textEl);
  }

  div.appendChild(body);
  return div;
}

const MAX_VISIBLE_CHIPS = 8;

function renderSourceChips(bubbleEl, sources) {
  if (!sources || sources.length === 0) return;

  // Remove any existing chips on this bubble
  const existing = bubbleEl.querySelector('.source-chips');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.className = 'source-chips';

  const label = document.createElement('span');
  label.className = 'source-chips-label';
  label.textContent = 'From your memory';
  wrap.appendChild(label);

  // One chip per conversation (a question about one chat brings many passages
  // of it); cited if any of its passages was, opening at the first cited one.
  const byThread = new Map();
  for (const s of sources) {
    const seen = byThread.get(s.threadId);
    if (!seen) byThread.set(s.threadId, { ...s });
    else if (s.cited && !seen.cited) byThread.set(s.threadId, { ...s });
  }

  // Cited memories ([M1] in the answer) first; ones the answer didn't use are dimmed.
  const anyCitedInfo = sources.some((s) => typeof s.cited === 'boolean');
  const ordered = [...byThread.values()].sort((a, b) => Number(Boolean(b.cited)) - Number(Boolean(a.cited)));
  for (const s of ordered) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'source-chip' + (anyCitedInfo && !s.cited ? ' uncited' : '');
    const color = SOURCE_COLORS[s.source] || SOURCE_COLORS.unknown;
    chip.style.borderColor = color;
    chip.style.color = color;
    const sourceName = SOURCE_LABELS[s.source] || s.sourceName || s.source;
    chip.title = `${s.ref ? `[${s.ref}] ` : ''}${sourceName}${s.date ? ` · ${s.date}` : ''}` +
      `${anyCitedInfo ? (s.cited ? ' · used in this answer' : ' · found, not used') : ''} — click to open`;
    chip.textContent = `${sourceName}: ${s.title.slice(0, 35)}${s.title.length > 35 ? '…' : ''}`;
    chip.addEventListener('click', () => {
      if (typeof openMemoryThread === 'function') openMemoryThread(s.threadId, s.msgStart);
    });
    if (wrap.querySelectorAll('.source-chip').length >= MAX_VISIBLE_CHIPS) chip.classList.add('hidden');
    wrap.appendChild(chip);
  }

  // A list of many conversations: show a few, the rest on request
  const hiddenChips = wrap.querySelectorAll('.source-chip.hidden');
  if (hiddenChips.length > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'source-chip source-chips-more';
    more.textContent = `+${hiddenChips.length} more`;
    more.addEventListener('click', () => {
      hiddenChips.forEach((c) => c.classList.remove('hidden'));
      more.remove();
    });
    wrap.appendChild(more);
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
  if (!text && attachedImages.length === 0 && attachedDocuments.length === 0) return;

  const currentImagesBase64 = attachedImages.map((i) => i.base64);
  const currentImagesDataUrl = attachedImages.map((i) => i.dataUrl);
  const currentDocs = [...attachedDocuments];

  messageInput.value = '';
  messageInput.style.height = 'auto';
  clearAttachedImages();
  clearAttachedDocuments();

  isStreaming = true;
  sendBtn.disabled = true;
  pendingSources = null;

  appendMessageBubble('user', text, currentImagesDataUrl, currentDocs);
  updateEmptyChatState();

  const assistantTextEl = appendMessageBubble('assistant', '');
  const assistantBubble = assistantTextEl.closest('.message');
  assistantBubble.classList.add('typing-indicator');

  currentAssistantEl     = assistantTextEl;
  currentAssistantBubble = assistantBubble;
  currentStreamText      = '';

  scrollToBottom();

  const result = await window.api.chatSend(activeSessionId, text, activeModel, currentImagesBase64, currentDocs);

  // The main process returns the final answer — the exact text it saved.
  // It can differ from the streamed tokens (a non-streamed fallback answer, an
  // appended warning, a recovered tool result), so it replaces them. This
  // also paints the last throttled token batch before we detach the element.
  if (result.success && typeof result.reply === 'string') currentStreamText = result.reply;
  if (currentAssistantEl) currentAssistantEl.innerHTML = renderMarkdown(currentStreamText);

  currentAssistantEl     = null;
  currentAssistantBubble = null;
  assistantBubble.classList.remove('typing-indicator');
  finishThoughtBox(assistantBubble);

  // Final chips know which memories the answer actually cited
  if (result.success && result.sources && result.sources.length) {
    renderSourceChips(assistantBubble, result.sources);
  } else if (pendingSources) {
    renderSourceChips(assistantBubble, pendingSources); // error case: show what was found
  }
  pendingSources = null;

  if (!result.success) {
    assistantTextEl.textContent = `Error: ${result.error}`;
    assistantTextEl.style.color = 'var(--danger)';
  }

  isStreaming = false;
  updateSendState();
  messageInput.focus();
  scrollToBottom();
  renderSessionResourcesUI(activeSessionId);
}

newChatBtn.addEventListener('click', createNewChat);
emptyNewChatBtn.addEventListener('click', createNewChat);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  updateSendState();
});

/** Send is enabled only when there's something to send and no answer is in progress. */
function updateSendState() {
  const hasContent = messageInput.value.trim() || attachedImages.length > 0 || attachedDocuments.length > 0;
  sendBtn.disabled = isStreaming || !hasContent;
}

/** An empty chat shows a greeting with the composer floating in the middle; it moves down once messages exist. */
function updateEmptyChatState() {
  const empty = messageList.children.length === 0;
  chatView.classList.toggle('is-empty', empty);
  document.getElementById('chatWelcome').classList.toggle('hidden', !empty);
}

/** When an answer is done, the thought process folds away (click to reopen). */
function finishThoughtBox(bubble) {
  const box = bubble && bubble.querySelector('.thought-box');
  if (!box) return;
  const label = box.querySelector('.thought-label');
  if (label) label.textContent = 'Thought process';
  box.classList.add('collapsed', 'done');
  const progress = box.querySelector('.thought-step-item.progress');
  if (progress) progress.remove();
}

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

  importLabel.textContent = 'Importing…';
  importZone.classList.add('loading');
  importStatus.classList.remove('hidden');
  importStatus.textContent = 'Reading the export file…';

  // The main process parses and indexes; embedding continues in the background
  // (progress arrives via onMemoryProgress) and chatting works meanwhile.
  const result = await window.api.importHistory(window.api.getFilePath(file));
  importZone.classList.remove('loading');

  if (!result.success) {
    importLabel.textContent = '＋ Import chat history';
    importStatus.textContent = `Import failed: ${result.error}`;
    return;
  }

  const sourceLabel = SOURCE_LABELS[result.source] || result.source;
  const changes = [
    result.added ? `${result.added} new` : null,
    result.updated ? `${result.updated} updated` : null,
    result.unchanged ? `${result.unchanged} already imported` : null,
    result.skippedEmpty ? `${result.skippedEmpty} skipped (the export has no text for them)` : null
  ].filter(Boolean).join(', ');
  lastImportNote = `${sourceLabel}: ${changes || 'nothing new'}.`;
  importStatus.textContent = lastImportNote;

  const stats = await window.api.memoryStats();
  if (stats.success) { memoryStats = stats; renderMemoryStatus(); }
  renderHistoryTab();
  document.querySelector('[data-tab="history"]').click();
}

// ── Memory browser ────────────────────────────────────────────────────────────
const memoryView            = document.getElementById('memoryView');
const memoryListPane        = document.getElementById('memoryListPane');
const memoryThreadPane      = document.getElementById('memoryThreadPane');
const memorySearchInput     = document.getElementById('memorySearchInput');
const memorySourceFilter    = document.getElementById('memorySourceFilter');
const memorySummary         = document.getElementById('memorySummary');
const memoryUnderstood      = document.getElementById('memoryUnderstood');
const memoryResults         = document.getElementById('memoryResults');
const memoryLoadMore        = document.getElementById('memoryLoadMore');
const memoryBackBtn         = document.getElementById('memoryBackBtn');
const memoryThreadTitle     = document.getElementById('memoryThreadTitle');
const memoryThreadMeta      = document.getElementById('memoryThreadMeta');
const memoryThreadMessages  = document.getElementById('memoryThreadMessages');
const memoryFilePanel       = document.getElementById('memoryFilePanel');
const memoryFilePanelName   = document.getElementById('memoryFilePanelName');
const memoryFilePanelMeta   = document.getElementById('memoryFilePanelMeta');
const memoryFilePanelBody   = document.getElementById('memoryFilePanelBody');
const memoryFilePanelCopy   = document.getElementById('memoryFilePanelCopy');
const memoryFilePanelClose  = document.getElementById('memoryFilePanelClose');
const memoryAskBtn          = document.getElementById('memoryAskBtn');
const memoryCopyBtn         = document.getElementById('memoryCopyBtn');

let memoryListOffset = 0;
let memorySearchSeq = 0;      // ignore results of searches that were superseded while running
let memorySearchTimer = null;
let memoryCurrentThread = null;

function showMemoryView({ refresh = true } = {}) {
  emptyState.classList.add('hidden');
  chatView.classList.add('hidden');
  memoryView.classList.remove('hidden');
  if (headerChatTitle) headerChatTitle.textContent = 'Memory';
  document.querySelectorAll('.session-item').forEach((el) => el.classList.remove('active'));
  if (refresh) {
    showMemoryList();
    renderMemorySummary();
    refreshMemoryResults();
    memorySearchInput.focus();
  }
}

function showMemoryList() {
  closeFilePanel();
  memoryThreadPane.classList.add('hidden');
  memoryProfilePane.classList.add('hidden');
  memoryListPane.classList.remove('hidden');
}

function renderMemorySummary() {
  memorySummary.innerHTML = '';
  const sources = (memoryStats && memoryStats.sources) || {};
  const entries = Object.entries(sources);
  if (entries.length === 0) return;
  for (const [source, info] of entries) {
    const pill = document.createElement('span');
    pill.className = 'memory-source-pill';
    pill.style.borderColor = SOURCE_COLORS[source] || SOURCE_COLORS.unknown;
    const imported = info.lastImport ? ` · imported ${info.lastImport.slice(0, 10)}` : '';
    pill.innerHTML = `
      <span style="color:${SOURCE_COLORS[source] || SOURCE_COLORS.unknown};font-weight:600">${escapeHtml(SOURCE_LABELS[source] || info.name || source)}</span>
      <span class="pill-meta">${info.count.toLocaleString()} conversation${info.count === 1 ? '' : 's'}${escapeHtml(imported)}</span>`;
    if (source !== 'app') {
      const remove = document.createElement('button');
      remove.className = 'pill-remove';
      remove.title = `Forget all imported ${SOURCE_LABELS[source] || source} conversations`;
      remove.textContent = '✕';
      remove.addEventListener('click', () => forgetMemorySource(source));
      pill.appendChild(remove);
    }
    memorySummary.appendChild(pill);
  }
}

async function forgetMemorySource(source) {
  const label = SOURCE_LABELS[source] || source;
  if (!confirm(`Forget all imported ${label} conversations?\n\nThey are removed from this app's memory (your original export file is not touched). You can import them again later.`)) return;
  const res = await window.api.memoryDeleteSource(source);
  if (!res.success) { alert(`Could not remove: ${res.error}`); return; }
  const stats = await window.api.memoryStats();
  if (stats.success) { memoryStats = stats; renderMemoryStatus(); }
  renderMemorySummary();
  refreshMemoryResults();
  renderHistoryTab();
}

/** Escapes text, then highlights the given topic words in it. */
function highlightTerms(text, terms) {
  let html = escapeHtml(text);
  const words = [...new Set((terms || []).filter((w) => w.length >= 3))];
  for (const w of words) {
    const re = new RegExp(`(${escapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

function memoryResultCard({ title, source, sourceName, date, meta, snippetHtml, onClick }) {
  const card = document.createElement('div');
  card.className = 'memory-result';
  card.tabIndex = 0;
  const color = SOURCE_COLORS[source] || SOURCE_COLORS.unknown;
  card.innerHTML = `
    <div class="memory-result-head">
      <span class="memory-result-source" style="color:${color}">${escapeHtml(SOURCE_LABELS[source] || sourceName || source)}</span>
      <span class="memory-result-title" dir="auto">${escapeHtml(title)}</span>
      <span class="memory-result-meta">${escapeHtml([date, meta].filter(Boolean).join(' · '))}</span>
    </div>
    ${snippetHtml ? `<div class="memory-result-snippet" dir="auto">${snippetHtml}</div>` : ''}`;
  card.addEventListener('click', onClick);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick(); });
  return card;
}

async function refreshMemoryResults() {
  const query = memorySearchInput.value.trim();
  const source = memorySourceFilter.value || null;
  const seq = ++memorySearchSeq;
  memoryResults.innerHTML = '';
  memoryUnderstood.classList.add('hidden');
  memoryLoadMore.classList.add('hidden');

  if (!query) {
    memoryListOffset = 0;
    await loadMoreMemoryList(seq);
    return;
  }

  memoryResults.innerHTML = '<p class="memory-empty">Searching…</p>';
  const res = await window.api.memorySearch(query, { source, limit: 30 });
  if (seq !== memorySearchSeq) return; // a newer search started meanwhile
  memoryResults.innerHTML = '';
  if (!res.success) {
    memoryResults.innerHTML = `<p class="memory-empty">Search failed: ${escapeHtml(res.error)}</p>`;
    return;
  }

  const tags = [];
  if (res.understood && res.understood.dates) tags.push(`📅 ${res.understood.dates}`);
  if (res.understood && res.understood.sources && !source) tags.push(`📁 ${res.understood.sources.map((s) => SOURCE_LABELS[s] || s).join(', ')}`);
  if (tags.length || res.note) {
    memoryUnderstood.innerHTML = (tags.length ? `Searching${tags.map((t) => ` <span class="understood-tag">${escapeHtml(t)}</span>`).join('')}` : '') +
      (res.note ? `${tags.length ? ' — ' : ''}${escapeHtml(res.note)}` : '');
    memoryUnderstood.classList.remove('hidden');
  }

  if (res.passages.length === 0) {
    memoryResults.innerHTML = `<p class="memory-empty">Nothing in your memory matches “${escapeHtml(query)}”.<br/>` +
      `Try other words, or a hint like “last year” or “in Claude”.</p>`;
    return;
  }
  for (const p of res.passages) {
    memoryResults.appendChild(memoryResultCard({
      title: p.title,
      source: p.source,
      sourceName: p.sourceName,
      date: p.date,
      snippetHtml: highlightTerms(p.text, res.understood && res.understood.terms),
      onClick: () => openMemoryThread(p.threadId, p.msgStart, p.msgEnd)
    }));
  }
}

async function loadMoreMemoryList(seq = memorySearchSeq) {
  const source = memorySourceFilter.value || null;
  const res = await window.api.memoryList({ source, offset: memoryListOffset, limit: 50 });
  if (seq !== memorySearchSeq) return;
  if (!res.success) {
    memoryResults.innerHTML = `<p class="memory-empty">Could not load your memory: ${escapeHtml(res.error)}</p>`;
    return;
  }
  if (res.total === 0) {
    memoryResults.innerHTML = '<p class="memory-empty">Your memory is empty.<br/>Import a ChatGPT, Claude or Gemini export with “Import chat history” in the sidebar — or just start chatting.</p>';
    return;
  }
  for (const t of res.items) {
    memoryResults.appendChild(memoryResultCard({
      title: t.title,
      source: t.source,
      sourceName: t.sourceName,
      date: t.date,
      meta: `${t.messageCount} messages`,
      snippetHtml: t.preview ? escapeHtml(t.preview) : '',
      onClick: () => openMemoryThread(t.id)
    }));
  }
  memoryListOffset += res.items.length;
  memoryLoadMore.classList.toggle('hidden', memoryListOffset >= res.total);
  memoryLoadMore.textContent = `Load more (${(res.total - memoryListOffset).toLocaleString()} more)`;
}

/** Opens a past conversation in the viewer, scrolled to (and highlighting) messages msgStart..msgEnd. */
async function openMemoryThread(threadId, msgStart = null, msgEnd = null) {
  if (memoryView.classList.contains('hidden')) showMemoryView({ refresh: false });
  const res = await window.api.memoryGet(threadId);
  if (!res.success) { alert(res.error); return; }
  const thread = res.thread;
  memoryCurrentThread = thread;

  memoryListPane.classList.add('hidden');
  memoryProfilePane.classList.add('hidden');
  memoryThreadPane.classList.remove('hidden');
  memoryThreadTitle.textContent = thread.title;
  const date = thread.createTime ? new Date(thread.createTime * 1000).toLocaleDateString() : 'unknown date';
  memoryThreadMeta.textContent = `${SOURCE_LABELS[thread.source] || thread.sourceName} · ${date} · ${thread.messages.length} messages`;
  memoryAskBtn.disabled = false;

  closeFilePanel();
  memoryThreadMessages.innerHTML = '';
  let firstHighlight = null;
  const end = msgEnd === null || msgEnd === undefined ? msgStart : msgEnd;
  thread.messages.forEach((m, i) => {
    const bubble = createMessageBubble(m.role, m.text, [], [], { markdown: true });
    if (thread.source === 'claude') {
      const textEl = bubble.querySelector('.message-text');
      if (textEl) compactToolBlocks(textEl);
    }
    if (msgStart !== null && msgStart !== undefined && i >= msgStart && i <= end) {
      bubble.classList.add('memory-highlight');
      if (!firstHighlight) firstHighlight = bubble;
    }
    memoryThreadMessages.appendChild(bubble);
  });
  if (firstHighlight) firstHighlight.scrollIntoView({ block: 'center' });
  else memoryThreadMessages.scrollTop = 0;
}

// ── Compact commands and files in imported Claude conversations ──────────────
// The Claude importer writes commands as a ```bash block (+ "Output:" block)
// and created/edited files as "**Created `path`**" + a code block. Here they
// become a collapsed command row and a small file card that opens the code in
// a panel next to the conversation.

const TOOL_ICONS = {
  terminal: svgIcon('<path d="M5 17l5-5-5-5M12 18h7"/>'),
  chevron: svgIcon('<path d="M9 6l6 6-6 6"/>')
};
const TOOL_NOTE_RE = /^(Viewed|Searched the web|Opened|Shared|Asked you|Used) /;

/** The "_description_" paragraph the importer writes just above a command. */
function toolDescriptionBefore(el) {
  const prev = el.previousElementSibling;
  if (!prev || prev.tagName !== 'P' || prev.children.length !== 1) return null;
  const em = prev.firstElementChild;
  if (em.tagName !== 'EM' || prev.textContent.trim() !== em.textContent.trim()) return null;
  return TOOL_NOTE_RE.test(em.textContent) ? null : prev;
}

function compactToolBlocks(root) {
  // Files: <p>[<em>desc</em><br>]<strong>Created|Edited <code>path</code></strong></p><pre>…</pre>
  for (const strong of Array.from(root.querySelectorAll(':scope > p > strong'))) {
    const m = /^(Created|Edited) (.+)$/.exec(strong.textContent.trim());
    const p = strong.parentElement;
    const pre = p.nextElementSibling;
    if (!m || !strong.querySelector('code') || p.lastElementChild !== strong || !pre || pre.tagName !== 'PRE') continue;
    const em = p.querySelector(':scope > em');
    pre.remove();
    p.replaceWith(createFileCard({ action: m[1], path: m[2], description: em ? em.textContent.trim() : '', pre }));
  }

  // Commands: [<p><em>desc</em></p>]<pre><code class="language-bash">…</code></pre>[<p>Output:|Error:</p><pre>…</pre>]
  for (const code of Array.from(root.querySelectorAll(':scope > pre > code.language-bash'))) {
    const pre = code.parentElement;
    const desc = toolDescriptionBefore(pre);
    let label = pre.nextElementSibling;
    let output = null;
    let isError = false;
    if (label && label.tagName === 'P' && /^(Output|Error):$/.test(label.textContent.trim()) &&
        label.nextElementSibling && label.nextElementSibling.tagName === 'PRE') {
      isError = label.textContent.trim() === 'Error:';
      output = label.nextElementSibling;
    } else {
      label = null;
    }
    const spot = document.createComment('');
    pre.before(spot); // the row takes the <pre> inside itself
    spot.replaceWith(createCommandRow({ description: desc ? desc.textContent.trim() : '', pre, label, output, isError }));
    if (desc) desc.remove();
  }
}

function createCommandRow({ description, pre, label, output, isError }) {
  const row = document.createElement('div');
  row.className = 'tool-command' + (isError ? ' is-error' : '');
  const firstLine = pre.textContent.split('\n').find((l) => l.trim()) || 'Command';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tool-command-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.title = 'Show the command' + (output ? ' and its output' : '');
  toggle.innerHTML = `${TOOL_ICONS.terminal}<span class="tool-command-label${description ? '' : ' mono'}" dir="auto"></span>` +
    (isError ? '<span class="tool-command-status">Error</span>' : '') +
    `<span class="tool-command-chevron">${TOOL_ICONS.chevron}</span>`;
  toggle.querySelector('.tool-command-label').textContent = description || firstLine;

  const body = document.createElement('div');
  body.className = 'tool-command-body';
  body.hidden = true;
  body.appendChild(pre);
  if (output) {
    label.className = 'tool-command-output-label';
    body.appendChild(label);
    body.appendChild(output);
  }

  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    row.classList.toggle('open', !body.hidden);
  });
  row.appendChild(toggle);
  row.appendChild(body);
  return row;
}

const fileBaseName = (path) => path.split(/[\\/]/).filter(Boolean).pop() || path;

function createFileCard({ action, path, description, pre }) {
  const name = fileBaseName(path);
  const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'tool-file-card';
  card.title = `Open ${path}`;

  let stats = '';
  if (action === 'Edited') {
    const lines = pre.textContent.split('\n');
    const added = lines.filter((l) => l.startsWith('+ ')).length;
    const removed = lines.filter((l) => l.startsWith('- ')).length;
    stats = `<span class="tool-file-stat add">+${added}</span><span class="tool-file-stat del">−${removed}</span>`;
  }
  card.innerHTML = `<span class="tool-file-icon">${getDocumentIcon(ext)}</span>` +
    '<span class="tool-file-text"><span class="tool-file-name"></span><span class="tool-file-action" dir="auto"></span></span>' + stats;
  card.querySelector('.tool-file-name').textContent = name;
  card.querySelector('.tool-file-action').textContent = description || (action === 'Created' ? 'Created file' : 'Edited file');

  card.addEventListener('click', () => {
    if (card.classList.contains('active')) { closeFilePanel(); return; }
    openFilePanel({ card, action, path, pre });
  });
  return card;
}

function openFilePanel({ card, action, path, pre }) {
  document.querySelectorAll('.tool-file-card.active').forEach((c) => c.classList.remove('active'));
  card.classList.add('active');
  memoryFilePanelName.textContent = fileBaseName(path);
  memoryFilePanelName.title = path;
  memoryFilePanelMeta.textContent = `${action} · ${path}`;
  memoryFilePanelBody.innerHTML = '';
  const copy = pre.cloneNode(true);
  const code = copy.querySelector('code');
  if (code && code.classList.contains('language-diff')) {
    // colour the removed/added lines of an edit
    const lines = code.textContent.replace(/\n$/, '').split('\n');
    code.textContent = '';
    for (const line of lines) {
      const span = document.createElement('span');
      span.className = line.startsWith('+ ') ? 'diff-add' : line.startsWith('- ') ? 'diff-del' : '';
      span.textContent = line + '\n';
      code.appendChild(span);
    }
  }
  memoryFilePanelBody.appendChild(copy);
  memoryFilePanel._code = pre.textContent;
  memoryFilePanel.classList.remove('hidden');
  memoryThreadPane.classList.add('has-file-panel');
  memoryFilePanelBody.scrollTop = 0;
}

function closeFilePanel() {
  if (!memoryFilePanel) return;
  memoryFilePanel.classList.add('hidden');
  memoryThreadPane.classList.remove('has-file-panel');
  document.querySelectorAll('.tool-file-card.active').forEach((c) => c.classList.remove('active'));
}

if (memoryFilePanel) {
  memoryFilePanelClose.innerHTML = ICONS.close;
  memoryFilePanelClose.addEventListener('click', closeFilePanel);
  memoryFilePanelCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(memoryFilePanel._code || '');
      memoryFilePanelCopy.textContent = 'Copied';
      setTimeout(() => { memoryFilePanelCopy.textContent = 'Copy'; }, 1500);
    } catch { /* clipboard unavailable */ }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !memoryFilePanel.classList.contains('hidden')) closeFilePanel();
  });
}

function conversationAsText(thread) {
  return `${thread.title}\n${SOURCE_LABELS[thread.source] || thread.sourceName}\n\n` +
    thread.messages.map((m) => `${m.role === 'user' ? 'You' : 'Assistant'}: ${m.text}`).join('\n\n');
}

memoryBackBtn.addEventListener('click', () => {
  showMemoryList();
  renderMemorySummary();
  if (!memoryResults.children.length) refreshMemoryResults();
});

memoryCopyBtn.addEventListener('click', async () => {
  if (!memoryCurrentThread) return;
  try {
    await navigator.clipboard.writeText(conversationAsText(memoryCurrentThread));
    memoryCopyBtn.textContent = '✓ Copied';
  } catch {
    memoryCopyBtn.textContent = 'Copy failed';
  }
  setTimeout(() => { memoryCopyBtn.textContent = 'Copy'; }, 1500);
});

// Start a new chat with this past conversation attached, so the model can read all of it.
memoryAskBtn.addEventListener('click', async () => {
  if (!memoryCurrentThread) return;
  const thread = memoryCurrentThread;
  memoryAskBtn.disabled = true;
  const { session } = await window.api.chatCreate();
  await loadSessionList();
  await openSession(session.id);
  const res = await window.api.memoryAttachToChat(session.id, thread.id);
  memoryAskBtn.disabled = false;
  if (!res.success) { alert(`Could not attach the conversation: ${res.error}`); return; }
  attachedDocuments.push({ ...res.resource });
  renderDocumentPreviews();
  renderSessionResourcesUI(session.id);
  messageInput.value = /[؀-ۿ]/.test(thread.title)
    ? 'ما الذي ناقشناه في هذه المحادثة، وما الذي تم الاتفاق عليه؟'
    : 'What did we discuss in this conversation, and what was decided?';
  messageInput.focus();
  messageInput.select();
});

memorySearchInput.addEventListener('input', () => {
  clearTimeout(memorySearchTimer);
  memorySearchTimer = setTimeout(refreshMemoryResults, 450);
});
memorySearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(memorySearchTimer); refreshMemoryResults(); }
});
memorySourceFilter.addEventListener('change', refreshMemoryResults);
memoryLoadMore.addEventListener('click', () => loadMoreMemoryList());
document.getElementById('openMemoryBtn').addEventListener('click', () => showMemoryView());
document.getElementById('emptyMemoryBtn').addEventListener('click', () => showMemoryView());

// ── Memory profile ────────────────────────────────────────────────────────────
const memoryProfilePane     = document.getElementById('memoryProfilePane');
const profileMeta           = document.getElementById('profileMeta');
const profileEnabled        = document.getElementById('profileEnabled');
const profileScope          = document.getElementById('profileScope');
const profileGenerateBtn    = document.getElementById('profileGenerateBtn');
const profileCancelBtn      = document.getElementById('profileCancelBtn');
const profileProgress       = document.getElementById('profileProgress');
const profileProgressFill   = document.getElementById('profileProgressFill');
const profileProgressText   = document.getElementById('profileProgressText');
const profileError          = document.getElementById('profileError');
const profileEditor         = document.getElementById('profileEditor');
const profileSaveBtn        = document.getElementById('profileSaveBtn');

let currentProfile = null;

async function openProfilePane() {
  if (memoryView.classList.contains('hidden')) showMemoryView({ refresh: false });
  memoryListPane.classList.add('hidden');
  memoryThreadPane.classList.add('hidden');
  memoryProfilePane.classList.remove('hidden');
  const res = await window.api.profileGet();
  if (res.success) renderProfile(res);
  setProfileBusy(Boolean(res.running));
}

function renderProfile(profile) {
  currentProfile = profile;
  profileEditor.value = profile.markdown || '';
  profileEnabled.checked = Boolean(profile.enabled);
  profileEnabled.disabled = !profile.markdown;
  profileSaveBtn.disabled = true;
  const bits = [];
  if (profile.generatedAt) bits.push(`Built ${new Date(profile.generatedAt).toLocaleDateString()} from ${profile.conversationsUsed} conversations`);
  if (profile.edited) bits.push('edited by you');
  if (!profile.markdown) bits.push('Not built yet');
  profileMeta.textContent = bits.join(' · ');
  profileGenerateBtn.textContent = profile.generatedAt ? 'Rebuild profile' : 'Build my profile';
  for (const id of ['profileCopyBtn', 'profileCopyAboutBtn', 'profileCopyHowBtn', 'profileExportBtn']) {
    document.getElementById(id).disabled = !profile.markdown;
  }
  document.getElementById('profileCopyHowBtn').disabled = !(profile.chatgpt && profile.chatgpt.howToRespond);
}

function setProfileBusy(busy) {
  profileGenerateBtn.disabled = busy;
  profileScope.disabled = busy;
  profileCancelBtn.classList.toggle('hidden', !busy);
  profileProgress.classList.toggle('hidden', !busy);
  profileEditor.readOnly = busy;
}

window.api.onProfileProgress(({ done, total }) => {
  profileProgressFill.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
  profileProgressText.textContent = done >= total
    ? 'Putting your profile together…'
    : `Reading your conversations… part ${done + 1} of ${total}`;
});

profileGenerateBtn.addEventListener('click', async () => {
  if (currentProfile && currentProfile.edited &&
      !confirm('Rebuilding replaces the profile, including your edits. Continue?')) return;
  profileError.classList.add('hidden');
  profileProgressFill.style.width = '0%';
  profileProgressText.textContent = 'Starting…';
  setProfileBusy(true);
  const res = await window.api.profileGenerate({ maxConversations: Number(profileScope.value), modelName: activeModel });
  setProfileBusy(false);
  if (res.success) {
    renderProfile(res);
  } else if (!res.cancelled) {
    profileError.textContent = `Could not build the profile: ${res.error}`;
    profileError.classList.remove('hidden');
  }
});

profileCancelBtn.addEventListener('click', () => window.api.profileCancel());

profileEditor.addEventListener('input', () => {
  profileSaveBtn.disabled = profileEditor.value === ((currentProfile && currentProfile.markdown) || '');
});

profileSaveBtn.addEventListener('click', async () => {
  const res = await window.api.profileSave({ markdown: profileEditor.value });
  if (res.success) renderProfile(res);
});

profileEnabled.addEventListener('change', async () => {
  const res = await window.api.profileSave({ enabled: profileEnabled.checked });
  if (res.success) renderProfile(res);
});

async function copyWithFeedback(button, text) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = `✓ Copied (${text.length.toLocaleString()} chars)`;
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => { button.textContent = label; }, 1800);
}

document.getElementById('profileCopyBtn').addEventListener('click', (e) => copyWithFeedback(e.currentTarget, profileEditor.value));
document.getElementById('profileCopyAboutBtn').addEventListener('click', (e) =>
  copyWithFeedback(e.currentTarget, (currentProfile && currentProfile.chatgpt && currentProfile.chatgpt.aboutYou) || ''));
document.getElementById('profileCopyHowBtn').addEventListener('click', (e) =>
  copyWithFeedback(e.currentTarget, (currentProfile && currentProfile.chatgpt && currentProfile.chatgpt.howToRespond) || ''));
document.getElementById('profileExportBtn').addEventListener('click', () => {
  const blob = new Blob([`# My memory profile\n\n${profileEditor.value}\n`], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'memory-profile.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.getElementById('openProfileBtn').addEventListener('click', openProfilePane);
document.getElementById('profileBackBtn').addEventListener('click', () => {
  showMemoryList();
  renderMemorySummary();
  if (!memoryResults.children.length) refreshMemoryResults();
});

// ── Settings Modal & Sidebar Toggle ──────────────────────────────────────────
function openSettingsModal() {
  if (settingsModal) settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.add('hidden');
}

function toggleSidebar() {
  if (!appShell) return;
  const isCollapsed = appShell.classList.toggle('sidebar-collapsed');
  localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
}

function updateHeaderModelDisplay() {
  if (!headerModelName) return;
  const info = getModelInfo(activeModel);
  headerModelName.textContent = `Model: ${info.label || activeModel}`;
}

if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
if (sidebarSettingsBtn) sidebarSettingsBtn.addEventListener('click', openSettingsModal);
if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);
if (headerModelPill) headerModelPill.addEventListener('click', openSettingsModal);

if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettingsModal();
  }
});

// Restore saved sidebar collapsed state
if (localStorage.getItem('sidebarCollapsed') === 'true' && appShell) {
  appShell.classList.add('sidebar-collapsed');
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showChatView() {
  memoryView.classList.add('hidden');
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  updateHeaderModelDisplay();
}

function showEmptyState() {
  if (sessionResourcesBar) sessionResourcesBar.classList.add('hidden');
  memoryView.classList.add('hidden');
  chatView.classList.add('hidden');
  emptyState.classList.remove('hidden');
  if (headerChatTitle) headerChatTitle.textContent = 'Athar';
  updateHeaderModelDisplay();
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkSetup();