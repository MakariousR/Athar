/**
 * A small Model Context Protocol server (JSON-RPC 2.0 over stdio, one JSON
 * message per line). Claude Desktop, Claude Code and other MCP apps start
 * "Athar.exe --mcp" and talk to it through stdin/stdout.
 *
 * Only what a tools-only server needs: initialize, ping, tools/list and
 * tools/call. Anything printed to stdout that isn't a protocol message would
 * break the connection, so logs go to stderr (see startMcpMode in index.js).
 */
const readline = require('readline');

// Newest first; a client asking for one of these gets it back
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const ERR = { parse: -32700, invalidRequest: -32600, notFound: -32601, invalidParams: -32602, internal: -32603 };

/**
 * @param {object} opts
 * @param {{name:string, version:string}} opts.info
 * @param {string} [opts.instructions]   shown to the client's model: when to use these tools
 * @param {Array<{name:string, title?:string, description:string, inputSchema:object, run:(args:object)=>Promise<string>}>} opts.tools
 */
function createMcpServer({ info, instructions = '', tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function callTool(params) {
    const tool = byName.get(params && params.name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${params && params.name}`), { code: ERR.invalidParams });
    try {
      const text = await tool.run((params && params.arguments) || {});
      return { content: [{ type: 'text', text: String(text) }] };
    } catch (err) {
      // A tool that fails is a result the model can read and recover from, not a protocol error
      return { content: [{ type: 'text', text: err.message || String(err) }], isError: true };
    }
  }

  async function dispatch(method, params) {
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: info,
          ...(instructions ? { instructions } : {})
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: tools.map(({ name, title, description, inputSchema }) => ({ name, ...(title ? { title } : {}), description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) };
      case 'tools/call':
        return callTool(params);
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: ERR.notFound });
    }
  }

  /** One incoming message → the reply to send, or null (notifications get none). */
  async function handle(message) {
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      if (message && message.id !== undefined && message.method === undefined) return null; // a reply to us: we never ask anything
      return { jsonrpc: '2.0', id: message && message.id !== undefined ? message.id : null, error: { code: ERR.invalidRequest, message: 'Invalid request' } };
    }
    const isNotification = message.id === undefined;
    try {
      const result = await dispatch(message.method, message.params);
      return isNotification ? null : { jsonrpc: '2.0', id: message.id, result };
    } catch (err) {
      if (isNotification) return null; // e.g. notifications/initialized, notifications/cancelled
      return { jsonrpc: '2.0', id: message.id, error: { code: err.code || ERR.internal, message: err.message || 'Internal error' } };
    }
  }

  /** Line-delimited JSON over the given streams; resolves when input ends. */
  function serve(input, output) {
    const send = (msg) => output.write(`${JSON.stringify(msg)}\n`);
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    const inFlight = new Set();
    rl.on('line', (line) => {
      if (!line.trim()) return;
      let message;
      try { message = JSON.parse(line); } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: ERR.parse, message: 'Parse error' } });
        return;
      }
      const job = handle(message).then((reply) => { if (reply) send(reply); });
      inFlight.add(job);
      job.finally(() => inFlight.delete(job));
    });
    return new Promise((resolve) => rl.on('close', () => Promise.allSettled([...inFlight]).then(resolve)));
  }

  return { handle, serve };
}

module.exports = { createMcpServer, PROTOCOL_VERSIONS };
