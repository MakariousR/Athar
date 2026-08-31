/**
 * Semantic ranker using cosine similarity between embedding vectors.
 * Replaces keyword-ranker.js entirely — same interface, much better results.
 *
 * Threads must have a .embedding field (float[]) added by embedThreads().
 * The query embedding is computed fresh each call via ollama-client.embedText().
 */
const { embedText } = require('../ollama/ollama-client');

/**
 * Cosine similarity between two float arrays.
 * Returns a value between -1 (opposite) and 1 (identical meaning).
 */
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
 * Ranks embedded threads against a query string.
 * Returns the top N most semantically similar threads, each with a .score field.
 *
 * @param {Array}  threads  - threads with .embedding field from embedThreads()
 * @param {string} query    - the user's current question / combined context string
 * @param {number} topN     - how many threads to return (default 8)
 */
async function rankThreadsSemantic(threads, query, topN = 8) {
  if (!threads || threads.length === 0) return [];

  // Threads without embeddings fall back gracefully (e.g. if embedding was skipped)
  const embeddedThreads = threads.filter((t) => t.embedding && t.embedding.length > 0);
  if (embeddedThreads.length === 0) return [];

  // Embed the query
  const queryEmbedding = await embedText(query.slice(0, 2000));

  // Score every thread
  const scored = embeddedThreads.map((t) => ({
    ...t,
    score: parseFloat(cosineSimilarity(queryEmbedding, t.embedding).toFixed(4))
  }));

  // Sort descending by similarity, take top N
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = { rankThreadsSemantic, cosineSimilarity };
