// All calls go through window.api, exposed safely by preload.js via contextBridge.
// No Node/Electron internals are accessible directly from this file.

const statusBadge = document.getElementById('statusBadge');
const setupPanel = document.getElementById('setupPanel');
const setupMessage = document.getElementById('setupMessage');
const pullModelBtn = document.getElementById('pullModelBtn');
const pullProgressWrap = document.getElementById('pullProgressWrap');
const pullProgressFill = document.getElementById('pullProgressFill');
const pullProgressText = document.getElementById('pullProgressText');

const mainPanel = document.getElementById('mainPanel');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const parseStatus = document.getElementById('parseStatus');
const askSection = document.getElementById('askSection');
const questionInput = document.getElementById('questionInput');
const askBtn = document.getElementById('askBtn');
const answerBox = document.getElementById('answerBox');
const threadList = document.getElementById('threadList');

let loadedThreads = []; // parsed from the user's export file, kept in renderer memory

// ---------- Setup flow ----------

async function checkSetup() {
  const { running, modelInstalled } = await window.api.checkOllama();

  if (!running) {
    statusBadge.textContent = 'Ollama not running';
    statusBadge.className = 'status-badge status-error';
    setupPanel.classList.remove('hidden');
    mainPanel.classList.add('hidden');
    setupMessage.innerHTML =
      'Ollama isn\'t running. Install it from <strong>ollama.com</strong> and start it, then relaunch this app.';
    return;
  }

  if (!modelInstalled) {
    statusBadge.textContent = 'Model not installed';
    statusBadge.className = 'status-badge status-unknown';
    setupPanel.classList.remove('hidden');
    mainPanel.classList.add('hidden');
    setupMessage.textContent = 'Download the AI model to get started (one-time, ~1GB).';
    pullModelBtn.classList.remove('hidden');
    return;
  }

  statusBadge.textContent = 'Ready';
  statusBadge.className = 'status-badge status-ok';
  setupPanel.classList.add('hidden');
  mainPanel.classList.remove('hidden');
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
    pullProgressFill.style.width = '100%';
    pullProgressText.textContent = 'Done';
    setTimeout(checkSetup, 500);
  } else {
    setupMessage.textContent = `Download failed: ${result.error}. Try again.`;
    pullModelBtn.disabled = false;
    pullModelBtn.textContent = 'Retry download';
  }
});

// ---------- File drop / parse ----------

async function handleFile(file) {
  if (!file) return;
  parseStatus.classList.remove('hidden');
  parseStatus.textContent = 'Parsing your export…';

  const filePath = window.api.getFilePath(file);
  const result = await window.api.parseExport(filePath);

  if (!result.success) {
    parseStatus.textContent = `Couldn't parse that file: ${result.error}`;
    parseStatus.style.color = 'var(--danger)';
    return;
  }

  loadedThreads = result.threads;
  parseStatus.style.color = 'var(--success)';
  parseStatus.textContent = `Loaded ${loadedThreads.length} conversation${loadedThreads.length === 1 ? '' : 's'}.`;
  askSection.classList.remove('hidden');
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  handleFile(file);
});

// ---------- Ask flow ----------

function renderThreadList(ranked) {
  threadList.innerHTML = '';
  if (ranked.length === 0) {
    threadList.innerHTML = '<li>No matching threads found - answer is based on general knowledge only.</li>';
    return;
  }
  for (const t of ranked) {
    const li = document.createElement('li');
    const date = t.createTime ? new Date(t.createTime * 1000).toLocaleDateString() : 'unknown date';
    li.innerHTML = `<span class="thread-title">${escapeHtml(t.title)}</span><span class="thread-meta">${date} · score ${t.score}</span>`;
    threadList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function askQuestion() {
  const question = questionInput.value.trim();
  if (!question || loadedThreads.length === 0) return;

  askBtn.disabled = true;
  answerBox.textContent = 'Thinking…';

  const rankResult = await window.api.rankThreads(loadedThreads, question, 12);
  const ranked = rankResult.success ? rankResult.ranked : [];
  renderThreadList(ranked);

  window.api.onGenerateToken((token) => {
    // Clear the "Thinking…" placeholder on first token
    if (answerBox.textContent === 'Thinking…') answerBox.textContent = '';
    answerBox.textContent += token;
  });

  const result = await window.api.ask(question, ranked);
  askBtn.disabled = false;

  if (!result.success) {
    answerBox.textContent = `Something went wrong: ${result.error}`;
  }
}

askBtn.addEventListener('click', askQuestion);
questionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') askQuestion();
});

// ---------- Init ----------

checkSetup();
