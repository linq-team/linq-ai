import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { validate } from '../scripts/validate.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'linq-ai-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function check(files) {
  const dir = fixture(files);
  try {
    return validate(dir).errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD_RULE = `---
description: Linq conventions
alwaysApply: false
---

# Linq
Use E.164.
`;

const GOOD_SKILL = `---
name: linq-build
description: Build on an existing Linq line
---

# Build
Do the thing.
`;

const GOOD_MANIFEST = JSON.stringify({
  name: 'linq',
  author: { name: 'Linq', email: 'contact@linqapp.com' },
});

test('a well-formed plugin passes', () => {
  const errors = check({
    'rules/linq.mdc': GOOD_RULE,
    'skills/linq-build/SKILL.md': GOOD_SKILL,
    '.cursor-plugin/plugin.json': GOOD_MANIFEST,
  });
  assert.deepEqual(errors, []);
});

test('rejects a .md rule file', () => {
  const errors = check({ 'rules/linq.md': GOOD_RULE });
  assert.ok(errors.some((e) => e.includes('.mdc')), errors.join('\n'));
});

test('rejects a rule with no frontmatter', () => {
  const errors = check({ 'rules/linq.mdc': '# Linq\nno frontmatter\n' });
  assert.ok(errors.some((e) => e.includes('frontmatter')), errors.join('\n'));
});

test('rejects an unknown rule frontmatter field', () => {
  const errors = check({
    'rules/linq.mdc': GOOD_RULE.replace('alwaysApply: false', 'alwaysApply: false\npriority: 3'),
  });
  assert.ok(errors.some((e) => e.includes('priority')), errors.join('\n'));
});

test('rejects a rule over 500 lines', () => {
  const errors = check({ 'rules/linq.mdc': GOOD_RULE + 'x\n'.repeat(600) });
  assert.ok(errors.some((e) => e.includes('500')), errors.join('\n'));
});

test('rejects skill name that does not match its folder', () => {
  const errors = check({
    'skills/linq-build/SKILL.md': GOOD_SKILL.replace('name: linq-build', 'name: something-else'),
  });
  assert.ok(errors.some((e) => e.includes('match')), errors.join('\n'));
});

test('rejects funding and investor claims', () => {
  const errors = check({
    'skills/linq-build/SKILL.md': GOOD_SKILL + '\nLinq just closed a $20M round led by TQ Ventures.\n',
  });
  assert.ok(errors.some((e) => e.includes('$20M')), errors.join('\n'));
});

test('rejects plaintext api key writes', () => {
  const errors = check({
    'skills/linq-build/SKILL.md': GOOD_SKILL + '\necho "$KEY" > ~/Downloads/linq-api-key.txt\n',
  });
  assert.ok(errors.some((e) => e.includes('linq-api-key.txt')), errors.join('\n'));
});

test('rejects a hardcoded CLI version', () => {
  const errors = check({
    'skills/linq-build/SKILL.md': GOOD_SKILL + '\nRequires CLI 2.5.0 or later.\n',
  });
  assert.ok(errors.some((e) => e.includes('2.5.0')), errors.join('\n'));
});

test('rejects tenantType, which the CLI does not emit', () => {
  const errors = check({
    'rules/linq.mdc': GOOD_RULE + '\nCheck tenantType == "MULTI".\n',
  });
  assert.ok(errors.some((e) => e.includes('tenantType')), errors.join('\n'));
});

test('rejects internal hostnames without naming one', () => {
  const errors = check({
    'rules/linq.mdc': GOOD_RULE + '\nCall prod.some-service.linqapp.com directly.\n',
  });
  assert.ok(errors.some((e) => e.includes('internal endpoint')), errors.join('\n'));
});

test('allows the public linqapp.com hosts', () => {
  const errors = check({
    'rules/linq.mdc':
      GOOD_RULE + '\nSee https://docs.linqapp.com and https://api.linqapp.com and https://dashboard.linqapp.com\n',
    '.cursor-plugin/plugin.json': GOOD_MANIFEST,
  });
  assert.deepEqual(errors, []);
});

test('rejects author fields outside the plugin schema', () => {
  const errors = check({
    '.cursor-plugin/plugin.json': JSON.stringify({
      name: 'linq',
      author: { name: 'Linq', url: 'https://linqapp.com' },
    }),
  });
  assert.ok(errors.some((e) => e.includes('author.url')), errors.join('\n'));
});

test('rejects manifests that disagree on the plugin name', () => {
  const errors = check({
    '.cursor-plugin/plugin.json': JSON.stringify({ name: 'linq' }),
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'linq-ai' }),
  });
  assert.ok(errors.some((e) => e.includes('disagree')), errors.join('\n'));
});

test('rejects an mcp.json placeholder with no declared plugin variable', () => {
  const errors = check({
    '.cursor-plugin/plugin.json': GOOD_MANIFEST,
    'mcp.json': JSON.stringify({
      mcpServers: { linq: { command: 'npx', args: ['-y', 'pkg'], env: { KEY: '${LINQ_TOKEN}' } } },
    }),
  });
  assert.ok(errors.some((e) => e.includes('LINQ_TOKEN')), errors.join('\n'));
});

test('accepts an mcp.json placeholder that is declared', () => {
  const errors = check({
    '.cursor-plugin/plugin.json': JSON.stringify({
      name: 'linq',
      variables: { type: 'object', properties: { LINQ_TOKEN: { type: 'string' } } },
    }),
    'mcp.json': JSON.stringify({
      mcpServers: { linq: { command: 'npx', args: ['-y', 'pkg'], env: { KEY: '${LINQ_TOKEN}' } } },
    }),
  });
  assert.deepEqual(errors, []);
});

test('rejects an mcp.json script that does not exist', () => {
  const errors = check({
    '.cursor-plugin/plugin.json': GOOD_MANIFEST,
    'mcp.json': JSON.stringify({
      mcpServers: { linq: { command: 'node', args: ['./scripts/missing.mjs'] } },
    }),
  });
  assert.ok(errors.some((e) => e.includes('does not exist')), errors.join('\n'));
});

test('rejects absolute and escaping paths in mcp.json', () => {
  const errors = check({
    '.cursor-plugin/plugin.json': GOOD_MANIFEST,
    'mcp.json': JSON.stringify({
      mcpServers: {
        a: { command: 'node', args: ['/usr/local/bin/x.mjs'] },
        b: { command: 'node', args: ['../outside.mjs'] },
      },
    }),
  });
  assert.ok(errors.some((e) => e.includes('absolute path')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('..')), errors.join('\n'));
});
