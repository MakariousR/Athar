const { embedText } = require('../ollama/ollama-client');

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Relevance threshold — threads scoring below this are excluded entirely.
 *
 * nomic-embed-text cosine similarity scale:
 *   > 0.85  very highly relevant (same topic, same context)
 *   > 0.75  relevant (related topic, worth including)
 *   > 0.60  loosely related (maybe useful)
 *   < 0.60  unrelated — injecting this hurts more than it helps
 *
 * We use 0.70 as the cutoff: strict enough to exclude noise,
 * loose enough to catch genuinely useful past threads.
 */
/**
 * Relevance threshold — threads scoring below this are excluded.
 * For nomic-embed-text cosine similarity:
 *   > 0.70  extremely close match
 *   > 0.45  topic alignment / relevant match
 *   < 0.45  unrelated
 */
const RELEVANCE_THRESHOLD = 0.45;

/**
 * Hard cap on total characters of thread content injected into the prompt.
 */
const MAX_TOTAL_CONTEXT_CHARS = 12000;

/**
 * Per-thread content truncation — 2500 chars captures deep context.
 */
const MAX_CHARS_PER_THREAD = 2500;

/**
 * Ranks embedded threads against a query, applying a relevance threshold
 * so only genuinely related threads are returned.
 *
 * Returns [] if nothing clears the threshold — the model then answers
 * from its own knowledge + conversation history, which is correct behaviour
 * for prompts unrelated to the imported history.
 *
 * @param {Array}  threads - threads with .embedding float[]
 * @param {string} query   - user question + recent conversation context
 * @param {number} topN    - max threads to return even if more pass threshold
 */
async function rankThreadsSemantic(threads, query, topN = 5) {
  if (!threads || threads.length === 0) return [];

  const embeddedThreads = threads.filter((t) => t.embedding && t.embedding.length > 0);
  if (embeddedThreads.length === 0) return [];

  const queryEmbedding = await embedText(query.slice(0, 2000));

  const scored = embeddedThreads
    .map((t) => ({
      ...t,
      score: parseFloat(cosineSimilarity(queryEmbedding, t.embedding).toFixed(4))
    }))
    .filter((t) => t.score >= RELEVANCE_THRESHOLD) // drop irrelevant threads entirely
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  // Enforce total context budget — truncate each thread and stop adding
  // once we've hit the character cap
  let totalChars = 0;
  const result = [];

  for (const t of scored) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) break;
    const truncated = t.fullText.length > MAX_CHARS_PER_THREAD
      ? t.fullText.slice(0, MAX_CHARS_PER_THREAD) + '…'
      : t.fullText;
    result.push({ ...t, fullText: truncated });
    totalChars += truncated.length;
  }

  return result;
}

module.exports = {
  rankThreadsSemantic,
  cosineSimilarity,
  RELEVANCE_THRESHOLD
};
