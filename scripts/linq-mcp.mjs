#!/usr/bin/env node
// Launches the Linq MCP server with an API key resolved from the developer's
// machine. See resolve-key.mjs for why the key is not passed via mcp.json.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolveApiKey, KEY_NAME } from './resolve-key.mjs';

// Pinned deliberately. 0.29.0 regressed the code-execution sandbox: a Stainless
// regeneration reverted the Deno fix, so `execute` fails on every call. 0.28.2 is
// the last release with the fix. Raise this only with the smoke test passing.
const SERVER_PACKAGE = '@linqapp/sdk-mcp@0.28.2';

const resolved = resolveApiKey({
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
});

if (!resolved) {
  process.stderr.write(
    `\nLinq MCP server: no API key found.\n\n` +
      `Checked, in order:\n` +
      `  1. $${KEY_NAME}\n` +
      `  2. .env in the current workspace\n` +
      `  3. ~/.linq/config.json\n\n` +
      `Fix it with either:\n` +
      `  linq login --token <your-token>     (recommended — covers every project)\n` +
      `  export ${KEY_NAME}=<your-token>\n\n` +
      `Tokens: https://dashboard.linqapp.com/api-tooling/\n\n`,
  );
  process.exit(1);
}

const child = spawn('npx', ['-y', SERVER_PACKAGE], {
  stdio: 'inherit',
  env: { ...process.env, [KEY_NAME]: resolved.key },
});

child.on('error', (err) => {
  process.stderr.write(`Linq MCP server: failed to start — ${err.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
