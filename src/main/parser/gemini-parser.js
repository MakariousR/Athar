// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Gemini history from Google Takeout ("My Activity" → "Gemini Apps", JSON format).
 *
 * Takeout stores Gemini as an activity log, not as conversations: each item
 * is one prompt ("title": "Prompted …") with the response as HTML in
 * "safeHtmlItem", plus a timestamp. There are no conversation IDs, so items
 * are grouped into conversations by time: consecutive prompts less than
 * GAP_MINUTES apart belong together.
 *
 * Parsed defensively (Takeout's exact fields vary by account, date and
 * language): anything that doesn't look like a Gemini prompt is skipped.
 */
const crypto = require('crypto');

const GAP_MINUTES = 30;
// "Prompted" as Takeout writes it in a few UI languages. Unknown prefixes are left in the text.
const PROMPT_PREFIX_RE = /^(Prompted|Asked|Sent|Requested|Stellte die Frage|A demandé|Preguntaste|Perguntou|تم إرسال الطلب|طلبت|سألت)\s*[:：]?\s*/i;

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True if this parsed JSON looks like a Takeout My Activity export containing Gemini/Bard items. */
function looksLikeGeminiActivity(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.slice(0, 50).some((item) => item && typeof item === 'object' && item.time && isGeminiItem(item));
}

function isGeminiItem(item) {
  const header = String(item.header || '');
  const products = Array.isArray(item.products) ? item.products.join(' ') : '';
  return /gemini|bard/i.test(`${header} ${products}`);
}

function parseItem(item) {
  if (!isGeminiItem(item) || !item.time) return null;
  const time = Date.parse(item.time);
  if (!Number.isFinite(time)) return null;
  const title = String(item.title || '').trim();
  const prompt = title.replace(PROMPT_PREFIX_RE, '').trim();
  const response = Array.isArray(item.safeHtmlItem)
    ? item.safeHtmlItem.map((h) => htmlToPlainText(h && h.html)).filter(Boolean).join('\n\n')
    : '';
  // Items like "Used Gemini Apps" or "Gave feedback" have neither a real prompt nor a response.
  if (!prompt || (!response && !PROMPT_PREFIX_RE.test(title))) return null;
  return { time: time / 1000, prompt, response };
}

function parseGeminiData(data) {
  const items = (Array.isArray(data) ? data : [])
    .map(parseItem)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);

  const threads = [];
  let current = null;
  for (const item of items) {
    if (!current || item.time - current.lastTime > GAP_MINUTES * 60) {
      current = { items: [], lastTime: item.time };
      threads.push(current);
    }
    current.items.push(item);
    current.lastTime = item.time;
  }

  return threads.map(({ items: group }) => {
    const first = group[0];
    const messages = [];
    for (const it of group) {
      messages.push({ role: 'user', text: it.prompt, createTime: it.time });
      if (it.response) messages.push({ role: 'assistant', text: it.response, createTime: it.time });
    }
    const title = first.prompt.replace(/\s+/g, ' ').slice(0, 60) + (first.prompt.length > 60 ? '…' : '');
    return {
      id: `gemini_${crypto.createHash('sha1').update(`${first.time}|${first.prompt}`).digest('hex').slice(0, 20)}`,
      title,
      source: 'gemini',
      createTime: first.time,
      messages,
      fullText: messages.map((m) => m.text).join('\n')
    };
  });
}

/** Takeout's default "My Activity" format is HTML; explain how to get JSON instead of guessing at it. */
function isGeminiActivityHtml(raw) {
  return /<html/i.test(raw.slice(0, 2000)) && /Gemini Apps|Bard/i.test(raw.slice(0, 200000));
}

module.exports = { parseGeminiData, looksLikeGeminiActivity, isGeminiActivityHtml, htmlToPlainText };
