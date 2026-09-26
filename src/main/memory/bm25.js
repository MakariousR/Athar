/**
 * Small in-memory BM25 keyword index over memory chunks.
 *
 * Embeddings are good at meaning ("database design" ≈ "Postgres schema") but
 * weak at exact names, numbers, error codes and rare words; keyword search is
 * the opposite. Memory search combines both. The keyword side also works for
 * chunks that haven't been embedded yet (e.g. right after a big import).
 */
const { normalizeArabicText } = require('../utils/text-normalizer');

const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'with', 'as', 'by', 'from', 'what', 'which', 'who', 'how', 'do',
  'does', 'did', 'about', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'can', 'could',
  'would', 'should', 'will', 'have', 'has', 'had', 'not', 'no', 'yes', 'so', 'if', 'then', 'than', 'there', 'here',
  'when', 'where', 'why', 'all', 'any', 'some', 'just', 'also', 'into', 'out', 'up', 'down', 'user', 'assistant',
  // Arabic (normalized forms)
  'في', 'من', 'علي', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'ان', 'او', 'و', 'ما', 'لا', 'هل',
  'كان', 'كانت', 'هو', 'هي', 'انا', 'انت', 'نحن', 'هم', 'كل', 'قد', 'لم', 'لن', 'ثم', 'كيف', 'ماذا', 'متي', 'اين'
]);

function tokenize(text) {
  const norm = normalizeArabicText(String(text || '')).toLowerCase();
  const tokens = norm.match(/[\p{L}\p{N}][\p{L}\p{N}_+#.-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) || [];
  const out = [];
  for (let t of tokens) {
    // Arabic definite article: "الكتاب" should match "كتاب"
    if (t.length > 4 && t.startsWith('ال') && /^[؀-ۿ]+$/.test(t)) t = t.slice(2);
    if (t.length < 2 || STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

class Bm25Index {
  constructor({ k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.postings = new Map(); // term → Array<[docIdx, tf]>
    this.docLengths = [];
    this.totalLength = 0;
  }

  /** Adds documents in order; their positions are their doc indexes. */
  addAll(texts) {
    for (const text of texts) this.add(text);
  }

  add(text) {
    const docIdx = this.docLengths.length;
    const tokens = tokenize(text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [term, count] of tf) {
      let list = this.postings.get(term);
      if (!list) { list = []; this.postings.set(term, list); }
      list.push([docIdx, count]);
    }
    this.docLengths.push(tokens.length);
    this.totalLength += tokens.length;
    return docIdx;
  }

  get size() { return this.docLengths.length; }

  /**
   * @returns {Map<number, { score: number, matched: number }>} docIdx → BM25
   *   score and how many distinct query terms it contains.
   */
  search(query, { allowed = null } = {}) {
    const terms = [...new Set(tokenize(query))];
    const results = new Map();
    const N = this.docLengths.length;
    if (N === 0 || terms.length === 0) return { results, termCount: terms.length };
    const avgLen = this.totalLength / N || 1;

    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5));
      for (const [docIdx, tf] of list) {
        if (allowed && !allowed.has(docIdx)) continue;
        const len = this.docLengths[docIdx];
        const s = idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (len / avgLen)));
        const cur = results.get(docIdx);
        if (cur) { cur.score += s; cur.matched += 1; }
        else results.set(docIdx, { score: s, matched: 1 });
      }
    }
    return { results, termCount: terms.length };
  }
}

module.exports = { Bm25Index, tokenize };
