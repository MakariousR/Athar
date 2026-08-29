const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:0.8b'; // smallest tier, used for MVP validation

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
  return models.some((name) => name === modelName || name.startsWith(`${modelName}-`));
}

/**
 * Pulls a model, streaming progress events back via onProgress.
 * Each event looks like: { status: "downloading", completed, total } or
 * { status: "success" } when finished.
 */
async function pullModel(modelName = DEFAULT_MODEL, onProgress = () => {}) {
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true })
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to start model pull: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep any partial line for the next chunk

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const status = JSON.parse(line);
        onProgress(status);
      } catch {
        // ignore malformed/partial JSON lines
      }
    }
  }

  return { success: true };
}

/**
 * Builds the final prompt sent to the model: the user's question plus
 * the full text of the top-ranked threads, each clearly labeled so the
 * model can tell threads apart and cite dates if asked.
 */
function buildPrompt(question, threads) {
  const contextBlocks = threads
    .map((t, i) => {
      const date = t.createTime
        ? new Date(t.createTime * 1000).toISOString().slice(0, 10)
        : 'unknown date';
      return `--- Thread ${i + 1}: "${t.title}" (${date}) ---\n${t.fullText}`;
    })
    .join('\n\n');

  return (
    `You are a personal assistant with access to the user's past conversation history below. ` +
    `Use it to answer their question. If the history doesn't contain the answer, say so.\n\n` +
    `${contextBlocks}\n\n` +
    `--- Current question ---\n${question}`
  );
}

/**
 * Streams a generation response token-by-token via onToken(text),
 * and returns the full concatenated response once done.
 */
async function generate(question, threads, modelName = DEFAULT_MODEL, onToken = () => {}) {
  const prompt = buildPrompt(question, threads);

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, prompt, stream: true })
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama generate failed: ${res.status}`);
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
        if (chunk.response) {
          full += chunk.response;
          onToken(chunk.response);
        }
      } catch {
        // ignore malformed/partial JSON lines
      }
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
