# Athar (أثر)

_Athar_ is Arabic for "trace": what your conversations leave behind.

One private memory for all your AI chats. Import your ChatGPT, Claude and Gemini
history; a local model (via [Ollama](https://ollama.com)) remembers it, cites it,
and helps you search it — nothing leaves your computer except the web searches
you ask for.

## What it does

- **Remembers across assistants.** Past conversations from ChatGPT, Claude,
  Gemini and this app are split into passages and searched by meaning and by
  keywords for every message. Relevant memories are given to the model, which
  cites them like `[M1]`; unrelated questions get no memories at all.
- **Understands how you ask.** "What did I ask Claude about salary last year?"
  searches only Claude, only last year, for "salary". Works in English and
  Arabic ("الشهر الماضي", "كلود").
- **Search & browse your history** in one place, filter by source, open any
  conversation at the matching passage, or start a new chat about it.
- **Portable memory profile.** A short summary of you (work, projects, tools,
  how you like answers) learned from your own messages. Review it, use it here,
  or copy it into ChatGPT's custom instructions or another assistant.
- **Web research** (DuckDuckGo, no API key) with trusted sources ranked first
  and a per-source figures table, so numbers come with sources and dates.
- **Attach files** (PDFs, text, code) and let the model read them on demand.
- **Project folder (read-only)**: let the model read a folder and its git
  history to answer questions about it. It can never change your files.

## Requirements

- [Ollama](https://ollama.com). On Windows, if it is missing the app offers to install
  it (it downloads the official installer, checks that it is signed by Ollama Inc.,
  and installs it without an admin prompt). If it is installed but not running,
  the app starts it.
- A chat model — default `qwen2.5-coder:7b` (any installed chat model works;
  pick one in Settings) — and the `bge-m3` embedding model. The app offers to
  download both on first start.
- 16 GB RAM recommended for a 7B model with a 16K context.
  `OLLAMA_NUM_CTX` and `OLLAMA_KEEP_ALIVE` environment variables override the defaults.

## Setup

```bash
npm install
npm start
```

## Importing your history

| Source  | Where to get it | File to import |
|---------|-----------------|----------------|
| ChatGPT | Settings → Data controls → Export data | `conversations.json` |
| Claude  | Settings → Privacy → Export data | `conversations.json` |
| Gemini  | Google Takeout → My Activity → Gemini Apps, **format: JSON** | `MyActivity.json` |

Drop the file on "Import chat history". Re-importing a newer export only adds
or updates what changed. Indexing runs in the background (newest conversations
first); you can chat meanwhile. Gemini support is based on Takeout's documented
activity format and hasn't been verified against every account/language.

## Tests

```bash
npm test            # offline (no Ollama or internet needed)
npm run test:live   # also real-model memory relevance + live web checks
```

## Packaging

```bash
npm run dist
```

Uses `electron-builder` (see `build` in `package.json`) to produce a Windows
NSIS installer, macOS DMG or Linux AppImage. It first regenerates
`THIRD-PARTY-NOTICES.txt` (`npm run notices`) from the shipped dependencies.

The installer shows `LICENSE.txt` (the end-user license agreement) and must
be accepted to install. `LICENSE.txt`, `PRIVACY.md` and
`THIRD-PARTY-NOTICES.txt` ship with the app and open from Settings → footer
links. The icon is drawn in `assets/icon.svg`; `icon.ico` and `icon.png` are
exported from it. Update the version in `package.json` for each release.

## Project structure

```
src/main/                  Electron main process (the backend)
  index.js                 window + navigation lock
  ipc-handlers.js          IPC routes (only the app's own page may call them)
  memory/                  chunking, BM25 + vector search, query hints, profile
  ollama/                  Ollama client, agent loop (read-only tools)
  parser/                  ChatGPT / Claude / Gemini exports, PDF & text documents
  store/chat-store.js      in-app chats (sessions.json + per-file images/resources)
  tools/                   web research, project folder, git (read-only)
src/preload/preload.js     the bridge exposed to the UI
src/renderer/              UI (vanilla HTML/CSS/JS)
tests/                     test suites (npm test)
```

## Known limitations

- A 7B local model sometimes mis-states or over-generalises. Answers cite the
  memories they used so you can check, and the memory profile is meant to be
  reviewed before you use or share it.
- DuckDuckGo may temporarily rate-limit heavy searching; the app tells you when.
- The interface itself is English-only; Arabic text is fully supported in
  chats, search and the profile.
