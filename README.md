# Chat Memory (MVP)

Offline desktop app that lets a local AI model "remember" your old ChatGPT
conversation history, by retrieving the most relevant past threads via
keyword matching and feeding them into a locally-running Ollama model.

This is the **Node-only MVP** (Phase 1) described in the project plan:
Electron's main process acts as the entire backend. No Python, no
subprocess, no HTTP server of your own — everything talks over Electron's
built-in IPC. A future v2 can add an optional Python service for real
embeddings-based semantic search without touching this codebase's structure.

## Prerequisites

1. **Node.js** 18+ installed.
2. **[Ollama](https://ollama.com)** installed and running locally.
3. A ChatGPT data export (`conversations.json`), from
   Settings → Data Controls → Export Data in ChatGPT.

## Setup

```bash
npm install
npm start
```

On first launch, the app checks whether Ollama is running and whether the
`qwen3.5:0.8b` model (the smallest tier, chosen for fast MVP testing — see
`src/main/ollama/ollama-client.js` to change it) is installed. If not, a
one-click "Download AI model" button pulls it via Ollama's `/api/pull`
endpoint with a live progress bar.

## Using the app

1. Drag your `conversations.json` export onto the drop zone (or click to
   choose the file).
2. Once parsed, type a question in the box — e.g. *"What was I working on
   with my React project last spring?"*
3. The app keyword-ranks your threads against the question, bundles the
   top ~12 matching threads into a single prompt, and sends it to your
   local Ollama model. The answer streams in, with the source threads used
   listed alongside it for transparency.

## Project structure

```
src/
  main/                   Electron main process = the "backend"
    index.js              App entry, window lifecycle
    ipc-handlers.js        IPC routes (the API layer between UI and logic)
    parser/
      chatgpt-parser.js    Walks the export's branching tree into linear threads
    search/
      keyword-ranker.js    Scores/ranks threads by keyword frequency
    ollama/
      ollama-client.js     fetch() wrapper for the local Ollama HTTP API
  preload/
    preload.js             contextBridge - safe API surface for the renderer
  renderer/                 The UI (vanilla HTML/CSS/JS for the MVP)
    index.html
    app.js
    styles.css
```

## Known MVP limitations (by design, not oversight)

- **Keyword frequency, not semantic search.** A search for "database" won't
  match a thread that only says "Postgres." Planned v2 upgrade: an optional
  local Python service using `sentence-transformers` for real embeddings,
  swapped in behind `keyword-ranker.js`'s interface.
- **Small model (`qwen3.5:0.8b`, ~1GB).** Chosen to validate the retrieval
  pipeline itself with a small download. Swap `DEFAULT_MODEL` in
  `ollama-client.js` for a larger model (e.g. `gemma4:e2b`) once the core
  UX is validated and you want better answer quality.
- **Only the ChatGPT export format is parsed.** `chatgpt-parser.js` expects
  the `mapping` tree structure from OpenAI's export. Other export formats
  (Claude, etc.) would need their own parser module alongside it.

## Packaging

```bash
npm run dist
```

Uses `electron-builder` (see the `build` key in `package.json`) to produce
a Windows NSIS installer, macOS DMG, or Linux AppImage depending on your
platform. Since this MVP has no Python subprocess to bundle, packaging is
just standard Electron packaging — no PyInstaller step needed.
