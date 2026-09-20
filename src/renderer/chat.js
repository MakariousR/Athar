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
const setupModelSelect      = document.getElementById('setupModelSelect');
const setupCapCard          = document.getElementById('setupCapCard');

const workspaceZone         = document.getElementById('workspaceZone');
const workspaceText         = document.getElementById('workspaceText');
const clearWorkspaceBtn     = document.getElementById('clearWorkspaceBtn');

const permissionModal       = document.getElementById('permissionModal');
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
let embeddedThreads      = [];   // all threads from ALL imports merged, with embeddings
let importedSources      = [];   // [{ source, label, count, importedAt }] for history tab
let isStreaming          = false;
let currentAssistantEl   = null;
let currentAssistantBubble = null;
let currentStreamText    = '';
let pendingSources       = null; // sources received before stream starts
let attachedImages       = [];   // [{ name, dataUrl, base64 }]
let attachedDocuments    = [];   // metadata only: [{ id, name, ext, size, pageCount, lineCount, charCount, noText, reused }] — text stays in the main process

const CHAT_MODEL  = 'qwen2.5-coder:7b';
const EMBED_MODEL = 'bge-m3';

let activeModel = CHAT_MODEL; // the model currently used for generation

// Curated catalog of popular Ollama chat models with rich capability metadata.
const MODEL_CATALOG = [
  { name: 'qwen2.5:0.5b',      label: 'Qwen 2.5 · 0.5B',        sizeBytes:   397_000_000, ram: '~1.5 GB', vision: false, desc: 'Ultra-fast & lightweight. Best for quick answers on low-spec hardware.' },
  { name: 'gemma3:1b',         label: 'Gemma 3 · 1B',           sizeBytes:   815_000_000, ram: '~2.0 GB', vision: false, desc: 'Google lightweight model. Fast response, low resource footprint.' },
  { name: 'qwen2.5:1.5b',      label: 'Qwen 2.5 · 1.5B',       sizeBytes:   986_000_000, ram: '~2.2 GB', vision: false, desc: 'Great balance of speed and multilingual comprehension.' },
  { name: 'llama3.2:1b',       label: 'Llama 3.2 · 1B',         sizeBytes: 1_321_000_000, ram: '~2.5 GB', vision: false, desc: 'Meta lightweight model. Quick summary and chat completion.' },
  { name: 'qwen2.5:3b',        label: 'Qwen 2.5 · 3B',          sizeBytes: 1_900_000_000, ram: '~3.5 GB', vision: false, desc: '⭐ Default Recommended. Strong multilingual reasoning, tool calling & history search.' },
  { name: 'qwen2.5-vl:3b',     label: 'Qwen 2.5 VL · 3B',       sizeBytes: 1_950_000_000, ram: '~3.5 GB', vision: true,  desc: '🖼️ Fast Vision + Tools. Compact multimodal model for visual analysis & reasoning.' },
  { name: 'llama3.2:3b',       label: 'Llama 3.2 · 3B',         sizeBytes: 2_020_000_000, ram: '~4.0 GB', vision: false, desc: 'Meta efficient model. Good instruction following & text generation.' },
  { name: 'phi4-mini',         label: 'Phi 4 Mini · 3.8B',      sizeBytes: 2_500_000_000, ram: '~4.5 GB', vision: false, desc: 'Microsoft compact reasoning model. Strong math & logic abilities.' },
  { name: 'gemma3:4b',         label: 'Gemma 3 · 4B',           sizeBytes: 3_300_000_000, ram: '~5.0 GB', vision: true,  desc: '🖼️ Includes Vision & 140+ languages. Can analyze uploaded images & screenshots.' },
  { name: 'mistral',           label: 'Mistral · 7B',            sizeBytes: 4_100_000_000, ram: '~7.0 GB', vision: false, desc: 'Classic 7B benchmark model. Excellent code & text writing.' },
  { name: 'llama3.1:8b',       label: 'Llama 3.1 · 8B',         sizeBytes: 4_700_000_000, ram: '~8.0 GB', vision: false, desc: 'Meta flagship 8B model. Deep reasoning & complex task handling.' },
  { name: 'qwen2.5:7b',        label: 'Qwen 2.5 · 7B',          sizeBytes: 4_700_000_000, ram: '~8.0 GB', vision: false, desc: 'World-class 7B coding & reasoning. Exceptional multilingual & tool calling.' },
  { name: 'qwen2.5-vl:7b',     label: 'Qwen 2.5 VL · 7B',       sizeBytes: 4_750_000_000, ram: '~8.0 GB', vision: true,  desc: '🖼️🔥 Top Recommended All-Rounder! Vision + Native Tools + Top-Tier Coding & Reasoning.' },
  { name: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision · 11B', sizeBytes: 7_900_000_000, ram: '~11 GB',  vision: true,  desc: '🖼️ Meta flagship vision model. High-res image understanding, document OCR & tools.' },
  { name: 'gemma3:12b',        label: 'Gemma 3 · 12B',          sizeBytes: 8_100_000_000, ram: '~12 GB',  vision: true,  desc: '🖼️ Powerful multimodal model. Deep reasoning, coding & visual document analysis.' },
  { name: 'qwen2.5:14b',       label: 'Qwen 2.5 · 14B',         sizeBytes: 9_000_000_000, ram: '~14 GB',  vision: false, desc: 'High-tier reasoning & long-document analysis for powerful PCs.' },
  { name: 'phi4',              label: 'Phi 4 · 14B',             sizeBytes: 9_100_000_000, ram: '~14 GB',  vision: false, desc: 'Microsoft flagship 14B logic & math model.' },
  { name: 'llama3.3:70b',      label: 'Llama 3.3 · 70B',        sizeBytes: 43_000_000_000, ram: '~48 GB',  vision: false, desc: 'Enterprise-grade 70B model. Requires high-end GPU / VRAM workstation.' },
  { name: 'qwen2.5:72b',       label: 'Qwen 2.5 · 72B',         sizeBytes: 47_000_000_000, ram: '~52 GB',  vision: false, desc: 'Top-of-the-line 72B model. Maximum capability for workstation hardware.' }
];

function getModelInfo(modelName) {
  return MODEL_CATALOG.find((m) => m.name === modelName || m.name.startsWith(modelName + ':')) || {
    name: modelName,
    label: modelName,
    ram: 'Unknown',
    vision: false,
    desc: 'Custom installed model.'
  };
}

function renderCapCard(modelName, containerEl) {
  if (!containerEl) return;
  const info = getModelInfo(modelName);
  containerEl.innerHTML = `
    <div class="cap-title">
      <span>${escapeHtml(info.label)}</span>
      <span class="cap-badge ${info.vision ? 'vision' : ''}">${info.vision ? '🖼️ Vision + Text' : '⚡ Text Only'}</span>
    </div>
    <div class="cap-row"><span>RAM Required:</span> <span class="cap-val">${info.ram}</span></div>
    <div class="cap-desc">${escapeHtml(info.desc)}</div>
  `;
  containerEl.classList.remove('hidden');
}

const SOURCE_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', app: 'In-App Chat', unknown: 'Unknown' };
const SOURCE_COLORS = { chatgpt: '#10a37f', claude: '#cc785c', app: '#ab68ff', unknown: '#6c8cff' };

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
        <span class="thought-title"><span class="thought-chevron">▼</span> Thought Process</span>
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
  const stepItem  = document.createElement('li');
  stepItem.className = 'thought-step-item';
  stepItem.innerHTML = `<span class="thought-step-icon">${info.icon || '⚡'}</span> <span class="thought-step-text">${escapeHtml(info.text)}</span>`;
  stepsList.appendChild(stepItem);

  const countEl = box.querySelector('.thought-count');
  const total = stepsList.querySelectorAll('li').length;
  countEl.textContent = `${total} step${total > 1 ? 's' : ''}`;

  scrollToBottom();
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

  // If chat model is missing, allow user to choose default or custom model
  if (!result.chatInstalled) {
    setupStatus.textContent = `No chat AI model found. Install the recommended default or pick a model from the list.`;
    setupChoices.classList.remove('hidden');
    populateSetupModelSelect();
  } else {
    // Only embed model is missing — auto download
    setupStatus.textContent = `1 system embedding model needs to be downloaded.`;
    renderSetupSteps(missing);
  }
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

setupDefaultBtn.addEventListener('click', () => {
  setupChoices.classList.add('hidden');
  setupCapCard.classList.add('hidden');
  setupStatus.textContent = `Downloading default model (Qwen 2.5 3B)…`;
  renderSetupSteps([{ model: CHAT_MODEL, label: 'Default Chat model (Qwen 2.5 3B)', size: '~1.9 GB' }]);
});

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
    workspaceZone.title = `Workspace: ${folderPath}`;
    workspaceZone.classList.add('active');
    clearWorkspaceBtn.classList.remove('hidden');
  } else {
    workspaceText.textContent = '📁 Select Workspace';
    workspaceZone.title = 'Select folder for File & Git tools';
    workspaceZone.classList.remove('active');
    clearWorkspaceBtn.classList.add('hidden');
  }
}

if (workspaceZone) {
  workspaceZone.addEventListener('click', async (e) => {
    if (e.target.closest('#clearWorkspaceBtn')) return;
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

function setupPermissionModal() {
  window.api.onToolPermissionRequest((data) => {
    const { requestId, toolName, args } = data;
    currentPermissionReqId = requestId;

    permToolName.textContent = toolName;

    const targetStr = args.rel_path || args.files || args.target || args.name || args.message || 'Workspace Repository';
    permTarget.textContent = targetStr;

    let previewContent = '';
    if (args.content) previewContent = args.content;
    else if (args.target_text && args.replacement_text) {
      previewContent = `Replace:\n${args.target_text}\n\nWith:\n${args.replacement_text}`;
    } else if (args.message) {
      previewContent = `Commit message: "${args.message}"`;
    }

    if (previewContent) {
      permContent.textContent = previewContent;
      permPreviewBlock.classList.remove('hidden');
    } else {
      permPreviewBlock.classList.add('hidden');
    }

    permissionModal.classList.remove('hidden');
  });

  permDenyBtn.addEventListener('click', () => {
    if (currentPermissionReqId) {
      window.api.respondToolPermission(currentPermissionReqId, false);
      currentPermissionReqId = null;
    }
    permissionModal.classList.add('hidden');
  });

  permApproveBtn.addEventListener('click', () => {
    if (currentPermissionReqId) {
      window.api.respondToolPermission(currentPermissionReqId, true);
      currentPermissionReqId = null;
    }
    permissionModal.classList.add('hidden');
  });
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

function updateVisionCapability() {
  const info = getModelInfo(activeModel);
  if (info && info.vision) {
    attachImgBtn.classList.remove('hidden');
    attachImgBtn.title = `Attach image for ${info.label}`;
  } else {
    attachImgBtn.classList.add('hidden');
    clearAttachedImages();
  }
}

function clearAttachedImages() {
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
      <img src="${img.dataUrl}" alt="Preview" />
      <div class="image-preview-info">
        <span class="image-preview-name">${escapeHtml(img.name)}</span>
      </div>
      <button type="button" class="image-preview-remove" title="Remove image">&times;</button>
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

function getDocumentIcon(ext) {
  if (ext === '.pdf') return '📕';
  if (['.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.c', '.cpp', '.h', '.java', '.rs', '.go', '.sh', '.sql'].includes(ext)) return '💻';
  if (['.json', '.csv', '.yaml', '.yml', '.xml', '.toml'].includes(ext)) return '📊';
  return '📄';
}

function renderDocumentPreviews() {
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
      <button type="button" class="doc-preview-remove" title="Remove document">&times;</button>
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
      <button type="button" class="resource-chip-remove" title="Remove resource from session">&times;</button>
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
        const info = getModelInfo(activeModel);
        if (info && info.vision) addImageFile(file);
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

  updateVisionCapability();
  updateHeaderModelDisplay();
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
    headerChatTitle.textContent = session.title || 'Chat Memory';
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
function renderHistoryTab() {
  if (!embeddedThreads || embeddedThreads.length === 0) {
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
  if (window.marked) return sanitizeHtml(window.marked.parse(cleaned, { breaks: false, gfm: true }));
  const d = document.createElement('div');
  d.textContent = cleaned;
  return d.innerHTML;
}

function renderMessages(messages) {
  messageList.innerHTML = '';
  for (const msg of messages) appendMessageBubble(msg.role, msg.text, msg.images || [], msg.documents || []);
}

function appendMessageBubble(role, text, images = [], documents = []) {
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
        ${meta ? `<span class="msg-doc-meta">(${escapeHtml(meta)})</span>` : ''}
      `;
      docWrap.appendChild(chip);
    }
    body.appendChild(docWrap);
  }

  if (images && images.length > 0) {
    for (const imgStr of images) {
      const imgEl = document.createElement('img');
      imgEl.className = 'msg-image-thumb';
      imgEl.src = imgStr.startsWith('data:') ? imgStr : `data:image/png;base64,${imgStr}`;
      body.appendChild(imgEl);
    }
  }

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

  const assistantTextEl = appendMessageBubble('assistant', '');
  const assistantBubble = assistantTextEl.closest('.message');
  assistantBubble.classList.add('typing-indicator');

  currentAssistantEl     = assistantTextEl;
  currentAssistantBubble = assistantBubble;
  currentStreamText      = '';

  scrollToBottom();

  const result = await window.api.chatSend(activeSessionId, text, embeddedThreads, activeModel, currentImagesBase64, activeWorkspaceDir, currentDocs);

  // FIX: rendering is now throttled to one rAF per batch of tokens (see
  // onChatToken), so make sure the last batch is actually painted before we
  // detach currentAssistantEl below — otherwise the very last chunk of text
  // could silently never make it to the DOM.
  if (currentAssistantEl) currentAssistantEl.innerHTML = renderMarkdown(currentStreamText);

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
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  updateHeaderModelDisplay();
}

function showEmptyState() {
  if (sessionResourcesBar) sessionResourcesBar.classList.add('hidden');
  chatView.classList.add('hidden');
  emptyState.classList.remove('hidden');
  if (headerChatTitle) headerChatTitle.textContent = 'Chat Memory';
  updateHeaderModelDisplay();
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkSetup();