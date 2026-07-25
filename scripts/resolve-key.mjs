import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const KEY_NAME = 'LINQ_API_V3_API_KEY';

// A .env line: optional `export `, KEY=VALUE, optional quotes, optional trailing comment.
function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    // A quoted value ends at its closing quote; anything after it (such as a
    // trailing comment) is not part of the value. Unquoted values end at a comment.
    const quoted = /^(['"])([\s\S]*?)\1/.exec(value);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (value) out[match[1]] = value;
  }
  return out;
}

// The CLI stores tokens per profile: { profile, profiles: { <name>: { token } } }.
function tokenFromLinqConfig(home, profileOverride) {
  const path = join(home, '.linq', 'config.json');
  if (!existsSync(path)) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  const name = profileOverride || config.profile || 'default';
  const token = config.profiles?.[name]?.token;
  return typeof token === 'string' && token ? { token, profile: name } : null;
}

/**
 * Find a Linq API key without depending on Cursor's variable interpolation.
 *
 * Inside a plugin's mcp.json, `${VAR}` resolves against plugin *variables*, which
 * only team admins can set. Resolving here instead means the key can come from the
 * places a solo developer actually has one.
 *
 * @returns {{key: string, source: string} | null}
 */
export function resolveApiKey({ env = {}, cwd, home } = {}) {
  if (env[KEY_NAME]) {
    return { key: env[KEY_NAME], source: 'environment' };
  }

  if (cwd) {
    const envPath = join(cwd, '.env');
    if (existsSync(envPath)) {
      try {
        const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
        if (parsed[KEY_NAME]) return { key: parsed[KEY_NAME], source: `${envPath}` };
      } catch {
        // Unreadable .env falls through to the CLI config.
      }
    }
  }

  if (home) {
    const found = tokenFromLinqConfig(home, env.LINQ_PROFILE);
    if (found) {
      return { key: found.token, source: `~/.linq/config.json (profile "${found.profile}")` };
    }
  }

  return null;
}
