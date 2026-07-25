import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveApiKey, KEY_NAME } from '../scripts/resolve-key.mjs';

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'linq-key-'));
  return {
    dir,
    workspace(content) {
      writeFileSync(join(dir, '.env'), content);
      return this;
    },
    cliConfig(config) {
      mkdirSync(join(dir, '.linq'), { recursive: true });
      writeFileSync(join(dir, '.linq', 'config.json'), JSON.stringify(config));
      return this;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('returns null when there is no key anywhere', () => {
  const s = sandbox();
  try {
    assert.equal(resolveApiKey({ env: {}, cwd: s.dir, home: s.dir }), null);
  } finally {
    s.cleanup();
  }
});

test('prefers the environment over every other source', () => {
  const s = sandbox().workspace(`${KEY_NAME}=from-dotenv\n`).cliConfig({
    profile: 'default',
    profiles: { default: { token: 'from-cli' } },
  });
  try {
    const found = resolveApiKey({ env: { [KEY_NAME]: 'from-env' }, cwd: s.dir, home: s.dir });
    assert.equal(found.key, 'from-env');
    assert.equal(found.source, 'environment');
  } finally {
    s.cleanup();
  }
});

test('falls back to a workspace .env before the CLI config', () => {
  const s = sandbox().workspace(`${KEY_NAME}=from-dotenv\n`).cliConfig({
    profile: 'default',
    profiles: { default: { token: 'from-cli' } },
  });
  try {
    const found = resolveApiKey({ env: {}, cwd: s.dir, home: s.dir });
    assert.equal(found.key, 'from-dotenv');
  } finally {
    s.cleanup();
  }
});

test('falls back to the CLI config last', () => {
  const s = sandbox().cliConfig({ profile: 'default', profiles: { default: { token: 'from-cli' } } });
  try {
    const found = resolveApiKey({ env: {}, cwd: s.dir, home: s.dir });
    assert.equal(found.key, 'from-cli');
    assert.match(found.source, /config\.json/);
  } finally {
    s.cleanup();
  }
});

test('reads the active CLI profile, not just default', () => {
  const s = sandbox().cliConfig({
    profile: 'staging',
    profiles: { default: { token: 'default-token' }, staging: { token: 'staging-token' } },
  });
  try {
    assert.equal(resolveApiKey({ env: {}, cwd: s.dir, home: s.dir }).key, 'staging-token');
  } finally {
    s.cleanup();
  }
});

test('LINQ_PROFILE overrides the active CLI profile', () => {
  const s = sandbox().cliConfig({
    profile: 'staging',
    profiles: { default: { token: 'default-token' }, prod: { token: 'prod-token' } },
  });
  try {
    const found = resolveApiKey({ env: { LINQ_PROFILE: 'prod' }, cwd: s.dir, home: s.dir });
    assert.equal(found.key, 'prod-token');
  } finally {
    s.cleanup();
  }
});

test('parses quoted, exported, and commented .env lines', () => {
  const s = sandbox().workspace(
    ['# a comment', `export ${KEY_NAME}="quoted-token"   # trailing note`, 'OTHER=x'].join('\n'),
  );
  try {
    assert.equal(resolveApiKey({ env: {}, cwd: s.dir, home: s.dir }).key, 'quoted-token');
  } finally {
    s.cleanup();
  }
});

test('ignores an empty assignment in .env and falls through', () => {
  const s = sandbox().workspace(`${KEY_NAME}=\n`).cliConfig({
    profile: 'default',
    profiles: { default: { token: 'from-cli' } },
  });
  try {
    assert.equal(resolveApiKey({ env: {}, cwd: s.dir, home: s.dir }).key, 'from-cli');
  } finally {
    s.cleanup();
  }
});

test('survives a corrupt CLI config instead of throwing', () => {
  const s = sandbox();
  try {
    mkdirSync(join(s.dir, '.linq'), { recursive: true });
    writeFileSync(join(s.dir, '.linq', 'config.json'), '{ not json');
    assert.equal(resolveApiKey({ env: {}, cwd: s.dir, home: s.dir }), null);
  } finally {
    s.cleanup();
  }
});

test('returns null when the profile exists but holds no token', () => {
  const s = sandbox().cliConfig({ profile: 'default', profiles: { default: {} } });
  try {
    assert.equal(resolveApiKey({ env: {}, cwd: s.dir, home: s.dir }), null);
  } finally {
    s.cleanup();
  }
});
