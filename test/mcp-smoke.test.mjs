// Exercises the real MCP server through the real launcher.
//
// This is the regression guard for the version pin. @linqapp/sdk-mcp 0.29.0 ships a
// code-execution sandbox that fails on every call, because a Stainless regeneration
// reverted the Deno fix. Nothing about the plugin's own files catches that — only
// running the server does. Skip with LINQ_SKIP_MCP_SMOKE=1 when offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = process.env.LINQ_SKIP_MCP_SMOKE === '1';
const BOOT_TIMEOUT_MS = 240_000;

let server;

function startServer() {
  const child = spawn('node', ['./scripts/linq-mcp.mjs'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    // A syntactically valid placeholder: search_docs is a local index and execute
    // runs sandboxed code that never reaches the network, so neither needs a real key.
    env: { ...process.env, LINQ_API_V3_API_KEY: 'smoke-test-placeholder' },
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
        }, BOOT_TIMEOUT_MS);
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
  assert.ok(initialized.result, 'server did not complete the initialize handshake');
  server.notify('notifications/initialized');
});

after(() => {
  server?.child.kill();
});

test('the launcher starts a server advertising both tools', { skip: SKIP }, async () => {
  const { result } = await server.request('tools/list', {});
  const names = result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['execute', 'search_docs']);
});

test('search_docs returns documentation', { skip: SKIP }, async () => {
  const { result } = await server.request('tools/call', {
    name: 'search_docs',
    arguments: { query: 'send a message', language: 'typescript' },
  });
  assert.notEqual(result.isError, true, `search_docs errored: ${result.content?.[0]?.text}`);
  assert.match(result.content[0].text, /client\./);
});

test('execute runs code in the sandbox — guards the version pin', { skip: SKIP }, async () => {
  const { result } = await server.request('tools/call', {
    name: 'execute',
    arguments: {
      code: 'async function run(client) { return { ok: 2 + 2, hasClient: !!client } }',
      intent: 'plugin smoke test',
    },
  });
  const text = result.content?.[0]?.text ?? '';
  assert.notEqual(
    result.isError,
    true,
    `execute failed — the pinned @linqapp/sdk-mcp version has a broken sandbox: ${text}`,
  );
  assert.match(text, /"ok":\s*4/);
});

test('a missing key fails with an actionable message', { skip: SKIP }, async () => {
  const child = spawn('node', ['./scripts/linq-mcp.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: process.env.PATH, HOME: join(ROOT, 'test', 'no-such-home') },
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /no API key found/);
  assert.match(stderr, /linq login/);
});
