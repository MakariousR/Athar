const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:3b';
const EMBED_MODEL = 'bge-m3';

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
  // Return objects with name + size so callers can sort lightest → heaviest
  return (data.models || []).map((m) => ({ name: m.name, size: m.size || 0 }));
}

async function isModelInstalled(modelName) {
  const models = await listModels();
  return models.some((m) => m.name === modelName || m.name.startsWith(`${modelName}:`));
}

async function checkAllModels() {
  const models = await listModels();
  const has = (name) => models.some((m) => m.name === name || m.name.startsWith(`${name}:`));
  const chatInstalled  = has(DEFAULT_MODEL);
  const embedInstalled = has(EMBED_MODEL);
  return { chatInstalled, embedInstalled, allInstalled: chatInstalled && embedInstalled };
}

async function pullModel(modelName, onProgress = () => {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true })
  });
  if (!res.ok || !res.body) throw new Error(`Failed to pull ${modelName}: ${res.status}`);

  const reader  = res.body.getReader();
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

async function embedText(text) {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  });
  if (!res.ok) throw new Error(`Embed failed: ${res.status}`);
  const data = await res.json();
  return data.embedding;
}

async function embedThreads(threads, onProgress = () => {}) {
  const results = [];
  for (let i = 0; i < threads.length; i++) {
    const t    = threads[i];
    const text = `${t.title}\n${t.fullText}`.slice(0, 2000);
    const embedding = await embedText(text);
    results.push({ ...t, embedding });
    onProgress(i + 1, threads.length);
  }
  return results;
}

/**
 * Builds the message array for /api/chat.
 *
 * Imported threads are already filtered by relevance threshold and truncated
 * to 600 chars each by semantic-ranker before reaching here.
 * This keeps the prompt lean so the model has maximum room to generate.
 */
function buildMessages(userText, importedThreads, conversationHistory) {
  const messages = [];

  let systemContent = `You are a personal AI memory assistant. You are given excerpts from the user's past conversation history. Your primary task is to answer the user's prompt using the facts, topics, code, and details contained in these past conversations.

If past conversations are provided below, assume they contain the relevant information the user is asking about and summarize or cite them directly in your response.`;

  // Inject matching threads
  if (importedThreads && importedThreads.length > 0) {
    systemContent += `\n\n=== RETRIEVED PAST CONVERSATIONS ===\n`;
    importedThreads.forEach((t, i) => {
      const date = t.createTime
        ? new Date(t.createTime * 1000).toISOString().slice(0, 10)
        : 'unknown date';

      let threadDialogue = '';
      if (t.messages && t.messages.length > 0) {
        threadDialogue = t.messages
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
          .join('\n');
      } else {
        threadDialogue = t.fullText || '';
      }

      const text = threadDialogue.length > 2500 ? threadDialogue.slice(0, 2500) + '…' : threadDialogue;
      systemContent += `\n--- Past Thread ${i + 1}: "${t.title}" (${date}) ---\n${text}\n`;
    });
    systemContent += `\n=== END PAST CONVERSATIONS ===\n`;
  }

  messages.push({ role: 'system', content: systemContent });

  // Last 10 conversation turns — enough for context without eating the window
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
      options: {
        temperature: 0.7,
        num_predict: -1    // no hard cap — model stops when naturally done
      }
    })
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.status);
    throw new Error(`Ollama chat failed: ${errText}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full   = '';

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
