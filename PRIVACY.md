# Athar — Privacy Policy

_Effective 2 October 2026 · Applies to Athar 1.0.0-beta.1 and later_

Athar is built to keep your conversations private: **it runs on your own computer, has no account, and sends nothing to the author.** There is no analytics, no tracking, no advertising and no crash reporting.

## What stays on your computer

- The chat histories you import from ChatGPT, Claude and Gemini
- Your chats in Athar, your memory profile, and the search index built from them
- Files and images you attach to a chat
- Your settings, and the project folder you choose (Athar only reads it and never changes it)
- Your Gemini API key, if you add one — stored encrypted with your operating system's protection

All of this is stored in Athar's data folder (on Windows, `%APPDATA%\Athar`). By default, your questions are answered by an AI model running locally through Ollama, so your conversations are never sent to an AI company. If you choose a **Gemini model** with your own API key, see below: that is the only case in which your conversations leave your computer.

## What Athar sends over the internet, and why

**Nothing goes online to answer you unless you turn on Search.** The **Search** button in the message box is off by default. While it's off, Athar doesn't search the web or open links: your questions are answered from your chats, your files and the AI model's own knowledge, and an answer about something that changes over time (prices, news, the latest version…) says it comes from the model's training data and may be out of date.

While Search is on, the model may search the web and open links when a question needs it. Only larger models can: local models of about 14B parameters or more, and Gemini models; with a smaller local model, Search stays off.

Each request below goes directly from your computer to the service named; the author never receives it.

| When | Sent to | What is sent |
|---|---|---|
| You add a Gemini API key in Settings → Cloud models | Google (generativelanguage.googleapis.com) | The key, to check it and list the models it can use |
| You chat with a Gemini model | Google (the Gemini API) | Your message, the conversation so far, the excerpts of your past conversations that Athar found relevant to it, excerpts of attached files, and images you attach |
| Search is on, with a local model or Gemini 2.x, and the model searches | DuckDuckGo (duckduckgo.com) | Search words for what the question needs — never your own chats or files |
| Search is on, with a Gemini 3 or newer model, and the model searches | Google Search, through the Gemini API | Search words chosen by Gemini (Google handles them under the Gemini API terms) |
| Search is on: reading search results, or a link you paste into a message | The website of that page | A normal request for the page, as a web browser would make; a page that came from neither your message nor a search result is opened only if you allow it |
| Search is on, and a Wikipedia page is used | Wikipedia (wikipedia.org) | The name of the article |
| Search is on: checking whether you are online before searching | Microsoft (msftconnecttest.com), Google (gstatic.com), Cloudflare (1.1.1.1) | A tiny standard connectivity check with no personal data |
| You choose to install Ollama | ollama.com and GitHub | A download of the official Ollama installer |
| You download an AI model | The Ollama model library, through Ollama | A download request for that model |

These services receive the information any website receives when you visit it, such as your IP address, and handle it under their own privacy policies. Apart from the Gemini rows above, Athar does not send your imported history, your chats, your memory profile or your files to any of them; web searches carry only search words.

**Gemini.** What you send to a Gemini model is handled by Google under the [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Google's privacy policy](https://policies.google.com/privacy). On Google's **free** plan, Google may use what you send to improve its products, and people at Google may review it — don't use a Gemini model for anything you wouldn't want Google to see.

Athar sends only the excerpts relevant to each message, never your whole history; searching your memory always happens on your computer. If a chosen model has reached its limit, another Gemini model may answer instead. To stop, choose a local model or remove the key in Settings.

**Claude Desktop and Claude Code (optional).** If you connect them in Settings → Use your memory in Claude, Claude can search your Athar memory while you chat with it. Athar itself sends nothing over the internet for this: the search runs on your computer, and Athar gives the results only to the Claude app that asked. Claude then sends the excerpts and conversations it looked up to Anthropic as part of your Claude chat, handled under [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) and your Claude plan's terms. Connecting adds an "athar" entry to Claude Desktop's settings file and changes nothing else in it. To stop, choose Disconnect in Settings (for Claude Code, run `claude mcp remove athar`).

## Your control

- **Delete a chat**: it is removed from the chat list and from Athar's memory.
- **Remove imported history**: in the Memory view, remove a source (ChatGPT, Claude or Gemini) to delete all its conversations from Athar.
- **Edit or turn off the memory profile** in the Memory view.
- **Delete everything**: uninstall Athar and delete its data folder (`%APPDATA%\Athar` on Windows).

## Children

Athar is not directed at children under 13 and does not knowingly collect any information from anyone.

## Changes

If a future version changes what Athar sends over the internet, this policy will be updated and the new version included with that release.

## Contact

Questions about privacy: mekorobert2010@gmail.com
