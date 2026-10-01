# Athar

One private memory for all your AI chats. Import your ChatGPT, Claude and Gemini
history; a local model (via [Ollama](https://ollama.com)) remembers it, cites it,
and helps you search it — nothing leaves your computer unless you choose a
Gemini model with your own API key.

## What it does

- **Remembers across assistants.** Past conversations from ChatGPT, Claude,
  Gemini and this app are split into passages and searched by meaning and by
  keywords for every message. Relevant memories are given to the model, which
  cites them like `[M1]`; unrelated questions get no memories at all.
- **Understands how you ask.** "What did I ask Claude about salary last year?"
  searches only Claude, only last year, for "salary".
- **Search & browse your history** in one place, filter by source, open any
  conversation at the matching passage, or start a new chat about it.
- **Portable memory profile.** A short summary of you (work, projects, tools,
  how you like answers) learned from your own messages. Review it, use it here,
  or copy it into ChatGPT's custom instructions or another assistant.
- **Gemini, optional.** Add your own Gemini API key (free from Google AI Studio)
  in Settings to use Gemini models next to the local ones. With a Gemini model, the
  question, the conversation and the relevant memory and file excerpts go to Google;
  memory search stays on your computer. The key is stored encrypted.
- **No web access.** Athar never goes online for an answer. Questions about
  things that change (prices, news, the latest version…) are answered from the
  model's training data, with a note saying how old that is.
- **Attach files** (PDFs, text, code) and let the model read them on demand.
- **Project folder (read-only)**: let the model read a folder and its git
  history to answer questions about it. It can never change your files.

## Requirements

- [Ollama](https://ollama.com). On Windows, if it is missing the app offers to install
  it (it downloads the official installer, checks that it is signed by Ollama Inc.,
  and installs it without an admin prompt). If it is installed but not running,
  the app starts it.
- A chat model — default `qwen2.5:7b` (any installed chat model works;
  pick one in Settings) — and the `bge-m3` embedding model. The app offers to
  download both on first start.
- 16 GB RAM recommended for a 7B model with a 16K context.

### Switching models

The app reads each model's description from Ollama (`src/main/ollama/model-profile.js`)
and adapts, so any model works without a hard-coded list:

- **Capabilities**: tools, images and "thinking" as Ollama reports them. Features a
  model can't do are switched off and explained.
- **Context size**: the largest of 16K / 8K / 4K that fits in this computer's memory
  next to the model (from its size and memory per token), never more than the model
  supports. A 7B model in 16 GB keeps 16K. Memory, file and tool budgets follow it.
- **Helper level**: small models (under ~14B parameters) get full guidance; capable
  models decide more themselves. The safety nets (hedging, wrong language) apply to both.
- **Thinking models** (Qwen3, DeepSeek-R1…): inline `<think>` reasoning is hidden
  while streaming and removed from answers; thinking is turned off for short helper calls.

Overrides: `ATHAR_ASSIST=guided|light`, `OLLAMA_NUM_CTX=<tokens>`, `OLLAMA_KEEP_ALIVE`.

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
npm run test:live   # also real-model memory relevance checks
```

## Beta license keys

The packaged app asks for a license key before it runs (`npm start` skips
this; set `ATHAR_LICENSE=1` to try it). Keys are checked offline: each one is
the tester's name, computer ID and end date, signed with your private key.

```bash
npm run beta-key -- init        # once: creates your signing key pair
npm run beta-key -- --name "Ahmed" --computer 7KQ2-M9XD --expires 2026-12-31
npm run beta-key -- check <key> # what a key contains, and whether it's genuine
npm run beta-key -- list        # keys you have made
```

The **private key** is saved outside the project, in `~/.athar-signing/`:
keep it secret and back it up. The **public key** is written into
`src/main/license/public-key.js`. A tester installs Athar, sends you the
computer ID shown on the activation screen, and pastes the key you make for
it. See `src/main/license/license.js`.

## Packaging

```bash
npm run release   # the installer to give out
```

Tests → copies the app into `release/app/` (git-ignored; your source files are
never changed) → obfuscates the copy (strongly the license code, lightly the
main process and preload) → checks the obfuscated license code with a real key
→ builds the installer into `dist/` with Electron fuses on (the app refuses to
start if its files are modified, and can't be run as plain Node) → starts the
built app once to check it. Options: `--skip-tests`, `--keep-copy`,
`--no-smoke`.

`npm run dist` builds without obfuscation (for quick local checks only).
Both use `electron-builder` (see `build` in `package.json`) and regenerate
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
  tools/                   attached files, project folder, git (read-only)
src/preload/preload.js     the bridge exposed to the UI
src/renderer/              UI (vanilla HTML/CSS/JS)
tests/                     test suites (npm test)
```

## Known limitations

- A 7B local model sometimes mis-states or over-generalises. Answers cite the
  memories they used so you can check, and the memory profile is meant to be
  reviewed before you use or share it.
- The app is English-only; other languages are untested.
