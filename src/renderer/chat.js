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
const navMemoryBtn          = document.getElementById('navMemoryBtn');
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
let attachedImages       = [];   // [{ name, dataUrl, base64 }]
let attachedDocuments    = [];   // metadata only: [{ id, name, ext, size, pageCount, lineCount, charCount, noText, reused }] — text stays in the main process

const CHAT_MODEL  = 'qwen2.5:7b';
const EMBED_MODEL = 'bge-m3';
const CHAT_MODEL_LABEL  = 'Qwen 2.5 7B';
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
// Cloud models (the user's own API keys): "<provider>/<model id>", e.g. "openai/gpt-5-mini" — see "Cloud models" below
const CLOUD_PROVIDERS = {
  gemini:    { name: 'Gemini',  company: 'Google',    plan: 'free plan available', keyUrl: 'https://aistudio.google.com/apikey' },
  openai:    { name: 'ChatGPT', company: 'OpenAI',    plan: 'paid per use',        keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Claude',  company: 'Anthropic', plan: 'paid per use',        keyUrl: 'https://console.anthropic.com/settings/keys' }
};
function cloudProviderOf(name) {
  const p = String(name || '').split('/')[0];
  return String(name || '').includes('/') && CLOUD_PROVIDERS[p] ? p : null;
}
function isCloudModel(name) { return cloudProviderOf(name) !== null; }
let cloudState = {}; // provider → { hasKey, models, recommended, error }
let setupNeedsEmbed = false;

// Curated catalog of popular Ollama chat models with rich capability metadata.
const MODEL_CATALOG = [
  { name: 'qwen3:0.6b',           label: 'Qwen 3 · 0.6B',            sizeBytes:    522_653_767, ram: '~2.0 GB', vision: false, thinking: true , desc: 'Tiny model for very old or low-memory PCs. Thinks before answering; limited knowledge.' },
  { name: 'gemma3:1b',            label: 'Gemma 3 · 1B',             sizeBytes:    815_319_791, ram: '~2.5 GB', vision: false, thinking: false, desc: 'Google lightweight model. Fast, low resource use; basic answers.' },
  { name: 'qwen2.5:1.5b',         label: 'Qwen 2.5 · 1.5B',          sizeBytes:    986_061_892, ram: '~2.5 GB', vision: false, thinking: false, desc: 'Good balance of speed and multilingual understanding for small PCs.' },
  { name: 'deepseek-r1:1.5b',     label: 'DeepSeek R1 · 1.5B',       sizeBytes:  1_117_322_768, ram: '~3.0 GB', vision: false, thinking: true , desc: 'Small reasoning model: thinks step by step before answering (slower replies).' },
  { name: 'llama3.2:1b',          label: 'Llama 3.2 · 1B',           sizeBytes:  1_321_098_329, ram: '~3.0 GB', vision: false, thinking: false, desc: 'Meta lightweight model. Quick summaries and simple chat.' },
  { name: 'qwen3:1.7b',           label: 'Qwen 3 · 1.7B',            sizeBytes:  1_359_293_444, ram: '~3.0 GB', vision: false, thinking: true , desc: 'Small Qwen 3: tools, multilingual, can think before answering.' },
  { name: 'qwen3-vl:2b',          label: 'Qwen 3 VL · 2B',           sizeBytes:  1_889_519_687, ram: '~4.0 GB', vision: true , thinking: false, desc: 'Smallest Qwen 3 vision model: reads images and screenshots.' },
  { name: 'qwen2.5:3b',           label: 'Qwen 2.5 · 3B',            sizeBytes:  1_929_912_432, ram: '~4.0 GB', vision: false, thinking: false, desc: 'Multilingual reasoning, tool calling and history search on modest hardware.' },
  { name: 'llama3.2:3b',          label: 'Llama 3.2 · 3B',           sizeBytes:  2_019_393_189, ram: '~4.0 GB', vision: false, thinking: false, desc: 'Meta efficient model. Good instruction following and writing.' },
  { name: 'phi4-mini',            label: 'Phi 4 Mini · 3.8B',        sizeBytes:  2_491_876_774, ram: '~4.5 GB', vision: false, thinking: false, desc: 'Microsoft compact model. Strong at math and logic.' },
  { name: 'qwen3:4b',             label: 'Qwen 3 · 4B',              sizeBytes:  2_497_293_931, ram: '~4.5 GB', vision: false, thinking: true , desc: 'Capable small model: tools, 100+ languages, thinks before hard answers. Good for 8 GB RAM.' },
  { name: 'qwen2.5vl:3b',         label: 'Qwen 2.5 VL · 3B',         sizeBytes:  3_200_627_168, ram: '~5.5 GB', vision: true , thinking: false, desc: 'Compact vision model: understands images and screenshots.' },
  { name: 'qwen3-vl:4b',          label: 'Qwen 3 VL · 4B',           sizeBytes:  3_295_636_135, ram: '~5.5 GB', vision: true , thinking: false, desc: 'Qwen 3 vision model: images, screenshots and documents.' },
  { name: 'gemma3:4b',            label: 'Gemma 3 · 4B',             sizeBytes:  3_338_801_804, ram: '~5.5 GB', vision: true , thinking: false, desc: 'Google model with vision and 140+ languages. Reads images and screenshots.' },
  { name: 'mistral',              label: 'Mistral · 7B',             sizeBytes:  4_372_824_384, ram: '~6.5 GB', vision: false, thinking: false, desc: 'Classic 7B model. Solid writing and code.' },
  { name: 'deepseek-r1:7b',       label: 'DeepSeek R1 · 7B',         sizeBytes:  4_683_075_440, ram: '~7.0 GB', vision: false, thinking: true , desc: 'Reasoning model: thinks step by step (slower, strong at math and logic).' },
  { name: 'qwen2.5:7b',           label: 'Qwen 2.5 · 7B',            sizeBytes:  4_683_087_332, ram: '~7.0 GB', vision: false, thinking: false, desc: 'Recommended default. Strong all-round 7B: multilingual (incl. Arabic) with reliable tool calling.' },
  { name: 'qwen2.5-coder:7b',     label: 'Qwen 2.5 Coder · 7B',      sizeBytes:  4_683_087_561, ram: '~7.0 GB', vision: false, thinking: false, desc: 'Code-focused 7B with reliable tool calling for workspace file & Git tasks.' },
  { name: 'llama3.1:8b',          label: 'Llama 3.1 · 8B',           sizeBytes:  4_920_753_328, ram: '~7.5 GB', vision: false, thinking: false, desc: 'Meta 8B model. Good reasoning and longer tasks.' },
  { name: 'deepseek-r1:8b',       label: 'DeepSeek R1 · 8B',         sizeBytes:  5_225_376_047, ram: '~8.0 GB', vision: false, thinking: true , desc: 'Reasoning model on a Qwen 3 base: thinks step by step (slower, stronger on hard problems).' },
  { name: 'qwen3:8b',             label: 'Qwen 3 · 8B',              sizeBytes:  5_225_388_164, ram: '~8.0 GB', vision: false, thinking: true , desc: 'Newer Qwen generation: tools, 100+ languages, thinks before hard answers. Best all-rounder for 16 GB RAM.' },
  { name: 'qwen2.5vl:7b',         label: 'Qwen 2.5 VL · 7B',         sizeBytes:  5_969_245_856, ram: '~8.5 GB', vision: true , thinking: false, desc: 'Stronger vision model: image understanding and document reading.' },
  { name: 'qwen3-vl:8b',          label: 'Qwen 3 VL · 8B',           sizeBytes:  6_140_415_879, ram: '~9.0 GB', vision: true , thinking: false, desc: 'Qwen 3 vision model: images, charts and documents with better reasoning.' },
  { name: 'llama3.2-vision:11b',  label: 'Llama 3.2 Vision · 11B',   sizeBytes:  7_816_589_186, ram: '~11 GB',  vision: true , thinking: false, desc: 'Meta vision model. Image understanding and document reading.' },
  { name: 'gemma3:12b',           label: 'Gemma 3 · 12B',            sizeBytes:  8_149_190_253, ram: '~11 GB',  vision: true , thinking: false, desc: 'Powerful multimodal model. Reasoning, coding and visual document analysis.' },
  { name: 'deepseek-r1:14b',      label: 'DeepSeek R1 · 14B',        sizeBytes:  8_988_112_209, ram: '~12 GB',  vision: false, thinking: true , desc: 'Stronger reasoning model: thinks step by step. Needs a powerful PC.' },
  { name: 'qwen2.5:14b',          label: 'Qwen 2.5 · 14B',           sizeBytes:  8_988_124_069, ram: '~12 GB',  vision: false, thinking: false, desc: 'Higher-tier reasoning and long documents, for PCs with 16 GB+ of fast memory.' },
  { name: 'qwen2.5-coder:14b',    label: 'Qwen 2.5 Coder · 14B',     sizeBytes:  8_988_124_298, ram: '~12 GB',  vision: false, thinking: false, desc: 'Stronger coding model with tool calling, for powerful PCs.' },
  { name: 'phi4',                 label: 'Phi 4 · 14B',              sizeBytes:  9_053_116_391, ram: '~12 GB',  vision: false, thinking: false, desc: 'Microsoft 14B model for logic and math.' },
  { name: 'qwen3:14b',            label: 'Qwen 3 · 14B',             sizeBytes:  9_276_198_565, ram: '~13 GB',  vision: false, thinking: true , desc: 'Capable Qwen 3: tools, multilingual, thinks before hard answers. For PCs with 24 GB+ RAM or a strong GPU.' },
  { name: 'gpt-oss:20b',          label: 'GPT-OSS · 20B',            sizeBytes: 13_793_441_244, ram: '~18 GB',  vision: false, thinking: true , desc: 'OpenAI open-weight reasoning model with tools. For high-end PCs.' },
  { name: 'mistral-small3.2:24b', label: 'Mistral Small 3.2 · 24B',  sizeBytes: 15_177_384_862, ram: '~20 GB',  vision: true , thinking: false, desc: 'Strong multilingual model with vision and tools. For high-end PCs.' },
  { name: 'gemma3:27b',           label: 'Gemma 3 · 27B',            sizeBytes: 17_396_936_941, ram: '~22 GB',  vision: true , thinking: false, desc: 'Google flagship open model with vision. For high-end PCs / GPUs.' },
  { name: 'qwen3:30b',            label: 'Qwen 3 · 30B (MoE)',       sizeBytes: 18_556_699_314, ram: '~24 GB',  vision: false, thinking: true , desc: 'Mixture-of-experts: runs faster than its size suggests. Needs a lot of memory.' },
  { name: 'qwen3-coder:30b',      label: 'Qwen 3 Coder · 30B (MoE)', sizeBytes: 18_556_700_761, ram: '~24 GB',  vision: false, thinking: false, desc: 'Qwen 3 coding model with tools. Needs a lot of memory.' },
  { name: 'qwen3:32b',            label: 'Qwen 3 · 32B',             sizeBytes: 20_201_253_829, ram: '~26 GB',  vision: false, thinking: true , desc: 'Top Qwen 3 dense model. Workstation hardware.' },
  { name: 'llama3.3:70b',         label: 'Llama 3.3 · 70B',          sizeBytes: 42_520_413_916, ram: '~53 GB',  vision: false, thinking: false, desc: 'Enterprise-grade 70B model. Workstation with a large GPU.' },
  { name: 'qwen2.5:72b',          label: 'Qwen 2.5 · 72B',           sizeBytes: 47_415_724_625, ram: '~58 GB',  vision: false, thinking: false, desc: 'Top-of-the-line 72B model. Workstation hardware.' }
];

// What Ollama reports each INSTALLED model can do, e.g. ["completion","tools","vision"].
// Authoritative when present; the catalog's `vision` flag is only a fallback.
const installedCapabilities = new Map();

function getModelInfo(modelName) {
  const provider = cloudProviderOf(modelName);
  if (provider) {
    const p = CLOUD_PROVIDERS[provider];
    const m = ((cloudState[provider] && cloudState[provider].models) || []).find((x) => x.name === modelName);
    return {
      name: modelName,
      label: m ? m.label : modelName.slice(provider.length + 1),
      cloud: provider,
      vision: true,
      tools: m ? m.tools : true,
      desc: `${p.name} model, on ${p.company}'s servers with your API key (${p.plan}). Your question, the conversation and related memory and file excerpts are sent to ${p.company}.`
    };
  }
  const info = MODEL_CATALOG.find((m) => m.name === modelName || m.name.startsWith(modelName + ':')) || {
    name: modelName,
    label: modelName,
    ram: 'Unknown',
    vision: false,
    desc: 'Custom installed model.'
  };
  const caps = installedCapabilities.get(modelName);
  if (!caps) return info;
  return { ...info, vision: caps.includes('vision'), tools: caps.includes('tools'), thinking: caps.includes('thinking') || Boolean(info.thinking) };
}

function renderCapCard(modelName, containerEl) {
  if (!containerEl) return;
  const info = getModelInfo(modelName);
  const toolsRow = info.tools === undefined ? '' : info.tools
    ? '<div class="cap-row"><span>Tools:</span> <span class="cap-val">✓ memory search, files</span></div>'
    : '<div class="cap-row cap-warn"><span>Tools:</span> <span class="cap-val">✗ not supported — can\'t search your memory or read files on its own (memory excerpts are still added)</span></div>';
  containerEl.innerHTML = `
    <div class="cap-title">
      <span>${escapeHtml(info.label)}</span>
      <span class="cap-badge ${info.vision ? 'vision' : ''}">${info.vision ? 'Images + text' : 'Text only'}</span>
    </div>
    ${info.cloud
    ? `<div class="cap-row"><span>Runs on:</span> <span class="cap-val">${CLOUD_PROVIDERS[info.cloud].company}'s servers (needs internet)</span></div>`
    : `<div class="cap-row"><span>RAM Required:</span> <span class="cap-val">${info.ram}</span></div>`}
    ${toolsRow}
    ${info.thinking ? '<div class="cap-row"><span>Reasoning:</span> <span class="cap-val">thinks before answering (slower, better on hard questions)</span></div>' : ''}
    <div class="cap-desc">${escapeHtml(info.desc)}</div>
  `;
  containerEl.classList.remove('hidden');
}

const SOURCE_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', app: 'This app', unknown: 'Imported' };
const SOURCE_COLORS = { chatgpt: '#10a37f', claude: '#cc785c', gemini: '#4285f4', app: '#ab68ff', unknown: '#6c8cff' };

// ── Stable IPC listeners ──────────────────────────────────────────────────────

// ── The answer being written ─────────────────────────────────────────────────
// Kept here, not only on screen: the model keeps working when the user
// switches to another chat, the Memory view or another window, and when they
// come back to that chat the thinking steps and the text so far are rebuilt.
// { sessionId, text, steps: [status], progress, sources, sourcesShown, bubble, textEl }
let liveRun = null;
const isLiveHere = () => Boolean(liveRun && liveRun.sessionId === activeSessionId);

// FIX: rendering full markdown on every single token was O(n^2) over a long
// response (re-parsing the whole accumulated string each time) and caused
// visible jank on longer answers. Batch DOM updates to at most once per
// animation frame instead of once per token — still feels live, far cheaper.
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled || !liveRun || !liveRun.textEl) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (liveRun && liveRun.textEl) {
      liveRun.textEl.innerHTML = renderMarkdown(stripCitations(liveRun.text));
      scrollToBottom();
    }
  });
}

/** Shows the answer being written in the open chat (again, after coming back to it). */
function mountLiveRun() {
  if (!isLiveHere()) return;
  const textEl = appendMessageBubble('assistant', '');
  const bubble = textEl.closest('.message');
  liveRun.bubble = bubble;
  liveRun.textEl = textEl;
  for (const step of liveRun.steps) addThoughtStep(bubble, step);
  if (liveRun.progress) addThoughtStep(bubble, liveRun.progress);
  if (liveRun.text) {
    textEl.innerHTML = renderMarkdown(stripCitations(liveRun.text));
    if (liveRun.sources) { renderSourceChips(bubble, liveRun.sources); liveRun.sourcesShown = true; }
  } else {
    bubble.classList.add('typing-indicator');
  }
  updateEmptyChatState();
}

window.api.onChatToken(({ sessionId, token }) => {
  if (!liveRun || liveRun.sessionId !== sessionId) return;
  liveRun.text += token;
  if (!liveRun.bubble) return; // not on screen right now: kept for when the user comes back
  liveRun.bubble.classList.remove('typing-indicator');
  scheduleRender();
  // Source chips once the first token arrives
  if (liveRun.sources && !liveRun.sourcesShown) {
    renderSourceChips(liveRun.bubble, liveRun.sources);
    liveRun.sourcesShown = true;
  }
});

window.api.onSessionUpdated(({ id, title }) => {
  if (id !== activeSessionId) return;
  const item = sessionList.querySelector(`[data-id="${id}"] .session-title`);
  if (item) item.textContent = title;
});

window.api.onChatSources(({ sessionId, sources }) => {
  if (liveRun && liveRun.sessionId === sessionId) liveRun.sources = sources;
});

window.api.onChatStatus(({ sessionId, status }) => {
  if (!liveRun || liveRun.sessionId !== sessionId) return;
  const info = typeof status === 'object' && status ? status : { icon: '⚡', text: String(status) };

  // FIX: the backend agent loop can run several internal steps before it has
  // a real final answer (e.g. a step that streams "let me search for that…"
  // and then turns out to just be a tool call). The backend emits
  // `{ type: 'reset' }` right before each new step starts (and immediately
  // once it detects a step ended in a tool call): that text wasn't the answer.
  if (info.type === 'reset') {
    liveRun.text = '';
    if (liveRun.textEl) liveRun.textEl.innerHTML = '';
    return;
  }
  if (info.type === 'progress') liveRun.progress = info;
  else { liveRun.progress = null; liveRun.steps.push(info); }
  if (liveRun.bubble) {
    addThoughtStep(liveRun.bubble, info);
    scrollToBottom();
  }
});

/** Adds one step (or the live "still generating…" row) to a bubble's "Thinking…" box. */
function addThoughtStep(bubble, info) {
  const body = bubble.querySelector('.message-body');
  if (!body) return;

  let box = bubble.querySelector('.thought-box');
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
    box.querySelector('.thought-header').addEventListener('click', () => box.classList.toggle('collapsed'));
  }

  const stepsList = box.querySelector('.thought-steps');
  const progressItem = stepsList.querySelector('.thought-step-item.progress');
  const countSteps = () => {
    const n = stepsList.querySelectorAll('li:not(.progress)').length;
    box.querySelector('.thought-count').textContent = `${n} step${n === 1 ? '' : 's'}`;
  };

  // Live progress (e.g. the "still generating… 42s" heartbeat): one row, updated in place.
  if (info.type === 'progress') {
    const item = progressItem || document.createElement('li');
    item.className = 'thought-step-item progress';
    item.innerHTML = `<span class="thought-step-dot"></span><span class="thought-step-text">${escapeHtml(info.text)}</span>`;
    stepsList.appendChild(item); // (re)attach at the end
    countSteps();
    return;
  }
  // A real step happened, so the live progress row is stale.
  if (progressItem) progressItem.remove();
  const stepItem = document.createElement('li');
  stepItem.className = 'thought-step-item';
  stepItem.innerHTML = `<span class="thought-step-dot"></span><span class="thought-step-text">${escapeHtml(info.text)}</span>`;
  stepsList.appendChild(stepItem);
  countSteps();
}

// ── Setup flow ────────────────────────────────────────────────────────────────
async function checkSetup() {
  // A cloud model chosen and its key saved: no local AI needed
  if (isCloudModel(activeModel)) {
    const providers = await window.api.cloudStatus().catch(() => null);
    const st = providers && providers[cloudProviderOf(activeModel)];
    if (st && st.hasKey) { enterApp(); return; }
  }
  const result = await window.api.checkOllama();
  if (result.running && result.chatInstalled && result.embedInstalled) { stopOllamaWatch(); setupOllama.classList.add('hidden'); enterApp(); return; }
  // Nothing set up yet: first ask how to run Athar — on this computer, or Gemini.
  // (Not when a local model's download was left unfinished: that one just continues.)
  if (!setupPathChosen && (!result.running || !result.chatInstalled)) {
    if ((await unfinishedChatModels()).length === 0) { showSetupPath(); return; }
    setupPathChosen = true;
  }
  if (!result.running) { showOllamaSetup(); return; }
  stopOllamaWatch();
  setupOllama.classList.add('hidden');
  // chatInstalled is true when ANY chat model is installed (not only the default)
  if (result.chatInstalled && result.embedInstalled) { enterApp(); return; }

  setupNeedsEmbed = !result.embedInstalled;

  // If no chat model is installed, let the user choose default or another model
  if (!result.chatInstalled) {
    // A chat model download was interrupted (the app was closed): just continue it
    const [unfinished] = await unfinishedChatModels();
    if (unfinished) {
      startSetupInstall(unfinished);
      setupStatus.textContent = `Continuing the download of ${getModelInfo(unfinished).label || unfinished} that didn't finish last time…`;
      return;
    }
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

// ── First choice: a local model, or Gemini ───────────────────────────────────
const setupPath        = document.getElementById('setupPath');
const setupCloud       = document.getElementById('setupCloud');
const setupGeminiKey   = document.getElementById('setupGeminiKey');
const setupGeminiSave  = document.getElementById('setupGeminiSave');
const setupGeminiNote  = document.getElementById('setupGeminiNote');
let setupPathChosen = false; // "local" chosen: the Ollama + model setup follows

function showSetupPath() {
  setupStatus.textContent = 'How do you want Athar to answer you?';
  setupCloud.classList.add('hidden');
  setupPath.classList.remove('hidden');
}

document.getElementById('setupPathLocal').addEventListener('click', () => {
  setupPathChosen = true;
  setupPath.classList.add('hidden');
  setupStatus.textContent = 'Checking your local AI engine…';
  checkSetup();
});
document.getElementById('setupPathCloud').addEventListener('click', () => {
  setupPath.classList.add('hidden');
  setupCloud.classList.remove('hidden');
  setupStatus.textContent = 'Use Gemini with your own free API key.';
  setupGeminiKey.focus();
});
document.getElementById('setupCloudBack').addEventListener('click', showSetupPath);

setupGeminiSave.addEventListener('click', async () => {
  const key = setupGeminiKey.value.trim();
  if (!key) { setupGeminiNote.textContent = 'Paste your API key first.'; setupGeminiNote.classList.remove('hidden'); return; }
  setupGeminiSave.disabled = true;
  setupGeminiSave.textContent = 'Checking…';
  setupGeminiNote.classList.add('hidden');
  const res = await window.api.cloudSetKey('gemini', key);
  const status = res.success ? res.providers.gemini : { error: res.error };
  setupGeminiSave.disabled = false;
  setupGeminiSave.textContent = 'Continue';
  if (!res.success || !status.recommended) {
    setupGeminiNote.textContent = status.error || 'No Gemini model is available for this key.';
    setupGeminiNote.classList.remove('hidden');
    return;
  }
  setupGeminiKey.value = '';
  activeModel = status.recommended;
  saveActiveModel(activeModel);
  setupCloud.classList.add('hidden');
  enterApp();
});
setupGeminiKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') setupGeminiSave.click(); });

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

// ── Unfinished model downloads (the app was closed mid-download) ──────────────
// Ollama keeps the part already downloaded, so continuing resumes from there.
const resumeDownload     = document.getElementById('resumeDownload');
const resumeDownloadText = document.getElementById('resumeDownloadText');

async function unfinishedChatModels() {
  try {
    const res = await window.api.pendingDownloads();
    return (res && res.models ? res.models : []).filter((m) => m !== EMBED_MODEL);
  } catch {
    return [];
  }
}

/** In the app: "Qwen 3 8B didn't finish downloading" with Continue / Dismiss. */
async function offerUnfinishedDownload() {
  const [model] = await unfinishedChatModels();
  if (!model) { resumeDownload.classList.add('hidden'); return; }
  const label = getModelInfo(model).label || model;
  resumeDownloadText.textContent = `${label} didn't finish downloading.`;
  resumeDownload.classList.remove('hidden');
  document.getElementById('resumeDownloadBtn').onclick = () => {
    resumeDownload.classList.add('hidden');
    openSettingsModal();
    // Continue in Settings, with its progress bar (the download picks up where it stopped)
    if (![...modelSelect.options].some((o) => o.value === model)) {
      const opt = document.createElement('option');
      opt.value = model;
      opt.textContent = label;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = model;
    modelSelect.dispatchEvent(new Event('change'));
    modelDownloadBtn.click();
  };
  document.getElementById('resumeDownloadDismiss').onclick = async () => {
    resumeDownload.classList.add('hidden');
    await window.api.discardPendingDownload(model);
    offerUnfinishedDownload(); // another one?
  };
}

async function enterApp() {
  setupOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
  loadSessionList();
  loadModelSelector();
  await initSavedHistory();
  await initWorkspace();
  setupPermissionModal();
  offerUnfinishedDownload();
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
    workspaceText.textContent = folderName;
    workspaceZone.title = `Project folder (read-only): ${folderPath}`;
    workspaceZone.classList.add('active');
    clearWorkspaceBtn.classList.remove('hidden');
  } else {
    workspaceText.textContent = 'Choose a folder…';
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
  const baseSub = 'The AI model is asking for permission:';
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
  importZone.classList.toggle('loaded', importedCount > 0);
  const parts = lastImportNote ? [lastImportNote] : [];
  if (memoryStats.pending > 0) {
    const pct = memoryStats.passages ? Math.floor((memoryStats.embedded / memoryStats.passages) * 100) : 0;
    parts.push(memoryStats.error
      ? `Indexing paused (${memoryStats.error.slice(0, 80)}). Keyword search still works; it resumes automatically.`
      : `Indexing memory… ${pct}%. You can chat meanwhile.`);
  } else if (importedCount > 0) {
    parts.push(`${importedCount.toLocaleString()} imported conversation${importedCount === 1 ? '' : 's'} in memory`);
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

// ── Cloud models: Gemini, ChatGPT, Claude (the user's own API keys) ─────────
// The keys are saved by the main process (encrypted); this window only learns
// whether one is set, and the models it can use.
const cloudProvidersEl = document.getElementById('cloudProviders');

/** The small square in front of a model: where it runs, or whose it is. */
const MODEL_ICONS = {
  local: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  gemini: '✦',
  openai: '<svg viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  anthropic: '✳'
};
function modelIcon(kind, small = false) {
  const k = MODEL_ICONS[kind] ? kind : 'local';
  return `<span class="mp-icon mp-icon-${k}${small ? ' small' : ''}" aria-hidden="true">${MODEL_ICONS[k]}</span>`;
}

function showCloudNote(provider, text, ok = false) {
  const row = cloudProvidersEl.querySelector(`[data-provider="${provider}"]`);
  const note = row && row.querySelector('.gemini-note');
  if (!note) return;
  note.textContent = text || '';
  note.classList.toggle('ok', ok);
  note.classList.toggle('hidden', !text);
}

function renderCloudProviders() {
  cloudProvidersEl.innerHTML = '';
  for (const [id, p] of Object.entries(CLOUD_PROVIDERS)) {
    const st = cloudState[id] || {};
    const count = (st.models || []).length;
    const row = document.createElement('div');
    row.className = 'cloud-provider';
    row.dataset.provider = id;
    row.innerHTML = `
      <div class="cloud-provider-head">
        ${modelIcon(id)}
        <div class="cloud-provider-title"><strong>${p.name}</strong><span>${p.company} · ${p.plan}</span></div>
        ${st.hasKey && count ? `<span class="cloud-provider-state">✓ ${count} model${count === 1 ? '' : 's'}</span>` : ''}
      </div>
      ${st.hasKey
    ? '<div class="cloud-provider-actions"><span>Key saved, stored encrypted on this computer.</span><button class="text-btn danger" type="button" data-action="remove">Remove key</button></div>'
    : `<div class="gemini-key-form">
          <input type="password" class="settings-input" placeholder="Paste your ${p.name} API key" autocomplete="off" spellcheck="false" />
          <button class="primary-btn" type="button" data-action="save">Save</button>
        </div>
        <p class="cloud-provider-hint">Get a key at <a href="${p.keyUrl}" target="_blank" rel="noopener">${p.keyUrl.replace(/^https:\/\//, '')}</a></p>`}
      <p class="gemini-note hidden"></p>`;
    cloudProvidersEl.appendChild(row);
    if (st.success === false && st.error) showCloudNote(id, st.error);
    else if (!st.hasKey && st.encryption === false) showCloudNote(id, 'This computer can\'t store an API key securely, so cloud models can\'t be used here.');

    const input = row.querySelector('input');
    const save = row.querySelector('[data-action="save"]');
    if (save) {
      save.addEventListener('click', () => saveCloudKey(id, input, save));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    }
    const remove = row.querySelector('[data-action="remove"]');
    if (remove) remove.addEventListener('click', () => removeCloudKey(id));
  }
}

async function loadCloudStatus() {
  try { cloudState = (await window.api.cloudStatus()) || {}; } catch { cloudState = {}; }
  renderCloudProviders();
}

async function saveCloudKey(provider, input, button) {
  const key = input.value.trim();
  if (!key) { showCloudNote(provider, 'Paste your API key first.'); return; }
  button.disabled = true;
  button.textContent = 'Checking…';
  showCloudNote(provider, '');
  const res = await window.api.cloudSetKey(provider, key);
  button.disabled = false;
  button.textContent = 'Save';
  if (!res.success) { showCloudNote(provider, res.error || 'The key could not be saved.'); return; }
  input.value = '';
  // Switch to the suggested model so it's ready to use
  const st = res.providers[provider];
  if (st && st.recommended) { activeModel = st.recommended; saveActiveModel(activeModel); }
  await loadModelSelector(); // reloads the providers too
  const count = (st && st.models ? st.models.length : 0);
  showCloudNote(provider, `Saved. ${count} ${CLOUD_PROVIDERS[provider].name} model${count === 1 ? '' : 's'} added to the model list` +
    `${st && st.recommended ? ` — now using ${modelDisplayName(st.recommended)}` : ''}.`, true);
}

async function removeCloudKey(provider) {
  const p = CLOUD_PROVIDERS[provider];
  if (!confirm(`Remove your ${p.name} API key from this computer? ${p.name} models will disappear from the model list.`)) return;
  await window.api.cloudClearKey(provider);
  await loadModelSelector(); // a model of this provider in use falls back to another one
  showCloudNote(provider, 'Key removed.', true);
}

// ── The model list: categorised, in the hidden <select> the picker shows ────
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
    await loadCloudStatus();

    const group = (category, label) => {
      const g = document.createElement('optgroup');
      g.label = label;
      g.dataset.category = category;
      modelSelect.appendChild(g);
      return g;
    };
    // Local models: the installed ones first, then the ones that can be downloaded
    const onThisPc = group('local', 'On this computer');
    const toDownload = group('download', 'Download to this computer');
    for (const entry of allEntries) {
      const inst = findInstalled(entry.name);
      const caps = inst && Array.isArray(inst.capabilities) ? inst.capabilities : null;
      if (caps) {
        installedCapabilities.set(entry.name, caps);
        installedCapabilities.set(inst.name, caps);
      }
      const opt  = document.createElement('option');
      opt.value  = entry.name;
      opt.dataset.installed = inst ? 'true' : 'false';
      opt.dataset.label = entry.label;
      const sizeStr = inst ? formatBytes(inst.size) : `~${formatBytes(entry.sizeBytes)}`;
      const noTools = caps && !caps.includes('tools');
      const vision = caps ? caps.includes('vision') : entry.vision;
      opt.dataset.meta = [sizeStr, entry.ram && !inst ? `${entry.ram} RAM` : null, vision ? 'sees images' : null,
        entry.thinking ? 'reasoning' : null, noTools ? 'no tools' : null].filter(Boolean).join(' · ');
      if (entry.name === CHAT_MODEL) opt.dataset.badge = 'Recommended';
      opt.textContent = inst
        ? `✓  ${entry.label}  (${sizeStr})${noTools ? '  · no tools' : ''}`
        : `${entry.label}  (${sizeStr}) · not downloaded`;
      (inst ? onThisPc : toDownload).appendChild(opt);
    }

    // Cloud models (with the user's API keys), one group per provider
    for (const [provider, p] of Object.entries(CLOUD_PROVIDERS)) {
      const st = cloudState[provider];
      const list = (st && st.models) || [];
      if (!list.length) continue;
      const g = group(provider, p.name);
      for (const m of list) {
        installedCapabilities.set(m.name, ['completion', 'vision', ...(m.tools ? ['tools'] : [])]);
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.dataset.installed = 'true';
        opt.dataset.cloud = 'true';
        opt.dataset.label = m.label;
        opt.dataset.meta = m.label === m.id ? `${p.company}` : m.id;
        if (m.name === st.recommended) opt.dataset.badge = 'Recommended';
        opt.textContent = `☁️  ${m.label}`;
        g.appendChild(opt);
      }
    }
    for (const g of [...modelSelect.querySelectorAll('optgroup')]) if (!g.children.length) g.remove();

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

// ── Model picker: a modern, categorised dropdown over the hidden <select> ────
// The <select> stays the source of truth (everything else reads and sets it);
// the picker only shows it and sets its value.
const modelPickerBtn    = document.getElementById('modelPickerBtn');
const modelPickerPanel  = document.getElementById('modelPickerPanel');
const modelPickerSearch = document.getElementById('modelPickerSearch');
const modelPickerList   = document.getElementById('modelPickerList');

const MODEL_CATEGORIES = {
  local:     { title: 'On this computer',          sub: 'private · offline' },
  download:  { title: 'Download to this computer', sub: 'free · private once downloaded' },
  gemini:    { title: 'Gemini',  sub: 'Google · free plan' },
  openai:    { title: 'ChatGPT', sub: 'OpenAI · paid per use' },
  anthropic: { title: 'Claude',  sub: 'Anthropic · paid per use' },
  other:     { title: 'Other',   sub: '' }
};

const categoryOf = (opt) => (opt && opt.parentElement && opt.parentElement.dataset.category) || (opt && cloudProviderOf(opt.value)) || 'other';
const CHECK_SVG = '<svg class="mp-item-end" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const DOWNLOAD_SVG = '<svg class="mp-item-end muted" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

function renderModelPicker() {
  const opt = modelSelect.options[modelSelect.selectedIndex];
  const nameEl = document.getElementById('modelPickerName');
  const metaEl = document.getElementById('modelPickerMeta');
  const iconEl = document.getElementById('modelPickerIcon');
  if (!opt) {
    nameEl.textContent = 'Choose a model';
    metaEl.textContent = '';
    iconEl.innerHTML = modelIcon('local');
  } else {
    const cat = categoryOf(opt);
    const info = MODEL_CATEGORIES[cat] || MODEL_CATEGORIES.other;
    nameEl.textContent = opt.dataset.label || opt.textContent.trim();
    metaEl.textContent = cat === 'download'
      ? `Not downloaded yet · ${opt.dataset.meta || ''}`
      : `${info.title} · ${cat === 'local' ? (opt.dataset.meta || '') : info.sub}`;
    iconEl.innerHTML = modelIcon(cat === 'other' ? 'local' : cat);
  }
  if (!modelPickerPanel.classList.contains('hidden')) renderModelPickerList();
}

function renderModelPickerList() {
  const q = modelPickerSearch.value.trim().toLowerCase();
  const matches = (opt) => !q || `${opt.dataset.label || opt.textContent} ${opt.dataset.meta || ''}`.toLowerCase().includes(q);
  // Groups as in the <select>; options outside a group go under "Other"
  const groups = [];
  const loose = [];
  for (const child of modelSelect.children) {
    if (child.tagName === 'OPTGROUP') groups.push({ category: child.dataset.category || 'other', options: [...child.children] });
    else loose.push(child);
  }
  if (loose.length) groups.push({ category: 'other', options: loose });

  const html = [];
  for (const { category, options } of groups) {
    const shown = options.filter(matches);
    if (!shown.length) continue;
    const info = MODEL_CATEGORIES[category] || MODEL_CATEGORIES.other;
    html.push(`<div class="mp-group"><div class="mp-group-head">${modelIcon(category === 'other' ? 'local' : category, true)}` +
      `<span class="mp-group-title">${escapeHtml(info.title)}</span><span class="mp-group-sub">${escapeHtml(info.sub)}</span></div>`);
    for (const opt of shown) {
      const selected = opt.value === modelSelect.value;
      html.push(`<button type="button" class="mp-item${selected ? ' selected' : ''}" role="option" aria-selected="${selected}" data-value="${escapeHtml(opt.value)}">` +
        `<span class="mp-item-text"><span class="mp-item-name">${escapeHtml(opt.dataset.label || opt.textContent.trim())}</span>` +
        `<span class="mp-item-meta">${escapeHtml(opt.dataset.meta || '')}</span></span>` +
        `${opt.dataset.badge ? `<span class="mp-item-badge">${escapeHtml(opt.dataset.badge)}</span>` : ''}` +
        `${selected ? CHECK_SVG : category === 'download' ? DOWNLOAD_SVG : ''}</button>`);
    }
    html.push('</div>');
  }
  // Cloud providers without a key: a way to add one
  const missing = Object.entries(CLOUD_PROVIDERS).filter(([id]) => !(cloudState[id] && cloudState[id].hasKey));
  if (missing.length && !q) {
    html.push('<div class="mp-group"><div class="mp-group-head"><span class="mp-group-title">Cloud models</span><span class="mp-group-sub">your own API key</span></div>');
    for (const [id, p] of missing) {
      html.push(`<button type="button" class="mp-item add" data-add="${id}">${modelIcon(id, true)}` +
        `<span class="mp-item-text"><span class="mp-item-name">Add a ${escapeHtml(p.name)} API key…</span>` +
        `<span class="mp-item-meta">${escapeHtml(p.company)} · ${escapeHtml(p.plan)}</span></span></button>`);
    }
    html.push('</div>');
  }
  modelPickerList.innerHTML = html.length ? html.join('') : '<p class="mp-empty">No models match.</p>';
}

function openModelPicker() {
  modelPickerSearch.value = '';
  modelPickerPanel.classList.remove('hidden');
  modelPickerBtn.setAttribute('aria-expanded', 'true');
  renderModelPickerList();
  const sel = modelPickerList.querySelector('.mp-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
  modelPickerSearch.focus();
}

function closeModelPicker(focusButton = false) {
  if (modelPickerPanel.classList.contains('hidden')) return;
  modelPickerPanel.classList.add('hidden');
  modelPickerBtn.setAttribute('aria-expanded', 'false');
  if (focusButton) modelPickerBtn.focus();
}

modelPickerBtn.addEventListener('click', () => {
  if (modelPickerPanel.classList.contains('hidden')) openModelPicker(); else closeModelPicker();
});
modelPickerSearch.addEventListener('input', renderModelPickerList);
modelPickerList.addEventListener('click', (e) => {
  const item = e.target.closest('.mp-item');
  if (!item) return;
  if (item.dataset.add) {
    // "Add a ChatGPT API key…": to that provider's key field, below in Settings
    closeModelPicker();
    const row = cloudProvidersEl.querySelector(`[data-provider="${item.dataset.add}"]`);
    if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); const input = row.querySelector('input'); if (input) input.focus(); }
    return;
  }
  modelSelect.value = item.dataset.value;
  modelSelect.dispatchEvent(new Event('change'));
  closeModelPicker(true);
});
// Keyboard: arrows move through the list, Enter picks, Escape closes
modelPickerPanel.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModelPicker(true); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  const items = [...modelPickerList.querySelectorAll('.mp-item')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Enter') {
    if (i < 0) { e.preventDefault(); items[0].click(); }
    return;
  }
  e.preventDefault();
  const next = e.key === 'ArrowDown' ? (i < 0 ? 0 : Math.min(items.length - 1, i + 1)) : (i <= 0 ? -1 : i - 1);
  if (next < 0) modelPickerSearch.focus(); else items[next].focus();
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#modelPicker')) closeModelPicker();
});

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
    renderModelPicker();
    return;
  }
  const isInstalled = opt.dataset.installed === 'true';

  renderCapCard(opt.value, sidebarCapCard);
  renderModelPicker();
  if (opt.dataset.cloud === 'true') {
    modelAction.classList.add('hidden');
    updateCapabilityUI();
    updateHeaderModelDisplay();
    return;
  }
  modelAction.classList.remove('hidden');

  if (isInstalled) {
    modelDownloadProgress.classList.add('hidden');
    modelDownloadBtn.classList.add('hidden');
    modelDeleteBtn.classList.remove('hidden');
    modelDeleteBtn.disabled = false;
    modelDeleteBtn.textContent = 'Uninstall this model';
  } else {
    modelDownloadProgress.classList.add('hidden');
    modelDeleteBtn.classList.add('hidden');
    modelDownloadBtn.classList.remove('hidden');
    modelDownloadBtn.disabled = false;
    modelDownloadBtn.textContent = 'Download';
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
    modelDownloadBtn.textContent = 'Retry download';
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
    modelDeleteBtn.textContent = 'Uninstall this model';
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
  // Newest first, under small date headings (Today, Yesterday, …)
  const time = (s) => s.updatedAt || s.createdAt || 0;
  let lastGroup = null;
  for (const s of [...sessions].sort((a, b) => time(b) - time(a))) {
    const group = sessionGroup(time(s));
    if (group !== lastGroup) {
      const heading = document.createElement('li');
      heading.className = 'session-group';
      heading.textContent = group;
      sessionList.appendChild(heading);
      lastGroup = group;
    }
    const li = document.createElement('li');
    li.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
    li.dataset.id = s.id;
    const title = document.createElement('span');
    title.className = 'session-title';
    title.dir = 'auto';
    title.textContent = s.title;
    const del = document.createElement('button');
    del.className = 'session-delete';
    del.title = 'Delete chat';
    del.setAttribute('aria-label', 'Delete chat');
    del.innerHTML = svgIcon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>');
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });
    li.appendChild(title);
    li.appendChild(del);
    li.addEventListener('click', () => openSession(s.id));
    sessionList.appendChild(li);
  }
  markGeneratingSession();
}

function sessionGroup(ms) {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (ms >= startOfToday.getTime()) return 'Today';
  if (ms >= startOfToday.getTime() - day) return 'Yesterday';
  if (ms >= startOfToday.getTime() - 7 * day) return 'Previous 7 days';
  if (ms >= startOfToday.getTime() - 30 * day) return 'Previous 30 days';
  return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

async function createNewChat() {
  const { session } = await window.api.chatCreate();
  await loadSessionList();
  openSession(session.id);
}

async function deleteSession(id) {
  if (liveRun && liveRun.sessionId === id) await window.api.chatStop(id); // its answer isn't needed any more
  await window.api.chatDelete(id);
  if (activeSessionId === id) { activeSessionId = null; showEmptyState(); }
  await loadSessionList();
}

async function openSession(id) {
  activeSessionId = id;
  sessionsWithNewAnswer.delete(id);
  markGeneratingSession();
  document.querySelectorAll('.session-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  const { session } = await window.api.chatGet(id);
  if (headerChatTitle && session) {
    headerChatTitle.textContent = session.title || 'Athar';
  }
  renderMessages(session ? session.messages || [] : []);
  updateSendState(); // Stop if this chat's answer is still being written, Send otherwise
  clearAttachedDocuments();
  clearAttachedImages();
  renderSessionResourcesUI(id);
  showChatView();
  scrollToBottom();
  messageInput.focus();
}

// ── History tab ───────────────────────────────────────────────────────────────
async function renderHistoryTab() {
  if (!historyList) return; // the sidebar has no memory list any more (the Memory view does)
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

// FIX: the model's context can include raw text from attached files and
// imported chats. If that text contained
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

// The model cites memories as [M1], [M2, M3]… The main process uses those to
// know which chats an answer used (the chips); the labels themselves are
// hidden from the answer. Code like arr[M1] is left alone.
const CITATION = String.raw`\[M\d+(?:\s*[,–-]\s*M?\d+)*\]`;
const LEADING_CITATIONS_RE = new RegExp(String.raw`^([ \t]*(?:[-*+]|\d+[.)])?[ \t]*)(?:${CITATION}[ \t]*)+`, 'gm');
const INLINE_CITATION_RE = new RegExp(String.raw`[ \t]*(?<!\w)${CITATION}`, 'g');

function stripCitations(text) {
  if (!text || !text.includes('[M')) return text;
  return text
    .replace(LEADING_CITATIONS_RE, '$1')   // "[M1] You discussed…" / "- [M2] You worked…"
    .replace(INLINE_CITATION_RE, '')       // "…as we decided [M1]." → "…as we decided."
    .replace(/[ \t]*\(\s*(?:see\s*)?\)/gi, ''); // "(see [M1])" leftovers
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
  if (liveRun) { liveRun.bubble = null; liveRun.textEl = null; } // its bubble was just removed
  for (const msg of messages) {
    const textEl = appendMessageBubble(msg.role, msg.text, msg.images || [], msg.documents || []);
    const bubble = textEl.closest('.message');
    if (msg.role === 'assistant' && Array.isArray(msg.steps) && msg.steps.length) {
      for (const step of msg.steps) addThoughtStep(bubble, { text: step });
      finishThoughtBox(bubble);
    }
    if (msg.role === 'assistant' && msg.sources && msg.sources.length) renderSourceChips(bubble, msg.sources);
  }
  mountLiveRun(); // this chat's answer is still being written
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
    textEl.innerHTML = renderMarkdown(role === 'assistant' ? stripCitations(text) : text);
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

// ── Prompt navigation ─────────────────────────────────────────────────────────
// A slim rail on the right of the chat: one mark per question you asked.
// Hover it for the list of questions; click one to jump to it. The question
// on screen is highlighted. Alt+↑ / Alt+↓ go to the previous / next question.
const promptNav = document.getElementById('promptNav');
let promptItems = []; // [{ el, tick, row }]
let promptNavTimer = null;

function promptLabel(messageEl) {
  const text = (messageEl.querySelector('.message-text') || {}).textContent || '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean) return clean;
  const doc = messageEl.querySelector('.msg-doc-name');
  return doc ? doc.textContent.trim() : 'Attachment';
}

function buildPromptNav() {
  const prompts = [...messageList.querySelectorAll(':scope > .message.user')];
  promptNav.innerHTML = '';
  promptItems = [];
  if (prompts.length < 2) { promptNav.classList.add('hidden'); return; }

  const rail = document.createElement('div');
  rail.className = 'prompt-nav-rail';
  const panel = document.createElement('div');
  panel.className = 'prompt-nav-panel';
  const heading = document.createElement('div');
  heading.className = 'prompt-nav-heading';
  heading.textContent = `Your questions (${prompts.length})`;
  const list = document.createElement('div');
  list.className = 'prompt-nav-list';
  panel.append(heading, list);

  prompts.forEach((el, i) => {
    const label = promptLabel(el);
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'prompt-nav-tick';
    tick.setAttribute('aria-label', `Question ${i + 1}: ${label.slice(0, 80)}`);
    tick.addEventListener('click', () => jumpToPrompt(i));
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'prompt-nav-item';
    row.innerHTML = '<span class="prompt-nav-num"></span><span class="prompt-nav-text" dir="auto"></span>';
    row.querySelector('.prompt-nav-num').textContent = i + 1;
    row.querySelector('.prompt-nav-text').textContent = label;
    row.title = label.slice(0, 300);
    row.addEventListener('click', () => jumpToPrompt(i));
    rail.appendChild(tick);
    list.appendChild(row);
    promptItems.push({ el, tick, row });
  });

  const hint = document.createElement('div');
  hint.className = 'prompt-nav-hint';
  hint.textContent = 'Alt + ↑ / ↓ to move between questions';
  panel.appendChild(hint);
  promptNav.append(panel, rail);
  promptNav.classList.remove('hidden');
  updateActivePrompt();
}

/** Index of the question at the top of the view (the last one scrolled past). */
function currentPromptIndex() {
  const top = messageList.getBoundingClientRect().top + 80;
  let current = 0;
  promptItems.forEach(({ el }, i) => { if (el.getBoundingClientRect().top <= top) current = i; });
  return current;
}

function updateActivePrompt() {
  if (!promptItems.length) return;
  const current = currentPromptIndex();
  promptItems.forEach(({ tick, row }, i) => {
    tick.classList.toggle('active', i === current);
    row.classList.toggle('active', i === current);
  });
}

function jumpToPrompt(i) {
  const item = promptItems[Math.max(0, Math.min(i, promptItems.length - 1))];
  if (!item) return;
  messageList.scrollTo({ top: messageList.scrollTop + item.el.getBoundingClientRect().top - messageList.getBoundingClientRect().top - 16, behavior: 'smooth' });
}

// The question list opens on hover or keyboard focus, and closes after a
// short delay so the pointer can cross the gap between the rail and the list.
let promptNavCloseTimer = null;
const openPromptNav = () => { clearTimeout(promptNavCloseTimer); promptNav.classList.add('open'); };
const closePromptNav = () => {
  clearTimeout(promptNavCloseTimer);
  promptNavCloseTimer = setTimeout(() => { if (!promptNav.contains(document.activeElement)) promptNav.classList.remove('open'); }, 200);
};
promptNav.addEventListener('mouseenter', openPromptNav);
promptNav.addEventListener('mouseleave', closePromptNav);
promptNav.addEventListener('focusin', openPromptNav);
promptNav.addEventListener('focusout', () => { clearTimeout(promptNavCloseTimer); promptNavCloseTimer = setTimeout(() => {
  if (!promptNav.contains(document.activeElement) && !promptNav.matches(':hover')) promptNav.classList.remove('open');
}, 200); });

let promptScrollFrame = null;
messageList.addEventListener('scroll', () => {
  if (promptScrollFrame) return;
  promptScrollFrame = requestAnimationFrame(() => { promptScrollFrame = null; updateActivePrompt(); });
});
// Rebuild when messages are added or the chat changes (not on every streamed token)
new MutationObserver(() => {
  clearTimeout(promptNavTimer);
  promptNavTimer = setTimeout(buildPromptNav, 120);
}).observe(messageList, { childList: true });

document.addEventListener('keydown', (e) => {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  if (chatView.classList.contains('hidden') || promptItems.length < 2) return;
  e.preventDefault();
  const i = currentPromptIndex();
  const itemTop = promptItems[i].el.getBoundingClientRect().top - messageList.getBoundingClientRect().top;
  if (e.key === 'ArrowUp') jumpToPrompt(itemTop < -40 ? i : i - 1); // inside an answer: back to its question first
  else jumpToPrompt(i + 1);
});

// ── Sending messages ──────────────────────────────────────────────────────────
const SEND_ICON = svgIcon('<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>');
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>';
const sessionsWithNewAnswer = new Set(); // finished while the user was in another chat

async function sendMessage() {
  if (liveRun || !activeSessionId) return;
  const text = messageInput.value.trim();
  if (!text && attachedImages.length === 0 && attachedDocuments.length === 0) return;

  const currentImagesBase64 = attachedImages.map((i) => i.base64);
  const currentImagesDataUrl = attachedImages.map((i) => i.dataUrl);
  const currentDocs = [...attachedDocuments];

  messageInput.value = '';
  messageInput.style.height = 'auto';
  clearAttachedImages();
  clearAttachedDocuments();

  const sessionId = activeSessionId;
  liveRun = { sessionId, text: '', steps: [], progress: null, sources: null, sourcesShown: false, bubble: null, textEl: null };
  updateSendState();
  markGeneratingSession();

  appendMessageBubble('user', text, currentImagesDataUrl, currentDocs);
  updateEmptyChatState();
  mountLiveRun();
  scrollToBottom();

  const result = await window.api.chatSend(sessionId, text, activeModel, currentImagesBase64, currentDocs);

  const run = liveRun;
  liveRun = null;

  if (run.bubble && run.sessionId === activeSessionId) {
    // The main process returns the final answer — the exact text it saved.
    // It can differ from the streamed tokens (a non-streamed fallback answer, an
    // appended warning, a recovered tool result, "Stopped."), so it replaces them.
    const bubble = run.bubble;
    const textEl = run.textEl;
    textEl.innerHTML = renderMarkdown(stripCitations(result.success && typeof result.reply === 'string' ? result.reply : run.text));
    bubble.classList.remove('typing-indicator');
    if (result.success && result.stopped) addThoughtStep(bubble, { text: 'Stopped by you.' });
    finishThoughtBox(bubble);
    // Final chips know which memories the answer actually cited
    if (result.success && result.sources && result.sources.length) renderSourceChips(bubble, result.sources);
    else if (run.sources) renderSourceChips(bubble, run.sources); // error case: show what was found
    if (!result.success) {
      textEl.textContent = `Error: ${result.error}`;
      textEl.style.color = 'var(--danger)';
    }
    scrollToBottom();
    renderSessionResourcesUI(sessionId);
  } else if (result.success) {
    sessionsWithNewAnswer.add(sessionId); // a dot in the chat list until it's opened
  }

  markGeneratingSession();
  updateSendState();
  if (run.sessionId === activeSessionId) messageInput.focus();
}

/** Chat list: which chat is being answered right now, and which has a new answer. */
function markGeneratingSession() {
  document.querySelectorAll('.session-item[data-id]').forEach((el) => {
    el.classList.toggle('generating', Boolean(liveRun && liveRun.sessionId === el.dataset.id));
    el.classList.toggle('has-new', sessionsWithNewAnswer.has(el.dataset.id));
  });
}

/** Send, or Stop while this chat's answer is being written. */
function onSendButton() {
  if (isLiveHere()) {
    sendBtn.disabled = true;
    window.api.chatStop(liveRun.sessionId);
    return;
  }
  sendMessage();
}

newChatBtn.addEventListener('click', createNewChat);
emptyNewChatBtn.addEventListener('click', createNewChat);
sendBtn.addEventListener('click', onSendButton);
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
  const stopMode = isLiveHere();
  sendBtn.classList.toggle('is-stop', stopMode);
  sendBtn.innerHTML = stopMode ? STOP_ICON : SEND_ICON;
  sendBtn.title = stopMode ? 'Stop' : liveRun ? 'Wait — an answer is being written in another chat' : 'Send (Enter)';
  sendBtn.setAttribute('aria-label', stopMode ? 'Stop' : 'Send');
  sendBtn.disabled = stopMode ? false : Boolean(liveRun) || !hasContent;
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
importZone.addEventListener('click', (e) => { if (e.target !== fileInput) fileInput.click(); });
importZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
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
  navMemoryBtn.classList.add('active');
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
document.getElementById('navMemoryBtn').addEventListener('click', () => showMemoryView());
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
  if (isCloudModel(activeModel) && !confirm(`Building your profile with ${modelDisplayName(activeModel)} sends your messages from up to ${profileScope.value} past conversations to ${CLOUD_PROVIDERS[cloudProviderOf(activeModel)].company}.\n\n` +
    `To keep them on this computer, choose a local model in Settings first. Continue with ${CLOUD_PROVIDERS[cloudProviderOf(activeModel)].name}?`)) return;
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

// Version at the bottom of Settings (so testers can say which build they have)
window.api.appVersion().then((v) => { const el = document.getElementById('appVersion'); if (el) el.textContent = v; }).catch(() => {});
if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettingsModal);
if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);
if (headerModelPill) headerModelPill.addEventListener('click', openSettingsModal);

if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);

// License, privacy policy and open-source notices (Settings footer)
const docModal = document.getElementById('docModal');
const DOC_TITLES = { license: 'License agreement', privacy: 'Privacy policy', notices: 'Open-source licenses' };

async function openDocument(name) {
  const body = document.getElementById('docBody');
  document.getElementById('docTitle').textContent = DOC_TITLES[name] || '';
  body.innerHTML = '';
  body.className = 'doc-body';
  docModal.classList.remove('hidden');
  const res = await window.api.appDocument(name);
  if (!res.success) { body.textContent = `Could not open this document: ${res.error}`; return; }
  if (name === 'privacy') {
    body.classList.add('markdown', 'message-text');
    body.innerHTML = renderMarkdown(res.text);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'doc-text';
    pre.textContent = res.text;
    body.appendChild(pre);
  }
  body.scrollTop = 0;
}
const closeDocument = () => docModal.classList.add('hidden');

document.querySelectorAll('.settings-about [data-doc]').forEach((btn) => {
  btn.addEventListener('click', () => openDocument(btn.dataset.doc));
});
document.getElementById('docCloseBtn').addEventListener('click', closeDocument);
docModal.querySelector('.settings-backdrop').addEventListener('click', closeDocument);

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!docModal.classList.contains('hidden')) { closeDocument(); return; } // the reader first, then Settings
  if (settingsModal && !settingsModal.classList.contains('hidden')) closeSettingsModal();
});

// Restore saved sidebar collapsed state
if (localStorage.getItem('sidebarCollapsed') === 'true' && appShell) {
  appShell.classList.add('sidebar-collapsed');
}

// ── View helpers ──────────────────────────────────────────────────────────────
function showChatView() {
  memoryView.classList.add('hidden');
  navMemoryBtn.classList.remove('active');
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  updateHeaderModelDisplay();
}

function showEmptyState() {
  if (sessionResourcesBar) sessionResourcesBar.classList.add('hidden');
  memoryView.classList.add('hidden');
  navMemoryBtn.classList.remove('active');
  chatView.classList.add('hidden');
  emptyState.classList.remove('hidden');
  if (headerChatTitle) headerChatTitle.textContent = 'Athar';
  updateHeaderModelDisplay();
}

// ── Beta license ──────────────────────────────────────────────────────────────
const licenseOverlay     = document.getElementById('licenseOverlay');
const licenseKeyInput    = document.getElementById('licenseKeyInput');
const licenseMessage     = document.getElementById('licenseMessage');
const licenseActivateBtn = document.getElementById('licenseActivateBtn');

const LICENSE_MESSAGES = {
  missing: '',
  invalid: 'This key isn\'t valid. Check that you pasted all of it.',
  'wrong-computer': 'This key was made for a different computer. Send the developer the computer ID above to get a key for this one.',
  expired: 'This beta key has ended. Ask the developer for a new one.',
  clock: 'Your computer\'s date looks wrong (it was set back). Fix the date and time, then try again.',
  'not-configured': 'This build of Athar isn\'t set up for activation. Please get a new installer from the developer.'
};

const licenseUsable = (status) => status && ['ok', 'dev'].includes(status.state);

function formatLicenseDate(yyyyMmDd) {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? yyyyMmDd : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Settings footer: who the beta is licensed to, and until when (with a warning near the end). */
function renderLicenseLine(status) {
  const el = document.getElementById('licenseLine');
  if (!el) return;
  if (!status || status.state !== 'ok') { el.textContent = ''; return; }
  el.textContent = ` · Beta · Licensed to ${status.name} · until ${formatLicenseDate(status.expires)}` +
    (status.warn ? ` (${status.daysLeft} day${status.daysLeft === 1 ? '' : 's'} left)` : '');
  el.classList.toggle('warn', Boolean(status.warn));
}

function showLicenseScreen(status) {
  appShell.classList.add('hidden');
  setupOverlay.classList.add('hidden');
  licenseOverlay.classList.remove('hidden');
  document.getElementById('licenseComputerId').textContent = (status && status.computerId) || '…';
  licenseMessage.textContent = LICENSE_MESSAGES[status && status.state] || '';
  licenseKeyInput.focus();
}

async function activateLicense() {
  const key = licenseKeyInput.value.trim();
  if (!key) { licenseMessage.textContent = 'Paste your license key first.'; return; }
  licenseActivateBtn.disabled = true;
  licenseMessage.textContent = 'Checking…';
  const status = await window.api.licenseActivate(key);
  licenseActivateBtn.disabled = false;
  if (!licenseUsable(status)) { licenseMessage.textContent = LICENSE_MESSAGES[status.state] || 'This key couldn\'t be activated.'; return; }
  renderLicenseLine(status);
  licenseOverlay.classList.add('hidden');
  setupOverlay.classList.remove('hidden');
  checkSetup();
}

licenseActivateBtn.addEventListener('click', activateLicense);
licenseKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); activateLicense(); } });
document.getElementById('licenseCopyIdBtn').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText(document.getElementById('licenseComputerId').textContent.trim());
    e.target.textContent = 'Copied';
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
  } catch { /* clipboard unavailable */ }
});
// The key ran out while the app was open
window.api.onLicenseChanged((status) => { if (!licenseUsable(status)) showLicenseScreen(status); });

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  let status = null;
  try { status = await window.api.licenseStatus(); } catch { status = { state: 'invalid' }; }
  if (!licenseUsable(status)) { showLicenseScreen(status); return; }
  renderLicenseLine(status);
  checkSetup();
})();