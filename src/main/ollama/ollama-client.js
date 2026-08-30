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
 * Builds the prompt with three layers:
 * 1. System instructions
 * 2. Imported history context (background, silent - ranked threads from uploaded export)
 * 3. Local conversation history (the actual chat turns so far)
 * 4. New user message
 */
function buildPrompt(userText, importedThreads, conversationHistory) {
  let prompt = '';

  // Layer 1: system
  prompt += `You are a helpful personal assistant. You have access to the user's past imported conversation history (if any) and you remember the current chat session.\n\n`;

  // Layer 2: imported history context (silent background)
  if (importedThreads && importedThreads.length > 0) {
    prompt += `--- Relevant past conversations (for context only, do not mention these directly unless asked) ---\n`;
    importedThreads.forEach((t, i) => {
      const date = t.createTime
        ? new Date(t.createTime * 1000).toISOString().slice(0, 10)
        : 'unknown date';
      // Truncate each thread to 1500 chars to keep prompt manageable
      const text = t.fullText.length > 1500 ? t.fullText.slice(0, 1500) + '…' : t.fullText;
      prompt += `[Thread ${i + 1}: "${t.title}" - ${date}]\n${text}\n\n`;
    });
    prompt += `--- End of past context ---\n\n`;
  }

  // Layer 3: current session conversation history
  if (conversationHistory && conversationHistory.length > 0) {
    // Only include last 10 turns to avoid blowing context window
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${label}: ${msg.text}\n`;
    }
  }

  // Layer 4: new message
  prompt += `User: ${userText}\nAssistant:`;

  return prompt;
}

async function generate(userText, importedThreads, conversationHistory, modelName = DEFAULT_MODEL, onToken = () => {}) {
  const prompt = buildPrompt(userText, importedThreads, conversationHistory);

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, prompt, stream: true })
  });

  if (!res.ok || !res.body) throw new Error(`Ollama generate failed: ${res.status}`);

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
        if (chunk.response) {
          full += chunk.response;
          onToken(chunk.response);
        }
      } catch {}
    }
  }

  return full;
}

module.exports = { DEFAULT_MODEL, isOllamaRunning, listModels, isModelInstalled, pullModel, generate };
