const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of',
  'in', 'on', 'for', 'and', 'or', 'but', 'with', 'that', 'this', 'my',
  'me', 'i', 'you', 'what', 'how', 'do', 'did', 'does', 'it', 'at',
  'from', 'about', 'can', 'will', 'would', 'should', 'please', 'tell'
]);

/**
 * Pulls meaningful search terms out of a free-form question, dropping
 * stopwords and very short tokens so common words don't dominate scoring.
 */
function extractKeywords(query) {
  return (query.toLowerCase().match(/[a-z0-9+#._-]+/g) || [])
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scores every thread by how many times the query's keywords appear in it,
 * then returns the top N threads. This is intentionally simple (raw
 * frequency, not TF-IDF or embeddings) so it runs instantly with no
 * dependencies - see the project README for the planned v2 upgrade path.
 */
function rankThreads(threads, query, topN = 12) {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    // No usable keywords - fall back to most recent threads.
    return [...threads]
      .sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
      .slice(0, topN)
      .map((t) => ({ ...t, score: 0 }));
  }

  const patterns = keywords.map((kw) => new RegExp(escapeRegex(kw), 'gi'));

  const scored = threads.map((thread) => {
    let score = 0;
    for (const pattern of patterns) {
      const matches = thread.fullText.match(pattern);
      if (matches) score += matches.length;
    }
    return { ...thread, score };
  });

  return scored
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

module.exports = { rankThreads, extractKeywords };
