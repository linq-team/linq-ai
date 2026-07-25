import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const MAX_RULE_LINES = 500;
const RULE_FRONTMATTER_FIELDS = ['description', 'globs', 'alwaysApply'];
const HOSTS = ['.cursor-plugin', '.claude-plugin', '.codex-plugin'];

const DENYLIST = [
  [/\$20M/i, 'no funding claims in distributed content'],
  [/TQ Ventures|Mucker Capital/i, 'investor name — no funding claims in distributed content'],
  [/Matt Fischer/i, 'named individual — do not distribute in versioned content'],
  [/leading platform/i, '"leading platform" — unverifiable superlative'],
  [/linq-api-key\.txt/i, 'never write an API key to a plaintext file'],
  [/>\s*~\/Downloads/i, 'redirect into ~/Downloads — never write secrets to disk'],
  [/2\.5\.0/, 'hardcoded CLI version — use `linq doctor` to assert the version'],
  [/\bTwilio\b/i, 'must not appear in user-facing content'],
  [/prod\.zero-service\.linqapp\.com/i, 'non-public internal endpoint'],
  [/tenantType/, 'tenantType is not a field the CLI emits — use `line` (see rules/linq.mdc)'],
];

// Minimal frontmatter reader: returns null when the file does not open with ---.
function frontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function checkRules(root, errors, contentFiles) {
  for (const file of walk(join(root, 'rules'))) {
    const ext = extname(file);
    if (ext === '.md' || ext === '.markdown') {
      errors.push(`${file}: rules must use the .mdc extension — Cursor ignores .md files in rules/`);
      continue;
    }
    if (ext !== '.mdc') continue;
    const text = readFileSync(file, 'utf8');
    contentFiles.push([file, text]);
    const fm = frontmatter(text);
    if (!fm) {
      errors.push(`${file}: missing frontmatter — a rule without frontmatter is ignored`);
      continue;
    }
    if (!fm.description) errors.push(`${file}: frontmatter needs a description`);
    for (const key of Object.keys(fm)) {
      if (!RULE_FRONTMATTER_FIELDS.includes(key)) {
        errors.push(
          `${file}: unknown frontmatter field "${key}" — only ${RULE_FRONTMATTER_FIELDS.join(', ')} are valid`,
        );
      }
    }
    const lines = text.split('\n').length;
    if (lines > MAX_RULE_LINES) {
      errors.push(`${file}: ${lines} lines exceeds the ${MAX_RULE_LINES}-line guidance — move detail into a skill`);
    }
  }
}

function checkSkills(root, errors, contentFiles) {
  const skillsDir = join(root, 'skills');
  if (!existsSync(skillsDir)) return;
  for (const name of readdirSync(skillsDir)) {
    if (!statSync(join(skillsDir, name)).isDirectory()) continue;
    const skillFile = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(skillFile)) {
      errors.push(`skills/${name}: missing SKILL.md`);
      continue;
    }
    const text = readFileSync(skillFile, 'utf8');
    contentFiles.push([skillFile, text]);
    const fm = frontmatter(text);
    if (!fm) {
      errors.push(`${skillFile}: missing frontmatter`);
      continue;
    }
    if (!fm.description) errors.push(`${skillFile}: frontmatter needs a description`);
    if (fm.name !== name) {
      errors.push(`${skillFile}: frontmatter name "${fm.name}" must match its folder name "${name}"`);
    }
  }
}

function checkManifests(root, errors) {
  const manifests = {};
  for (const host of HOSTS) {
    const file = join(root, host, 'plugin.json');
    if (!existsSync(file)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      errors.push(`${file}: invalid JSON — ${e.message}`);
      continue;
    }
    manifests[host] = manifest;
    if (!manifest.name) {
      errors.push(`${file}: manifest needs a name`);
    } else if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(manifest.name)) {
      errors.push(`${file}: name "${manifest.name}" must be lowercase kebab-case starting and ending alphanumeric`);
    }
    // The published schema is additionalProperties:false on author.
    if (manifest.author) {
      for (const key of Object.keys(manifest.author)) {
        if (!['name', 'email'].includes(key)) {
          errors.push(`${file}: author.${key} is not in the plugin schema — author allows only name and email`);
        }
      }
    }
  }
  const names = Object.entries(manifests).map(([host, m]) => [host, m.name]);
  const distinct = new Set(names.map(([, name]) => name));
  if (distinct.size > 1) {
    errors.push(`manifests disagree on plugin name: ${names.map(([h, n]) => `${h}=${n}`).join(', ')}`);
  }
  return manifests;
}

function checkMcp(root, errors, manifests) {
  const file = join(root, 'mcp.json');
  if (!existsSync(file)) return;
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
    return;
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== 'object') {
    errors.push(`${file}: needs an mcpServers object`);
    return;
  }
  // Inside a plugin's mcp.json, ${VAR} resolves against plugin variables — which
  // only team admins can set. Every placeholder must have a declared variable.
  const declared = new Set(
    Object.keys(manifests['.cursor-plugin']?.variables?.properties ?? {}),
  );
  for (const [name, server] of Object.entries(servers)) {
    const raw = JSON.stringify(server);
    for (const match of raw.matchAll(/\$\{([^}]+)\}/g)) {
      if (!declared.has(match[1])) {
        errors.push(
          `${file}: server "${name}" uses \${${match[1]}} but no such plugin variable is declared in the manifest`,
        );
      }
    }
    for (const arg of server.args ?? []) {
      if (arg.startsWith('/')) {
        errors.push(`${file}: server "${name}" uses an absolute path "${arg}" — plugin paths must be relative`);
      }
      if (arg.includes('..')) {
        errors.push(`${file}: server "${name}" arg "${arg}" escapes the plugin root with ".."`);
      }
      if (arg.startsWith('./') && !existsSync(join(root, arg))) {
        errors.push(`${file}: server "${name}" references "${arg}", which does not exist`);
      }
    }
  }
}

export function validate(root) {
  const errors = [];
  const contentFiles = [];

  checkRules(root, errors, contentFiles);
  checkSkills(root, errors, contentFiles);
  const manifests = checkManifests(root, errors);
  checkMcp(root, errors, manifests);

  const readme = join(root, 'README.md');
  if (existsSync(readme)) contentFiles.push([readme, readFileSync(readme, 'utf8')]);

  for (const [file, text] of contentFiles) {
    for (const [pattern, why] of DENYLIST) {
      const hit = pattern.exec(text);
      if (hit) errors.push(`${file}: "${hit[0]}" — ${why}`);
    }
  }

  return { errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors } = validate(process.cwd());
  if (errors.length) {
    console.error(`${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Plugin content OK');
}
