const https = require('https');
const http = require('http');
const querystring = require('querystring');
const { URL } = require('url');

let browserSession;
let browserWindow;
let browserQueue = Promise.resolve();

/**
 * Global Promise Timeout Wrapper.
 * Guarantees that no tool operation can ever hang longer than timeoutMs.
 * If a request hangs, it resolves gracefully with fallback data.
 */
function withTimeout(promise, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallbackValue);
    }, timeoutMs);

    promise
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch(() => { clearTimeout(timer); resolve(fallbackValue); });
  });
}

/**
 * Stage 1: Query Optimization.
 * Sanitizes and optimizes search query strings for search engines.
 */
function optimizeQuery(query) {
  if (!query || typeof query !== 'string') return '';
  let cleaned = query.trim();

  // Strip leading filler phrases that reduce search precision
  cleaned = cleaned.replace(
    /^(please\s+)?(tell me|show me|find|give me|search (for|up)|look up|what (are|is|were|was)|list|get|fetch)\s+(the\s+|me\s+)?/i,
    ''
  );
  // Remove quote characters that can confuse search engines
  cleaned = cleaned.replace(/["\u201C\u201D]/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, (match) => {
      const num = parseInt(match.replace(/\D/g, ''), 10);
      return !isNaN(num) ? String.fromCharCode(num) : match;
    });
}

/**
 * Clean HTML markup and extract plain text with basic structural formatting.
 */
function cleanText(htmlSnippet) {
  if (!htmlSnippet) return '';
  const text = htmlSnippet.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
}

function needsBrowserFallback(text, html) {
  const source = `${text || ''} ${html || ''}`.toLowerCase();
  return !text || text.length < 180 || /enable javascript|javascript is required|accept cookies|cookie consent|verify you are human|checking your browser|access denied|one more step/.test(source);
}

/**
 * Uses Electron's Chromium engine for pages that require JavaScript or cookies.
 * The persistent partition keeps accepted consent cookies for later requests.
 */
async function runBrowserPage(pageUrl, script) {
  const task = browserQueue.then(async () => {
    try {
      const { BrowserWindow, session } = require('electron');
      browserSession = browserSession || session.fromPartition('persist:web-tools');
      browserWindow = browserWindow || new BrowserWindow({
        show: false,
        webPreferences: {
          session: browserSession,
          contextIsolation: true,
          javascript: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      await browserWindow.loadURL(pageUrl, {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
      });

      return await browserWindow.webContents.executeJavaScript(script);
    } catch {
      return null;
    }
  });
  browserQueue = task.catch(() => undefined);
  return task;
}

async function fetchRenderedPageContent(pageUrl, maxChars = 4000) {
  const pageData = await runBrowserPage(pageUrl, `(async () => {
    const acceptTerms = /accept|agree|allow|consent|got it|continue/i;
    const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
    const consentButton = buttons.find((button) => acceptTerms.test(button.innerText || button.value || ''));
    if (consentButton) consentButton.click();
    await new Promise((resolve) => setTimeout(resolve, 1400));
    const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,article,blockquote,td,th')];
    const text = nodes
      .map((node) => node.innerText.trim())
      .filter((value, index, values) => value.length >= 5 && values.indexOf(value) === index)
      .join('\\n\\n');
    return { title: document.title || 'Web Page', text };
  })()`);

  if (!pageData) return { url: pageUrl, title: 'Browser fetch failed', text: '' };
  return {
    url: pageUrl,
    title: pageData.title || 'Web Page',
    text: String(pageData.text || '').slice(0, maxChars)
  };
}

async function performGoogleSearch(query) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(optimizeQuery(query))}&num=8&hl=en`;
  const results = await runBrowserPage(searchUrl, `(async () => {
    const acceptTerms = /accept all|i agree|agree/i;
    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    const consentButton = buttons.find((button) => acceptTerms.test(button.innerText || ''));
    if (consentButton) consentButton.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const output = [];
    const seen = new Set();
    for (const heading of document.querySelectorAll('h3')) {
      const link = heading.closest('a');
      const url = link && link.href;
      if (!url || !/^https?:/i.test(url) || /google\./i.test(new URL(url).hostname) || seen.has(url)) continue;
      seen.add(url);
      const container = heading.closest('div[data-snhf]') || heading.parentElement?.parentElement;
      const lines = (container?.innerText || '').split('\\n').map((line) => line.trim()).filter(Boolean);
      output.push({ title: heading.innerText.trim(), url, snippet: lines.slice(1, 4).join(' ') });
      if (output.length >= 8) break;
    }
    return output;
  })()`);
  return Array.isArray(results) ? results : [];
}

/**
 * Checks if the system is currently connected to the internet.
 */
function isOnline() {
  return new Promise((resolve) => {
    const req = https.get('https://html.duckduckgo.com/', { timeout: 3500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Fast & Powerful DuckDuckGo Search Scraper with POST/GET fallback.
 * Extracts up to 8 search items with titles, target URLs, and snippets.
 */
function performDuckDuckGoSearch(query) {
  return new Promise((resolve) => {
    const optQuery = optimizeQuery(query);
    if (!optQuery) return resolve([]);

    const parseBody = (data) => {
      const results = [];
      const blocks = data.split(/class="result\b[^>]*"/gi).slice(1);

      for (const block of blocks) {
        if (results.length >= 8) break;

        let targetUrl = '';
        const hrefMatch = /class="result__a"[^>]*href="([^"]+)"/i.exec(block);
        if (hrefMatch) {
          let rawHref = hrefMatch[1];
          if (rawHref.includes('uddg=')) {
            try {
              const parsed = new URL('https://duckduckgo.com' + rawHref);
              targetUrl = decodeURIComponent(parsed.searchParams.get('uddg') || '');
            } catch {}
          } else if (rawHref.startsWith('http')) {
            targetUrl = rawHref;
          }
        }

        let snippet = '';
        const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/[^>]+>/i.exec(block);
        if (snippetMatch) {
          snippet = cleanText(snippetMatch[1]);
        }

        let title = '';
        const titleMatch = /class="result__a"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        if (titleMatch) {
          title = cleanText(titleMatch[1]);
        }

        if (title || snippet) {
          results.push({
            title: title || 'Web Page',
            url: targetUrl || 'https://duckduckgo.com',
            snippet: snippet || title
          });
        }
      }
      return results;
    };

    const postData = querystring.stringify({ q: optQuery, b: '' });
    const requestOptions = {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Origin': 'https://html.duckduckgo.com',
        'Referer': 'https://html.duckduckgo.com/'
      },
      timeout: 4500
    };

    const parseResponse = (res, retry) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 300000) res.destroy();
      });

      res.on('end', () => {
        const parsed = parseBody(data);
        if (parsed.length === 0 && retry) {
          const fallback = https.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(optQuery)}`, {
            headers: requestOptions.headers,
            timeout: 4500
          }, (fallbackRes) => parseResponse(fallbackRes, false));
          fallback.on('error', () => resolve([]));
          fallback.on('timeout', () => { fallback.destroy(); resolve([]); });
        } else {
          resolve(parsed);
        }
      });
    };

    const req = https.request('https://html.duckduckgo.com/html/', requestOptions, (res) => {
      parseResponse(res, true);
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.write(postData);
    req.end();
  });
}

/**
 * Stage 2: Deep Fetch & DOM Cleaning.
 * Fetches HTML with 5s timeout, redirects support, DOM stripping, and Markdown conversion.
 */
function fetchWebPageContent(pageUrl, maxChars = 4000, redirectCount = 0) {
  return new Promise((resolve) => {
    if (!pageUrl || !pageUrl.startsWith('http')) {
      return resolve({ url: pageUrl, title: 'Invalid URL', text: '' });
    }

    if (redirectCount > 3) {
      return resolve({ url: pageUrl, title: 'Too Many Redirects', text: '' });
    }

    let client = pageUrl.startsWith('https') ? https : http;
    const req = client.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      },
      timeout: 5000
    }, (res) => {
      // Handle HTTP Redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, pageUrl).toString();
          req.destroy();
          return resolve(fetchWebPageContent(redirectUrl, maxChars, redirectCount + 1));
        } catch {
          // Fallback if redirect URL fails to parse
        }
      }

      let html = '';
      res.on('data', (chunk) => {
        html += chunk;
        if (html.length > 300000) req.destroy(); // Cap at 300KB HTML
      });

      res.on('end', () => {
        // 1. DOM Cleaning: Strip scripts, styles, navs, footers, headers, sidebars, forms, svgs, comments, cookie/consent banners & popups
        let cleanedHtml = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ')
          .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
          .replace(/<form[\s\S]*?<\/form>/gi, ' ')
          .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
          .replace(/<dialog[\s\S]*?<\/dialog>/gi, ' ')
          .replace(/<(div|section|aside)[^>]*(?:id|class)="[^"]*(?:cookie|consent|banner|modal|popup|overlay|gdpr|notice|ad-wrapper)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<!--[\s\S]*?-->/g, ' ');

        let title = '';
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleanedHtml);
        if (titleMatch) title = cleanText(titleMatch[1]);

        const contentPieces = [];

        // 2. Convert tables to markdown style rows (| col1 | col2 |)
        cleanedHtml = cleanedHtml.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (match, trContent) => {
          const cells = [];
          const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
          let cellMatch;
          while ((cellMatch = cellRegex.exec(trContent)) !== null) {
            const cellText = cleanText(cellMatch[2]);
            if (cellText) cells.push(cellText);
          }
          if (cells.length > 0) {
            const rowText = `| ${cells.join(' | ')} |`;
            contentPieces.push(rowText);
          }
          return ' ';
        });

        // 3. Convert Code blocks (<pre><code>...</code></pre>) to Markdown code blocks
        cleanedHtml = cleanedHtml.replace(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi, (match, codeText) => {
          const codeCleaned = decodeHtmlEntities(codeText).trim();
          if (codeCleaned) contentPieces.push(`\`\`\`\n${codeCleaned}\n\`\`\``);
          return ' ';
        });

        // 4. Extract Headings, List items, Paragraphs, Articles, Blockquotes, Divs into Markdown
        const contentRegex = /<(h[1-6]|li|p|article|blockquote|section|div)[^>]*>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = contentRegex.exec(cleanedHtml)) !== null) {
          const tag = match[1].toLowerCase();
          const rawInner = match[2];
          const text = cleanText(rawInner);

          if (!text || text.length < 5) continue;

          if (tag === 'h1') {
            contentPieces.push(`\n# ${text}`);
          } else if (tag === 'h2') {
            contentPieces.push(`\n## ${text}`);
          } else if (tag.startsWith('h')) {
            contentPieces.push(`\n### ${text}`);
          } else if (tag === 'li') {
            contentPieces.push(`- ${text}`);
          } else if (tag === 'blockquote') {
            contentPieces.push(`> ${text}`);
          } else if (text.length >= 25) {
            contentPieces.push(text);
          }
        }

        let fullText = '';
        if (contentPieces.length > 0) {
          // Remove duplicate adjacent entries
          const uniquePieces = [];
          for (const piece of contentPieces) {
            if (uniquePieces.length === 0 || uniquePieces[uniquePieces.length - 1] !== piece) {
              uniquePieces.push(piece);
            }
          }
          fullText = uniquePieces.join('\n\n');
        } else {
          fullText = cleanText(cleanedHtml);
        }

        // Per-page truncation limit
        if (fullText.length > maxChars) fullText = fullText.slice(0, maxChars) + '…';

        const result = { url: pageUrl, title: title || 'Web Page', text: fullText || '' };
        if (!needsBrowserFallback(result.text, html)) return resolve(result);

        fetchRenderedPageContent(pageUrl, maxChars).then((rendered) => {
          resolve(rendered.text.length > result.text.length ? rendered : result);
        });
      });
    });

    req.on('error', () => resolve({ url: pageUrl, title: 'Error', text: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ url: pageUrl, title: 'Timeout', text: '' }); });
  });
}

/**
 * Removes paragraphs that appear (near-)verbatim across multiple page results.
 * Uses the first 80 characters of each paragraph as a fingerprint.
 * This prevents the model from seeing the same boilerplate text repeated from
 * multiple sources, saving token space for unique content.
 */
function deduplicateContent(pages) {
  const seenFingerprints = new Set();
  return pages.map((page) => {
    if (!page.text) return page;
    const paragraphs = page.text.split('\n\n');
    const unique = paragraphs.filter((p) => {
      const fp = p.trim().toLowerCase().slice(0, 80);
      if (fp.length < 25 || seenFingerprints.has(fp)) return false;
      seenFingerprints.add(fp);
      return true;
    });
    return { ...page, text: unique.join('\n\n') };
  });
}

/**
 * Stage 3: Clean, Deduplicate, Truncate & Full Pipeline Handler.
 * Runs: Query Optimization → Fetch & Scrape (6 pages, 6k chars each)
 *   → Deduplication → Structured Context Assembly (max 14,000 chars / ~3,500 tokens).
 */
async function searchWebTool(rawQuery) {
  const query = optimizeQuery(rawQuery);
  if (!query) {
    return {
      success: false,
      status: 'invalid_query',
      message: 'Empty or invalid search query provided.'
    };
  }

  const searchOperation = async () => {
    let items = await performGoogleSearch(query);
    if (items.length === 0) items = await performDuckDuckGoSearch(query);
    if (items.length === 0) {
      return {
        success: true,
        status: 'no_results',
        query,
        message: 'No web search results found for this query.'
      };
    }

    // Read top pages one by one so the web tree preserves source order and
    // the browser session can retain consent cookies between pages.
    const topItems = items.slice(0, 6);
    const pageResults = [];
    for (const item of topItems) {
      if (!item.url || !item.url.startsWith('http')) {
        pageResults.push({ url: item.url, title: item.title, text: item.snippet });
        continue;
      }
      const rendered = await withTimeout(fetchRenderedPageContent(item.url, 6000), 9000, null);
      const fallback = rendered && rendered.text.length > 0
        ? rendered
        : await withTimeout(fetchWebPageContent(item.url, 6000), 6000, { url: item.url, title: item.title, text: item.snippet });
      pageResults.push(fallback);
    }

    // Build result set, skipping pages with insufficient content (< 150 chars) to save budget
    let combinedResults = topItems.map((item, idx) => {
      const page = pageResults[idx];
      const deepContent = (page && page.text && page.text.length > 150) ? page.text : item.snippet;
      return {
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        extractedContent: deepContent
      };
    }).filter((r) => r.extractedContent && r.extractedContent.length > 0);

    // Deduplicate repeated paragraphs across pages — removes shared boilerplate
    const pagesForDedup = combinedResults.map((r) => ({ text: r.extractedContent }));
    const deduped = deduplicateContent(pagesForDedup);
    combinedResults = combinedResults.map((r, i) => ({ ...r, extractedContent: deduped[i].text }));

    // Assemble structured context with per-source quality labels
    let aggregatedContext = '';
    combinedResults.slice(0, 6).forEach((res, i) => {
      if (!res.extractedContent) return;
      const len = res.extractedContent.length;
      const quality = len > 1500 ? 'HIGH' : len > 400 ? 'MED' : 'LOW';
      aggregatedContext +=
        `=== Source ${i + 1} (${quality} — ${len} chars) ===\n` +
        `Title: ${res.title}\nURL: ${res.url}\nContent:\n${res.extractedContent}\n\n`;
    });

    // Memory safety: cap total context at 14,000 characters (~3,500 tokens)
    if (aggregatedContext.length > 14000) {
      aggregatedContext = aggregatedContext.slice(0, 14000) + '\n[Content truncated for length...]';
    }

    return {
      success: true,
      status: 'online',
      query,
      resultsCount: combinedResults.length,
      results: combinedResults,
      scrapedContext: aggregatedContext
    };
  };

  // Browser-backed sequential extraction needs a larger budget than raw HTTP.
  return await withTimeout(searchOperation(), 60000, {
    success: true,
    status: 'timeout_fallback',
    query,
    message: 'Web search timed out. Answering with available knowledge.'
  });
}

/**
 * Web Page Content Extractor Tool with hard 5.0s timeout.
 */
async function fetchPageTool(pageUrl) {
  const rawUrl = String(pageUrl || '');
  const urlMatch = rawUrl.match(/https?:\/\/[^\s\]}>")]+/i);
  const normalizedUrl = urlMatch ? urlMatch[0].replace(/[),.;]+$/, '') : rawUrl;

  return await withTimeout(
    (async () => {
      const rendered = await fetchRenderedPageContent(normalizedUrl, 10000);
      const pageData = rendered.text
        ? rendered
        : await fetchWebPageContent(normalizedUrl, 8000);
      let content = pageData.text || 'Could not extract page text.';
      if (content.length > 10000) {
        content = content.slice(0, 10000) + '\n[Content truncated for length...]';
      }
      return {
        success: true,
        status: 'online',
        url: normalizedUrl,
        title: pageData.title,
        content
      };
    })(),
    15000,
    { success: false, status: 'timeout', message: `Fetching ${normalizedUrl} timed out.` }
  );
}

module.exports = {
  isOnline,
  optimizeQuery,
  searchWebTool,
  fetchPageTool,
  fetchWebPageContent
};
