const { embedText } = require('../ollama/ollama-client');
const { normalizeArabicText } = require('../utils/text-normalizer');

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
const RELEVANCE_THRESHOLD = 0.68;

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

  const normalizedQuery = normalizeArabicText(query.slice(0, 2000));
  const queryEmbedding = await embedText(normalizedQuery);

  let scored = embeddedThreads
    .map((t) => {
      const semScore = cosineSimilarity(queryEmbedding, t.embedding);
      // Keyword fallback boost: check if query words (e.g. جامعة, university) appear in thread title/text
      const normText = normalizeArabicText(t.title + ' ' + (t.fullText || ''));
      const queryWords = normalizedQuery.split(/\s+/).filter((w) => w.length > 2);
      let kwHits = 0;
      for (const word of queryWords) {
        if (normText.includes(word)) kwHits++;
      }
      const kwScore = queryWords.length > 0 ? (kwHits / queryWords.length) * 0.3 : 0;
      const finalScore = parseFloat((semScore + kwScore).toFixed(4));

      return {
        ...t,
        score: finalScore
      };
    })
    .filter((t) => t.score >= RELEVANCE_THRESHOLD) // Strict cutoff so imported history only matches when genuinely relevant
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

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
  normalizeArabicText,
  RELEVANCE_THRESHOLD
};
