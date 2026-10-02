/**
 * "Athar --mcp": no window — Athar's memory served to Claude Desktop, Claude
 * Code or another MCP app over stdin/stdout, until that app closes the pipe.
 */
const fs = require('fs');
const net = require('net');
const { app } = require('electron');
const { createMcpServer } = require('./mcp-server');
const { memoryTools, readOnlyMemory, INSTRUCTIONS } = require('./memory-tools');

/**
 * Electron's process.stdin delivers nothing on Windows (it ends at once), so
 * the pipes Claude opened are read and written through their handles instead.
 * (Electron itself prints one blank line at startup on Windows; MCP clients
 * skip it — the official SDK logs it once and carries on.)
 */
function stdio() {
  if (process.platform !== 'win32') return { input: process.stdin, output: process.stdout };
  let input;
  try { input = new net.Socket({ fd: 0, readable: true, writable: false }); } catch { input = fs.createReadStream(null, { fd: 0 }); }
  const output = {
    write(text) {
      const buf = Buffer.from(text, 'utf8');
      for (let done = 0; done < buf.length;) done += fs.writeSync(1, buf, done, buf.length - done);
    }
  };
  return { input, output };
}

function startMcpMode() {
  // stdout carries the protocol: anything else printed there breaks the connection
  for (const level of ['log', 'info', 'debug']) console[level] = (...args) => console.error(...args);
  app.disableHardwareAcceleration();
  if (app.dock) app.dock.hide();

  const ollama = require('../ollama/ollama-client');
  const { getLicense } = require('../license');
  const server = createMcpServer({
    info: { name: 'athar', title: 'Athar', version: app.getVersion() },
    instructions: INSTRUCTIONS,
    tools: memoryTools({
      // Meaning search needs Ollama with bge-m3; without it, keyword search still works
      getMemory: readOnlyMemory({ userData: app.getPath('userData'), embedTexts: ollama.embedTexts, embedModel: ollama.EMBED_MODEL }),
      isUsable: () => getLicense().isUsable()
    })
  });
  const { input, output } = stdio();
  server.serve(input, output).then(() => app.exit(0));
}

module.exports = { startMcpMode };
