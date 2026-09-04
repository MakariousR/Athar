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
 * Checks if the system is currently connected to the internet.
 */
function isOnline() {
  return new Promise((resolve) => {
    const req = http.get('http://www.msftconnecttest.com/connecttest.txt', { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Fast DuckDuckGo Search Scraper with strict 3-second network limit.
 */
function performDuckDuckGoSearch(query) {
  return new Promise((resolve) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 3000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 150000) req.destroy(); // Cap response size
      });

      res.on('end', () => {
        const results = [];
        const blocks = data.split(/class="result\s+/g).slice(1);

        for (const block of blocks) {
          if (results.length >= 4) break;

          const hrefMatch = /href="([^"]+)"/i.exec(block);
          let targetUrl = '';
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
            snippet = snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }

          let title = '';
          const titleMatch = /class="result__title"[^>]*>([\s\S]*?)<\/a>/i.exec(block) || /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
          if (titleMatch) {
            title = titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }

          if (snippet || title) {
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
 * Fast Web Page Scraper with 2.5s strict timeout.
 */
function fetchWebPageContent(pageUrl, maxChars = 800) {
  return new Promise((resolve) => {
    if (!pageUrl || !pageUrl.startsWith('http')) {
      return resolve({ url: pageUrl, title: 'Invalid URL', text: '' });
    }

    let client = pageUrl.startsWith('https') ? https : http;
    const req = client.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 2500
    }, (res) => {
      let html = '';
      res.on('data', (chunk) => {
        html += chunk;
        if (html.length > 60000) req.destroy();
      });

      res.on('end', () => {
        let cleanedHtml = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ');

        let title = '';
        const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleanedHtml);
        if (titleMatch) title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

        const contentPieces = [];
        const contentRegex = /<(p|h1|h2|h3|li|article)[^>]*>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = contentRegex.exec(cleanedHtml)) !== null) {
          const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 30) contentPieces.push(text);
        }

        let fullText = contentPieces.length > 0
          ? contentPieces.join('\n\n')
          : cleanedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        if (fullText.length > maxChars) fullText = fullText.slice(0, maxChars) + '…';

        resolve({ url: pageUrl, title: title || 'Web Page', text: fullText || '' });
      });
    });

    req.on('error', () => resolve({ url: pageUrl, title: 'Error', text: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ url: pageUrl, title: 'Timeout', text: '' }); });
  });
}

/**
 * Main Non-Blocking Web Search Tool.
 * Wrapped in hard 4-second global timeout so it CANNOT hang under any circumstances.
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

    // Try parallel fetch of top 2 pages with 2s timeout
    const fetchPromises = items.slice(0, 2).map((item) =>
      item.url && item.url.startsWith('http')
        ? withTimeout(fetchWebPageContent(item.url, 800), 2000, { url: item.url, title: item.title, text: item.snippet })
        : Promise.resolve({ url: item.url, title: item.title, text: item.snippet })
    );

    const pageResults = await Promise.all(fetchPromises);

    const combinedResults = items.map((item, idx) => {
      const page = pageResults[idx];
      return {
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        extractedContent: (page && page.text && page.text.length > 50) ? page.text : item.snippet
      };
    });

    return {
      success: true,
      status: 'online',
      query,
      results: combinedResults
    };
  };

  // Hard global timeout: if searchOperation takes more than 3.5 seconds total, fallback immediately!
  return await withTimeout(searchOperation(), 3500, {
    success: true,
    status: 'timeout_fallback',
    query,
    message: 'Web search timed out. Answering with available knowledge.'
  });
}

/**
 * Tool 2: Web Page Content Extractor Tool with hard 3s timeout.
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
    fetchWebPageContent(pageUrl, 1000).then((pageData) => ({
      success: true,
      status: 'online',
      url: pageUrl,
      title: pageData.title,
      content: pageData.text || 'Could not extract page text.'
    })),
    3000,
    { success: false, status: 'timeout', message: `Fetching ${pageUrl} timed out.` }
  );
}

module.exports = { isOnline, searchWebTool, fetchPageTool, fetchWebPageContent };
