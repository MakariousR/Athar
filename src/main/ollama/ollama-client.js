const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:0.8b';
const EMBED_MODEL = 'nomic-embed-text';

async function isOllamaRunning() {
  try {
    const res = await fetch(OLLAMA_BASE, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function listModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Failed to list models: ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

async function isModelInstalled(modelName) {
  const models = await listModels();
  return models.some((name) => name === modelName || name.startsWith(`${modelName}:`));
}

/**
 * Checks both required models and returns which are missing.
 * Returns: { chatInstalled, embedInstalled, allInstalled }
 */
async function checkAllModels() {
  const models = await listModels();
  const has = (name) => models.some((m) => m === name || m.startsWith(`${name}:`));
  const chatInstalled = has(DEFAULT_MODEL);
  const embedInstalled = has(EMBED_MODEL);
  return { chatInstalled, embedInstalled, allInstalled: chatInstalled && embedInstalled };
}

/**
 * Pulls a single model, streaming progress via onProgress.
 */
async function pullModel(modelName, onProgress = () => {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true })
  });

  if (!res.ok || !res.body) throw new Error(`Failed to pull ${modelName}: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onProgress(JSON.parse(line)); } catch {}
    }
  }
  return { success: true };
}

/**
 * Embeds a single string using nomic-embed-text.
 * Returns a float array (the embedding vector).
 */
async function embedText(text) {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  if (!res.ok) throw new Error(`Embed failed: ${res.status}`);
  const data = await res.json();
  return data.embedding; // float[]
}

/**
 * Embeds all threads in batches, calling onProgress(done, total) after each.
 * Returns threads with an added .embedding field.
 */
async function embedThreads(threads, onProgress = () => {}) {
  const results = [];
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    // Truncate to 2000 chars — nomic-embed-text has a token limit
    const text = `${t.title}\n${t.fullText}`.slice(0, 2000);
    const embedding = await embedText(text);
    results.push({ ...t, embedding });
    onProgress(i + 1, threads.length);
  }
  return results;
}

function buildMessages(userText, importedThreads, conversationHistory) {
  const messages = [];

  let systemContent = `You are a helpful personal assistant. Answer clearly and concisely.`;

  if (importedThreads && importedThreads.length > 0) {
    systemContent += `\n\nYou have access to the user's past conversation history for context. Use it to inform your answers if relevant, but do not mention it unless the user asks.\n\n`;
    importedThreads.forEach((t, i) => {
      const date = t.createTime
        ? new Date(t.createTime * 1000).toISOString().slice(0, 10)
        : 'unknown date';
      const text = t.fullText.length > 1500 ? t.fullText.slice(0, 1500) + '…' : t.fullText;
      systemContent += `[Past thread ${i + 1}: "${t.title}" - ${date}]\n${text}\n\n`;
    });
  }

  messages.push({ role: 'system', content: systemContent });

  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      messages.push({ role: msg.role, content: msg.text });
    }
  }

  messages.push({ role: 'user', content: userText });
  return messages;
}

async function generate(userText, importedThreads, conversationHistory, modelName = DEFAULT_MODEL, onToken = () => {}) {
  const messages = buildMessages(userText, importedThreads, conversationHistory);

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: true,
      options: { temperature: 0.7, num_predict: 1024 }
    })
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.status);
    throw new Error(`Ollama chat failed: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        const token = chunk.message && chunk.message.content;
        if (token) { full += token; onToken(token); }
      } catch {}
    }
  }
  return full;
}

module.exports = {
  DEFAULT_MODEL,
  EMBED_MODEL,
  isOllamaRunning,
  listModels,
  isModelInstalled,
  checkAllModels,
  pullModel,
  embedText,
  embedThreads,
  generate
};
