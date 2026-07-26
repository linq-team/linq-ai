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
rsync -a --exclude .git --exclude node_modules linq-ai/ ~/.cursor/plugins/local/linq/
```

Then run **Developer: Reload Window** in Cursor.

Copy it — do not symlink. Cursor's docs suggest `ln -s` for faster iteration, but current builds reject a symlink whose target sits outside the plugins directory:

```
loadUserLocalPlugin linq rejected: symlink target ... is outside
/Users/you/.cursor/plugins/local
```

Re-run the `rsync` after each change, then reload the window.

## Authentication

**You do not put an API key in the plugin config.** Run this once:

```bash
npm install -g @linqapp/cli@latest
linq login --token <your-token>
```

That covers every project on the machine. Tokens come from https://dashboard.linqapp.com/api-tooling/, or `linq tokens create`.

The MCP server reads `$LINQ_API_V3_API_KEY` when it is set, and otherwise falls back to the token `linq login` wrote to `~/.linq/config.json` (honouring `LINQ_PROFILE`). That fallback matters more than it sounds: MCP servers are launched as detached child processes, so on macOS a Cursor started from the Dock never sees `export LINQ_API_V3_API_KEY=...` from your shell profile. Without it, the env var is unreachable for most desktop users.

Plugin `variables` are not an option here — only team admins can set their values from the dashboard, which leaves solo developers with no way to supply a secret.

## The MCP version pin

`mcp.json` pins `@linqapp/sdk-mcp` to an exact version so every developer runs the same server.

`test/mcp-smoke.test.mjs` reads that command straight out of `mcp.json`, starts it, and asserts `execute` actually returns a payload — so the test and the shipped config cannot drift apart. **Bump the pin only with that test green.** Nothing else in this repo can catch a broken code-execution sandbox — the plugin's own files look perfectly healthy when the server underneath is not.

That is not hypothetical. Release 0.29.0 shipped with `execute` broken on every call: the sandbox was launched with a host-scoped `--allow-net` that excluded the worker's own unix socket, and `deno` had been dropped from the dependencies. The fix is now sealed as generator custom code, so a regeneration re-applies it instead of reverting it.

## Contributing

```bash
node scripts/validate.mjs                                        # content + manifest checks
node --test test/validate.test.mjs                               # fast, offline
node --test --test-timeout=300000 test/mcp-smoke.test.mjs        # real server, needs network
```

Both must pass before a PR merges. `scripts/validate.mjs` enforces the things that are easy to regress and invisible until a user hits them:

- Rules use `.mdc` with valid frontmatter and stay under 500 lines — a `.md` file in `rules/` is silently ignored by Cursor.
- Each skill's frontmatter `name` matches its folder name.
- All three host manifests agree on the plugin name, and `author` carries only schema-valid fields.
- Every `${...}` in `mcp.json` has a declared plugin variable, and referenced scripts exist at relative paths. Cursor leaves an undeclared `${VAR}` in place literally, so this catches a silent corruption.
- No unverifiable claims, no plaintext key writes, no hardcoded tool versions, no internal hostnames.

## License

MIT
