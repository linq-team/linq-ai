# Linq for AI coding agents

Rules, skills, and MCP access for building iMessage, RCS, and SMS on [Linq](https://linqapp.com). Install it once and your agent knows how Linq works — no pasted onboarding prompt.

Works in Cursor, Claude Code, and Codex from the same repo.

## What you get

| Component | What it does |
|---|---|
| `linq` rule | Universal conventions — E.164, webhook signature verification, opt-out tracking, line-tier detection, and the errors worth recognizing. Applied intelligently, so it only loads on Linq-related work. |
| `linq-quickstart` skill | New account from scratch: install the CLI, sign up, provision a Linq Number, add a contact, send a first iMessage with effects, reactions, and live webhooks. |
| `linq-build` skill | Existing account: authenticate, send from code with `@linqapp/sdk`, receive webhooks with signature verification, handle opt-outs and rate limits. |
| MCP server | `search_docs` to find the right method and parameters, `execute` to run TypeScript against an authenticated client. |

The two skills route between themselves — `linq-quickstart` checks for an existing account first and hands off if it finds one.

## Install

Once listed in the marketplace, install `linq` from the **Customize** page in Cursor.

Until then, load it locally:

```bash
git clone https://github.com/linq-team/linq-ai
mkdir -p ~/.cursor/plugins/local
ln -sfn "$PWD/linq-ai" ~/.cursor/plugins/local/linq
```

Then run **Developer: Reload Window** in Cursor.

## Authentication

The MCP server needs a Linq API key. **You do not put it in the plugin config.** The launcher finds it for you, in this order:

1. `$LINQ_API_V3_API_KEY` in the environment
2. `.env` in the current workspace
3. `~/.linq/config.json` — where the `linq` CLI stores it

So the simplest setup is the one you probably already did:

```bash
npm install -g @linqapp/cli@latest
linq login --token <your-token>
```

That covers every project on the machine. Tokens come from https://dashboard.linqapp.com/api-tooling/, or `linq tokens create`.

If no key is found, the server exits with a message telling you how to fix it rather than failing on every tool call.

Why not plugin variables? Inside a plugin's `mcp.json`, `${VAR}` resolves against Cursor *plugin variables*, which only team admins can set from the dashboard. That leaves solo developers with no way to supply a secret, so the launcher resolves the key itself as an ordinary Node process.

## The MCP version pin

`scripts/linq-mcp.mjs` pins `@linqapp/sdk-mcp` to an exact version on purpose.

Release 0.29.0 regressed the code-execution sandbox: a code regeneration reverted a fix, so the launcher passes a host-scoped `--allow-net` that excludes the worker's own unix socket, and `deno` is no longer pulled in as a dependency. Every `execute` call fails. The pinned release is the last one with the fix.

`test/mcp-smoke.test.mjs` runs the real server through the real launcher and asserts `execute` actually returns a result. **Raise the pin only when that test passes against the new version.** Nothing else in this repo can catch that class of break.

## Contributing

```bash
node scripts/validate.mjs                                        # content + manifest checks
node --test test/validate.test.mjs test/resolve-key.test.mjs     # fast, offline
node --test --test-timeout=300000 test/mcp-smoke.test.mjs        # real server, needs network
```

Both must pass before a PR merges. `scripts/validate.mjs` enforces the things that are easy to regress and invisible until a user hits them:

- Rules use `.mdc` with valid frontmatter and stay under 500 lines — a `.md` file in `rules/` is silently ignored by Cursor.
- Each skill's frontmatter `name` matches its folder name.
- All three host manifests agree on the plugin name, and `author` carries only schema-valid fields.
- Every `${...}` in `mcp.json` has a declared plugin variable, and referenced scripts exist at relative paths.
- No unverifiable claims, no plaintext key writes, no hardcoded tool versions, no internal hostnames.

## License

MIT
