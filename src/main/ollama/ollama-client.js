const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:0.8b';

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

async function isModelInstalled(modelName = DEFAULT_MODEL) {
  const models = await listModels();
  return models.some((name) => name === modelName || name.startsWith(`${modelName}:`));
}

async function pullModel(modelName = DEFAULT_MODEL, onProgress = () => {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true })
  });

  if (!res.ok || !res.body) throw new Error(`Failed to start model pull: ${res.status}`);

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
 * Builds an array of chat messages for Ollama's /api/chat endpoint.
 * Uses the messages format which is more reliable than raw prompt strings,
 * and avoids issues with thinking-model <think> tag output.
 *
 * Structure:
 *  - system message with instructions + imported context
 *  - conversation history turns
 *  - current user message
 */
function buildMessages(userText, importedThreads, conversationHistory) {
  const messages = [];

  // System message: instructions + silent imported context
  let systemContent = `You are a helpful personal assistant. Answer clearly and concisely.`;

  if (importedThreads && importedThreads.length > 0) {
    systemContent += `\n\nYou have access to the user's past conversation history for context. Use it to inform your answers if relevant, but do not mention it unless the user asks.\n\n`;
    importedThreads.forEach((t, i) => {
      const date = t.createTime
        ? new Date(t.createTime * 1000).toISOString().slice(0, 10)
        : 'unknown date';
      const text = t.fullText.length > 1500
        ? t.fullText.slice(0, 1500) + '…'
        : t.fullText;
      systemContent += `[Past thread ${i + 1}: "${t.title}" - ${date}]\n${text}\n\n`;
    });
  }

  messages.push({ role: 'system', content: systemContent });

  // Conversation history (last 10 turns)
  if (conversationHistory && conversationHistory.length > 0) {
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      messages.push({ role: msg.role, content: msg.text });
    }
  }

  // Current user message
  messages.push({ role: 'user', content: userText });

  return messages;
}

/**
 * Uses /api/chat (not /api/generate) - more reliable for conversation,
 * handles thinking models correctly, cleaner JSON structure.
 */
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
        num_predict: 1024   // cap response length so small model doesn't loop
      }
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
        // /api/chat response structure: chunk.message.content
        const token = chunk.message && chunk.message.content;
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {}
    }
  }

  return full;
}

module.exports = {
  DEFAULT_MODEL,
  isOllamaRunning,
  listModels,
  isModelInstalled,
  pullModel,
  generate
};
