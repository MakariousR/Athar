const https = require('https');
const http = require('http');
const { URL } = require('url');

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
 * Robust DuckDuckGo HTML Search Scraper.
 * Correctly parses result URLs, titles, and snippet text.
 */
function performDuckDuckGoSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const results = [];
        // Match DuckDuckGo result snippet blocks
        const blocks = data.split(/class="result\s+/g).slice(1);

        for (const block of blocks) {
          if (results.length >= 4) break;

          // Extract href link
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

          // Extract snippet text
          let snippet = '';
          const snippetMatch = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
          if (snippetMatch) {
            snippet = snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }

          // Extract title
          let title = '';
          const titleMatch = /class="result__title"[^>]*>([\s\S]*?)<\/a>/i.exec(block) || /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
          if (titleMatch) {
            title = titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }

          if (targetUrl && targetUrl.startsWith('http') && (snippet || title)) {
            results.push({ title: title || 'Web Page', url: targetUrl, snippet: snippet || title });
          }
        }

        resolve(results);
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Search request timed out')); });
  });
}

/**
 * Fast HTML Scraper & Text Compressor:
 * Fetches page HTML, strips HTML tags/scripts, and extracts main paragraph text.
 * Truncates text to maxChars (default 1000) for fast response time.
 */
function fetchWebPageContent(pageUrl, maxChars = 1000) {
  return new Promise((resolve) => {
    let client = pageUrl.startsWith('https') ? https : http;
    const req = client.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 3500
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, pageUrl).href;
          return fetchWebPageContent(redirectUrl, maxChars).then(resolve);
        } catch {}
      }

      let html = '';
      res.on('data', (chunk) => {
        html += chunk;
        if (html.length > 80000) req.destroy();
      });

      res.on('end', () => {
        let cleanedHtml = html
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ')
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

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

        resolve({ url: pageUrl, title: title || 'Web Page', text: fullText || 'No readable text content extracted.' });
      });
    });

    req.on('error', () => resolve({ url: pageUrl, title: 'Error', text: 'Could not read page content.' }));
    req.on('timeout', () => { req.destroy(); resolve({ url: pageUrl, title: 'Timeout', text: 'Page request timed out.' }); });
  });
}

/**
 * Fast Web Search Tool — runs search + parallel page fetching for top 2 links.
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

  try {
    const items = await performDuckDuckGoSearch(query);
    if (items.length === 0) {
      return {
        success: true,
        status: 'no_results',
        query,
        message: 'No web search results found for this query.'
      };
    }

    // Parallel fetch of top 2 web pages
    const fetchPromises = items.slice(0, 2).map((item) =>
      item.url && item.url.startsWith('http')
        ? fetchWebPageContent(item.url, 1000)
        : Promise.resolve({ url: item.url, title: item.title, text: item.snippet })
    );

    const pageResults = await Promise.all(fetchPromises);

    const deepPageContents = pageResults.map((p, idx) => ({
      title: p.title || items[idx].title,
      url: p.url || items[idx].url,
      snippet: items[idx].snippet,
      fullArticleText: p.text
    }));

    return {
      success: true,
      status: 'online',
      query,
      results: deepPageContents
    };
  } catch (err) {
    return {
      success: false,
      status: 'error',
      message: `Web search error: ${err.message}`
    };
  }
}

/**
 * Tool 2: Web Page Content Extractor Tool.
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

  try {
    const pageData = await fetchWebPageContent(pageUrl, 1200);
    return {
      success: true,
      status: 'online',
      url: pageUrl,
      title: pageData.title,
      content: pageData.text
    };
  } catch (err) {
    return {
      success: false,
      status: 'error',
      message: `Failed to fetch page ${pageUrl}: ${err.message}`
    };
  }
}

module.exports = { isOnline, searchWebTool, fetchPageTool, fetchWebPageContent };
