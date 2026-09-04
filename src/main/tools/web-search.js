const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Global Promise Timeout Wrapper.
 * Guarantees that no tool operation can ever hang longer than timeoutMs.
 * If a request hangs, it rejects/resolves gracefully with fallback data.
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

/**
 * Checks if the system is currently connected to the internet.
 */
function isOnline() {
  return new Promise((resolve) => {
    const req = http.get('http://www.msftconnecttest.com/connecttest.txt', { timeout: 2500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Fast & Powerful DuckDuckGo Search Scraper with 4.5-second network limit.
 * Extracts up to 8 search items with titles, target URLs, and snippets.
 */
function performDuckDuckGoSearch(query) {
  return new Promise((resolve) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      },
      timeout: 4500
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 300000) req.destroy(); // Cap response size at ~300KB
      });

      res.on('end', () => {
        const results = [];
        const blocks = data.split(/class="result\s+/g).slice(1);

        for (const block of blocks) {
          if (results.length >= 8) break;

          let targetUrl = '';
          const hrefMatch = /href="([^"]+)"/i.exec(block);
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
          const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
          if (snippetMatch) {
            snippet = cleanText(snippetMatch[1]);
          }

          let title = '';
          const titleMatch = /class="result__title"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
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

        resolve(results);
      });
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Advanced Web Page Content Extractor with deep structure preservation (Tables, Lists, Headings, Paragraphs).
 */
function fetchWebPageContent(pageUrl, maxChars = 4000) {
  return new Promise((resolve) => {
    if (!pageUrl || !pageUrl.startsWith('http')) {
      return resolve({ url: pageUrl, title: 'Invalid URL', text: '' });
    }

    let client = pageUrl.startsWith('https') ? https : http;
    const req = client.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
      },
      timeout: 4000
    }, (res) => {
      let html = '';
      res.on('data', (chunk) => {
        html += chunk;
        if (html.length > 250000) req.destroy(); // Cap at 250KB HTML
      });

      res.on('end', () => {
        // Strip non-content blocks aggressively
        let cleanedHtml = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ')
          .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
          .replace(/<form[\s\S]*?<\/form>/gi, ' ')
          .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
          .replace(/<!--[\s\S]*?-->/g, ' ');

        let title = '';
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleanedHtml);
        if (titleMatch) title = cleanText(titleMatch[1]);

        const contentPieces = [];

        // 1. Convert tables to markdown style rows (| col1 | col2 |)
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

        // 2. Extract Headings, List items, Paragraphs, Articles, Blockquotes, Divs
        const contentRegex = /<(h[1-6]|li|p|article|blockquote|section|div)[^>]*>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = contentRegex.exec(cleanedHtml)) !== null) {
          const tag = match[1].toLowerCase();
          const rawInner = match[2];
          const text = cleanText(rawInner);

          if (!text || text.length < 5) continue;

          if (tag.startsWith('h')) {
            contentPieces.push(`\n### ${text}`);
          } else if (tag === 'li') {
            contentPieces.push(`- ${text}`);
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

        if (fullText.length > maxChars) fullText = fullText.slice(0, maxChars) + '…';

        resolve({ url: pageUrl, title: title || 'Web Page', text: fullText || '' });
      });
    });

    req.on('error', () => resolve({ url: pageUrl, title: 'Error', text: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ url: pageUrl, title: 'Timeout', text: '' }); });
  });
}

/**
 * Main High-Performance Non-Blocking Web Search Tool.
 * Deeply extracts context from search results & top web pages.
 */
async function searchWebTool(query) {
  const online = await isOnline();
  if (!online) {
    return {
      success: false,
      status: 'offline',
      message: 'Internet connection is currently disconnected. Web search unavailable.'
    };
  }

  const searchOperation = async () => {
    const items = await performDuckDuckGoSearch(query);
    if (items.length === 0) {
      return {
        success: true,
        status: 'no_results',
        query,
        message: 'No web search results found for this query.'
      };
    }

    // Parallel deep fetch of top 3 pages with 3.5s timeout per page
    const fetchPromises = items.slice(0, 3).map((item) =>
      item.url && item.url.startsWith('http')
        ? withTimeout(fetchWebPageContent(item.url, 3500), 3500, { url: item.url, title: item.title, text: item.snippet })
        : Promise.resolve({ url: item.url, title: item.title, text: item.snippet })
    );

    const pageResults = await Promise.all(fetchPromises);

    const combinedResults = items.map((item, idx) => {
      const page = pageResults[idx];
      const deepContent = (page && page.text && page.text.length > 80) ? page.text : item.snippet;
      return {
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        extractedContent: deepContent
      };
    });

    return {
      success: true,
      status: 'online',
      query,
      resultsCount: combinedResults.length,
      results: combinedResults
    };
  };

  // Hard global timeout: 7.5 seconds total for full search + deep page content extraction
  return await withTimeout(searchOperation(), 7500, {
    success: true,
    status: 'timeout_fallback',
    query,
    message: 'Web search timed out. Answering with available knowledge.'
  });
}

/**
 * Web Page Content Extractor Tool with hard 4.5s timeout.
 */
async function fetchPageTool(pageUrl) {
  const online = await isOnline();
  if (!online) {
    return {
      success: false,
      status: 'offline',
      message: 'Internet connection is currently disconnected.'
    };
  }

  return await withTimeout(
    fetchWebPageContent(pageUrl, 5000).then((pageData) => ({
      success: true,
      status: 'online',
      url: pageUrl,
      title: pageData.title,
      content: pageData.text || 'Could not extract page text.'
    })),
    4500,
    { success: false, status: 'timeout', message: `Fetching ${pageUrl} timed out.` }
  );
}

module.exports = { isOnline, searchWebTool, fetchPageTool, fetchWebPageContent };

