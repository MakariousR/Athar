// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE_SIZE = 10 * 1024 * 1024;   // 10 MB max per document on disk
const MAX_CHAR_COUNT = 3_000_000;         // storage cap. Content is NOT put in the prompt anymore,
                                          // so this only bounds disk/memory; tools cap what each call returns.
const LINES_PER_PAGE = 100;               // virtual "page" size for text/code files
const CHARS_PER_PAGE = 6000;              // ...or this many characters, whichever comes first
const MAX_OUTLINE_ENTRIES = 40;

// ─── pdf-parse loading ───────────────────────────────────────────────────────
// Requiring the package root in v1.x runs debug code that tries to open a test
// PDF when module.parent is missing (common under bundlers/Electron). The
// inner file is the real implementation.
let pdfParse = null;
function loadPdfParse() {
  if (pdfParse) return pdfParse;
  for (const id of ['pdf-parse/lib/pdf-parse.js', 'pdf-parse']) {
    try {
      const mod = require(id);
      const fn = typeof mod === 'function' ? mod : (mod && typeof mod.default === 'function' ? mod.default : null);
      if (fn) { pdfParse = fn; return fn; }
    } catch { /* try next */ }
  }
  throw new Error('PDF engine not available. Run: npm install pdf-parse@1.1.1');
}

function sha1Buffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

// ─── Cleaning ────────────────────────────────────────────────────────────────

/** Light cleaner for code / plain text: keeps indentation and every real line. */
function cleanCodeText(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

const LIGATURES = { '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st' };

/** Sentence-ending punctuation (Latin + Arabic + CJK), optionally followed by closing quotes/brackets. */
const TERMINAL_RE = /[.!?…:;\u061F\u06D4\u3002]["'\u201D\u2019)\]]*$/;
const LIST_MARKER_RE = /^([-\u2022*\u25AA\u25E6\u25CF\u2013]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s/;
const ALL_CAPS_HEADING_RE = /^[A-Z0-9][A-Z0-9 \-:&,]{3,}$/;

function shouldJoin(prev, next) {
  if (LIST_MARKER_RE.test(next)) return false;
  if (ALL_CAPS_HEADING_RE.test(next)) return false;
  if (TERMINAL_RE.test(prev)) return false;
  if (prev.length < 25) return false; // short line → probably a heading / label, not a wrapped line
  return true;
}

/**
 * Turns PDF-style hard-wrapped lines into paragraphs:
 *  - "compu-" + "ter"           → "computer"
 *  - mid-sentence line breaks   → single space
 *  - blank lines                → paragraph breaks (kept)
 *  - headings, list items, short lines stay on their own line
 */
function reflowParagraphs(text) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) { flush(); out.push(''); continue; }
    if (!buf) { buf = line; continue; }

    if (/[A-Za-z\u0600-\u06FF]-$/.test(buf) && /^[a-z\u0600-\u06FF]/.test(line)) {
      buf = buf.slice(0, -1) + line;           // de-hyphenate
    } else if (shouldJoin(buf, line)) {
      buf += ' ' + line;
    } else {
      flush();
      buf = line;
    }
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Cleaner for text that came out of a PDF: glyph noise, ligatures, spacing, then reflow. */
function cleanPdfText(raw) {
  let text = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/[\uFB00-\uFB06]/g, (c) => LIGATURES[c] || c)
    .replace(/[\uE000-\uF8FF\uFFFD\u200B\uFEFF\u00AD]/g, '') // private-use glyphs, replacement chars, zero-width, soft hyphen
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n');
  return reflowParagraphs(text);
}

// Kept for backward compatibility with any other caller.
const cleanExtractedText = cleanPdfText;

// ─── Outline extraction ──────────────────────────────────────────────────────

function shorten(s, n = 70) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function capOutline(entries) {
  if (entries.length <= MAX_OUTLINE_ENTRIES) return entries;
  const step = entries.length / MAX_OUTLINE_ENTRIES;
  return Array.from({ length: MAX_OUTLINE_ENTRIES }, (_, i) => entries[Math.floor(i * step)]);
}

const PDF_HEADING_RE = /^((\d+(\.\d+)*[.)]?|chapter|section|part|appendix|abstract|introduction|conclusion|references)\b.{0,70}|[A-Z][A-Z0-9 \-:&,]{4,60})$/i;

function pdfHeadingCandidate(pageText) {
  const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12);
  for (const l of lines) {
    if (l.length < 4 || l.length > 80) continue;
    if (/^\d+$/.test(l)) continue;                 // bare page number
    if (TERMINAL_RE.test(l)) continue;             // sentence, not heading
    if (PDF_HEADING_RE.test(l)) return l;
  }
  return null;
}

function buildPdfOutline(pages) {
  const entries = [];
  let last = '';
  for (const p of pages) {
    const h = pdfHeadingCandidate(p.text || '');
    if (h && h !== last) { entries.push({ page: p.page, label: shorten(h) }); last = h; }
  }
  if (entries.length > 0) return capOutline(entries);

  // No recognisable headings: fall back to the first line of each page, skipping
  // repeated running headers and bare page numbers.
  const seen = new Set();
  for (const p of pages.slice(0, 60)) {
    const first = (p.text || '').split('\n').map((l) => l.trim()).find((l) => l && !/^\d+$/.test(l));
    if (first && !seen.has(first)) { seen.add(first); entries.push({ page: p.page, label: shorten(first) }); }
  }
  return capOutline(entries);
}

const SYMBOL_RES = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([\w$]+)/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([\w$]+)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/,
  /^\s*(?:async\s+)?def\s+(\w+)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)/,
  /^\s*(?:export\s+)?(?:interface|enum|struct|trait|type)\s+([\w$]+)/
];

function buildCodeOutline(pages, ext) {
  const entries = [];
  const isMarkdown = ext === '.md' || ext === '.markdown';
  for (const p of pages) {
    const lines = (p.text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNo = (p.lineStart || 1) + i;
      if (isMarkdown) {
        const m = lines[i].match(/^(#{1,4})\s+(.+)$/);
        if (m) entries.push({ page: p.page, label: `${'  '.repeat(m[1].length - 1)}${shorten(m[2], 60)} (line ${lineNo})` });
      } else {
        for (const re of SYMBOL_RES) {
          const m = lines[i].match(re);
          if (m) { entries.push({ page: p.page, label: `${m[1]} (line ${lineNo})` }); break; }
        }
      }
    }
  }
  return capOutline(entries);
}

// ─── Text / code files ───────────────────────────────────────────────────────

/**
 * Chunk lines into virtual pages: ≤ LINES_PER_PAGE lines or ≤ CHARS_PER_PAGE
 * chars per page. Lines are never split, so joining pages with '\n'
 * reproduces the file exactly and line numbers stay exact.
 */
function chunkLines(lines) {
  const pages = [];
  let cur = [];
  let curChars = 0;
  let start = 1;
  const push = () => {
    pages.push({ page: pages.length + 1, lineStart: start, lineEnd: start + cur.length - 1, text: cur.join('\n') });
  };
  lines.forEach((ln, idx) => {
    if (cur.length > 0 && (cur.length >= LINES_PER_PAGE || curChars + ln.length + 1 > CHARS_PER_PAGE)) {
      push();
      cur = [];
      curChars = 0;
    }
    if (cur.length === 0) start = idx + 1;
    cur.push(ln);
    curChars += ln.length + 1;
  });
  if (cur.length > 0) push();
  return pages;
}

function parseTextBuffer(filePath, buf, stat) {
  const sample = buf.subarray(0, 8000);
  if (sample.includes(0)) {
    throw new Error('This looks like a binary file, not text or source code.');
  }
  const decoded = buf.toString('utf8');
  const head = decoded.slice(0, 8000);
  const bad = (head.match(/\uFFFD/g) || []).length;
  if (head.length > 0 && bad / head.length > 0.02) {
    throw new Error('This file is not valid UTF-8 text.');
  }

  let text = cleanCodeText(decoded);
  let truncated = false;
  if (text.length > MAX_CHAR_COUNT) {
    text = text.slice(0, MAX_CHAR_COUNT);
    truncated = true;
  }

  const lines = text.split('\n');
  const pages = chunkLines(lines);
  const ext = path.extname(filePath).toLowerCase();
  const charCount = text.length;

  return {
    success: true,
    name: path.basename(filePath),
    ext,
    size: stat.size,
    hash: sha1Buffer(buf),
    pages: pages.length > 0 ? pages : [{ page: 1, lineStart: 1, lineEnd: 1, text: '' }],
    pageCount: Math.max(1, pages.length),
    lineCount: lines.length,
    charCount,
    outline: buildCodeOutline(pages, ext),
    truncated,
    noText: text.trim().length === 0,
    warning: text.trim().length === 0 ? 'The file is empty.' : undefined
  };
}

function parseTextFile(filePath) {
  const stat = fs.statSync(filePath);
  return parseTextBuffer(filePath, fs.readFileSync(filePath), stat);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** Drops a bare page number ("3", "Page 3", "- 3 -") sitting alone as the first or last line of a page. */
function stripPageNumberLines(text) {
  const lines = text.split('\n');
  const isPageNo = (l) => /^(page\s*)?[-\u2013\s]*\d{1,3}[-\u2013\s]*(of\s*\d{1,4})?$/i.test(l.trim());
  while (lines.length > 1 && isPageNo(lines[lines.length - 1])) lines.pop();
  while (lines.length > 1 && isPageNo(lines[0])) lines.shift();
  return lines.join('\n').trim();
}

/**
 * pdf-parse `pagerender`: builds each page's text from positioned items,
 * inserting a newline when the baseline moves and a space when there is a
 * visible horizontal gap between items (many PDFs emit words as separate
 * items with no space characters). Results are stored by page index.
 */
function createPdfPageRenderer(pageTexts) {
  return function customPageRender(pageData) {
    return pageData.getTextContent({ normalizeWhitespace: true }).then((textContent) => {
      let text = '';
      let lastY = null;
      let lastStart = 0;
      let lastEnd = 0;
      for (const item of textContent.items) {
        if (!item || typeof item.str !== 'string' || item.str === '') continue;
        const [, , , , x, y] = item.transform;
        const fontH = item.height || 10;
        if (lastY === null) {
          text += item.str;
        } else if (Math.abs(y - lastY) > Math.max(2.5, fontH * 0.4)) {
          text += '\n' + item.str;
        } else {
          // same line: add a space if there's a visible gap (LTR or RTL) and none already present
          const gap = Math.max(x - lastEnd, lastStart - (x + (item.width || 0)));
          const needsSpace = gap > fontH * 0.2 && !/\s$/.test(text) && !/^\s/.test(item.str);
          text += (needsSpace ? ' ' : '') + item.str;
        }
        lastY = y;
        lastStart = x;
        lastEnd = x + (item.width || 0);
      }
      const cleaned = stripPageNumberLines(cleanPdfText(text));
      const idx = typeof pageData.pageIndex === 'number' ? pageData.pageIndex : pageTexts.length;
      pageTexts[idx] = cleaned;
      return cleaned;
    });
  };
}

async function parsePdfBuffer(filePath, buf, stat) {
  const pdf = loadPdfParse();

  // pdf.js prints noisy TrueType warnings for many real-world PDFs
  const origWarn = console.warn;
  console.warn = function (...args) {
    if (typeof args[0] === 'string' && (args[0].includes('Warning: TT:') || args[0].includes('undefined function'))) return;
    origWarn.apply(console, args);
  };

  let pageTexts = [];
  let pdfData;
  try {
    try {
      pdfData = await pdf(buf, { pagerender: createPdfPageRenderer(pageTexts) });
    } catch {
      // The custom renderer can fail part-way on unusual PDFs, leaving pageTexts
      // half-filled. Discard it and retry with a fresh array so page data and
      // page count can never disagree.
      pageTexts = [];
      try {
        pdfData = await pdf(buf, { pagerender: createPdfPageRenderer(pageTexts) });
      } catch {
        pageTexts = [];
        pdfData = await pdf(buf); // last resort: plain extraction, no per-page split
      }
    }
  } finally {
    console.warn = origWarn;
  }

  const numPages = pdfData.numpages || pageTexts.length || 1;
  let pages = [];
  if (pageTexts.length > 0) {
    for (let i = 0; i < numPages; i++) pages.push({ page: i + 1, text: pageTexts[i] || '' });
  } else {
    // No per-page data: single "page" containing the whole extraction
    pages = [{ page: 1, text: cleanPdfText(pdfData.text || '') }];
  }

  // Storage cap
  let total = 0;
  let truncated = false;
  const kept = [];
  for (const p of pages) {
    if (total + p.text.length > MAX_CHAR_COUNT) {
      const room = Math.max(0, MAX_CHAR_COUNT - total);
      if (room > 0) kept.push({ page: p.page, text: p.text.slice(0, room) });
      truncated = true;
      break;
    }
    kept.push(p);
    total += p.text.length;
  }
  pages = kept;

  const charCount = pages.reduce((n, p) => n + p.text.length, 0);
  const lineCount = pages.reduce((n, p) => n + (p.text ? p.text.split('\n').length : 0), 0);
  const noText = charCount < 20 * Math.max(1, numPages);

  return {
    success: true,
    name: path.basename(filePath),
    ext: '.pdf',
    size: stat.size,
    hash: sha1Buffer(buf),
    pages,
    pageCount: pdfData.numpages || pages.length,
    lineCount,
    charCount,
    outline: noText ? [] : buildPdfOutline(pages),
    truncated,
    noText,
    warning: noText
      ? 'No extractable text found — this PDF is probably scanned images. It needs OCR before the AI can read it.'
      : undefined
  };
}

async function parsePdfFile(filePath) {
  return parsePdfBuffer(filePath, fs.readFileSync(filePath), fs.statSync(filePath));
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Detects file type and returns the parsed document, INCLUDING page content.
 * This is a main-process-internal shape: don't ship it to the renderer, send
 * toMetadata(parsed) instead.
 */
async function parseDocumentFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: `File not found: "${filePath}"` };
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return { success: false, error: `"${path.basename(filePath)}" is a directory, not a document file.` };
  }
  if (stat.size > MAX_FILE_SIZE) {
    return { success: false, error: `File is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 10 MB.` };
  }

  const ext = path.extname(filePath).toLowerCase();
  try {
    const buf = fs.readFileSync(filePath);
    return ext === '.pdf'
      ? await parsePdfBuffer(filePath, buf, stat)
      : parseTextBuffer(filePath, buf, stat);
  } catch (err) {
    return { success: false, error: `Failed to parse "${path.basename(filePath)}": ${err.message}` };
  }
}

/** Lightweight description that is safe/cheap to send over IPC. */
function toMetadata(doc) {
  if (!doc) return doc;
  const { pages, text, ...meta } = doc;
  return meta;
}

/** Parses in-memory text as if it were a file called `name` (e.g. a past conversation attached to a chat). */
function parseTextContent(name, text) {
  const buf = Buffer.from(String(text || ''), 'utf8');
  return parseTextBuffer(name, buf, { size: buf.length });
}

module.exports = {
  parseDocumentFile,
  parseTextContent,
  parseTextFile,
  parsePdfFile,
  parsePdfBuffer,
  toMetadata,
  cleanExtractedText,
  cleanPdfText,
  cleanCodeText,
  reflowParagraphs
};