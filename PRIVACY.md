# Athar — Privacy Policy

_Effective 27 September 2026 · Applies to Athar 1.0.0-beta.1 and later_

Athar is built to keep your conversations private: **it runs on your own computer, has no account, and sends nothing to the author.** There is no analytics, no tracking, no advertising and no crash reporting.

## What stays on your computer

- The chat histories you import from ChatGPT, Claude and Gemini
- Your chats in Athar, your memory profile, and the search index built from them
- Files and images you attach to a chat
- Your settings, and the project folder you choose (Athar only reads it and never changes it)

All of this is stored in Athar's data folder (on Windows, `%APPDATA%\Athar`). Your questions are answered by an AI model running locally through Ollama, so your conversations are never sent to an AI company.

## What Athar sends over the internet, and why

**Nothing you type goes online unless you turn on Search.** Athar uses the web only while you have **Search** turned on in the message box (it is off by default). With Search off, Athar does not search the web or open links, and says so when a question needs current information.

Each request goes directly from your computer to the service named; the author never receives it.

| When | Sent to | What is sent |
|---|---|---|
| Search is on, and a question needs information that your chats, files and the conversation don't have (for example a current price or recent news) | DuckDuckGo (duckduckgo.com) | Search words for just that information — never your own chats or files |
| Search is on: reading search results, or a link you paste into a message | The website of that page | A normal request for the page, as a web browser would make |
| Search is on, and a Wikipedia page is used | Wikipedia (wikipedia.org) | The name of the article |
| Search is on: checking whether you are online before searching | Microsoft (msftconnecttest.com), Google (gstatic.com), Cloudflare (1.1.1.1) | A tiny standard connectivity check with no personal data |
| You choose to install Ollama | ollama.com and GitHub | A download of the official Ollama installer |
| You download an AI model | The Ollama model library, through Ollama | A download request for that model |

These services receive the information any website receives when you visit it, such as your IP address, and handle it under their own privacy policies. Athar does not send your imported history, your chats, your memory profile or your files to any of them. The text of your question is used to build a search query only while you have Search turned on.

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
