// Exercises the real MCP server using the exact command mcp.json ships.
//
// This is the regression guard for the version pin. @linqapp/sdk-mcp 0.29.0 shipped a
// code-execution sandbox that failed on every call, because a code regeneration
// reverted the Deno fix. Nothing about the plugin's own files catches that — only
// running the server does. Skip with LINQ_SKIP_MCP_SMOKE=1 when offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = process.env.LINQ_SKIP_MCP_SMOKE === '1';
const TIMEOUT_MS = 240_000;

// Read the server invocation from mcp.json rather than repeating it, so this
// test always guards whatever the plugin actually ships.
const { mcpServers } = JSON.parse(readFileSync(join(ROOT, 'mcp.json'), 'utf8'));
const [serverName, serverConfig] = Object.entries(mcpServers)[0];

let server;

function startServer() {
  const child = spawn(serverConfig.command, serverConfig.args ?? [], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    // A syntactically valid placeholder. search_docs is a local index and execute
    // runs sandboxed code that never reaches the network, so neither needs a real
    // key — but the client refuses to initialize without something non-empty.
    env: { ...process.env, ...(serverConfig.env ?? {}), LINQ_API_V3_API_KEY: 'smoke-test-placeholder' },
  });

  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  let nextId = 1;
  return {
    child,
    request(method, params) {
      const id = nextId++;
      const promise = new Promise((resolve, reject) => {
        pending.set(id, resolve);
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`timed out waiting for ${method}`));
        }, TIMEOUT_MS);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return promise;
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
  };
}

before(async () => {
  if (SKIP) return;
  server = startServer();
  const initialized = await server.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'linq-ai-smoke', version: '1' },
  });
  assert.ok(initialized.result, `server "${serverName}" did not complete the initialize handshake`);
  server.notify('notifications/initialized');
});

after(() => {
  server?.child.kill();
});

test('mcp.json pins an exact server version', { skip: SKIP }, () => {
  const pinned = (serverConfig.args ?? []).find((a) => a.includes('@linqapp/sdk-mcp'));
  assert.ok(pinned, 'mcp.json should launch @linqapp/sdk-mcp');
  assert.match(
    pinned,
    /@linqapp\/sdk-mcp@\d+\.\d+\.\d+$/,
    `pin an exact version, not a range or tag — got "${pinned}"`,
  );
});

test('the configured server advertises both tools', { skip: SKIP }, async () => {
  const { result } = await server.request('tools/list', {});
  const names = result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['execute', 'search_docs']);
});

test('search_docs returns documentation', { skip: SKIP }, async () => {
  const response = await server.request('tools/call', {
    name: 'search_docs',
    arguments: { query: 'send a message', language: 'typescript' },
  });
  assert.ok(!response.error, `search_docs returned a JSON-RPC error: ${JSON.stringify(response.error)}`);
  const text = response.result?.content?.[0]?.text ?? '';
  assert.notEqual(response.result?.isError, true, `search_docs errored: ${text}`);
  assert.match(text, /client\./);
});

test('execute runs code in the sandbox — guards the version pin', { skip: SKIP }, async () => {
  const response = await server.request('tools/call', {
    name: 'execute',
    arguments: {
      code: 'async function run(client) { return { ok: 2 + 2, hasClient: !!client } }',
      intent: 'plugin smoke test',
    },
  });

  // Three distinct shapes mean "the sandbox is broken", and only the first sets
  // isError. A host-scoped --allow-net crashes the Deno worker before it can
  // answer, which surfaces as a JSON-RPC error with no result at all; asserting
  // on isError alone would read that as success.
  assert.ok(
    !response.error,
    `execute returned a JSON-RPC error — the Deno sandbox failed to boot, which is what a ` +
      `host-scoped --allow-net does: ${JSON.stringify(response.error)}`,
  );
  const text = response.result?.content?.[0]?.text ?? '';
  assert.notEqual(
    response.result?.isError,
    true,
    `execute failed — the pinned @linqapp/sdk-mcp version has a broken sandbox: ${text}`,
  );
  assert.match(text, /"ok":\s*4/, `execute returned no result payload: ${text || '<empty>'}`);
});
