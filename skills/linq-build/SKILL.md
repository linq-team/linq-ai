---
name: linq-build
description: Build an application on an existing Linq account — authenticate, send messages from code with @linqapp/sdk, receive webhooks with signature verification, and handle opt-outs and rate limits. Use when the user already has a Linq account or API key.
---

# Build on Linq

For developers with an existing Linq account. If the user has no account yet, use the `linq-quickstart` skill instead.

## Step 1 — Authenticate and identify the line

```bash
export LINQ_API_V3_API_KEY=<their-api-token>
linq whoami --json
```

Prefer the environment variable (or a per-command `--token <t>`) over `linq login`. On an account with more than one Linq Number, `linq login --token` opens an interactive number picker before it saves, so from an agent shell with no TTY it exits without writing anything and every later command fails as unauthenticated.

Tokens come from https://dashboard.linqapp.com/api-tooling/.

Read `tier` and `line` from the JSON. Both are strings, and you need both — the CLI collapses Shared and Sandbox into `"Free"`, and Sandbox and Paid into `"Dedicated"`:

| `tier` | `line` | Meaning |
|---|---|---|
| `"Paid"` | `"Dedicated"` | Paid dedicated line. No inbound-first rule, no contact cap. This is the common case here. |
| `"Free"` | `"Shared"` | Shared line. Recipients must message the line first, and there is a contact cap. |
| `"Free"` | `"Dedicated"` | Sandbox. Recipients must message the line first. |
| *absent* | *absent* | Unknown. **Assume recipients must message the line first.** |

Both keys are **omitted** when the local profile has no account label — a token-only login often returns just `{"apiKey": "..."}`. Check that `tier` is present before branching on it; never let an absent value fall through to the paid path, or you will cold-send from a line that cannot do it.

If the user expected a dedicated line and `tier` is `"Free"`, they are on the wrong token.

`whoami` reads local config and never calls the API, so it succeeds with a revoked or expired token too. Run `linq doctor` to confirm the credential actually works.

The `apiKey` field in `whoami` output is **masked** — it is a display preview, not a credential. Use `linq tokens show --json` when you need the real token.

Then list the lines available:

```bash
linq phonenumbers
```

## Step 2 — Send from code, not the CLI

```bash
npm install @linqapp/sdk
```

```typescript
import Linq from '@linqapp/sdk';

const client = new Linq({ apiKey: process.env.LINQ_API_V3_API_KEY });

const sent = await client.messages.create({
  to: ['+14155551234'],
  message: { parts: [{ type: 'text', value: 'Hello from my app' }] },
});

console.log(sent.chat_id, sent.message.id);
```

Use `messages.create`, not `chats.create`. `messages.create` takes only `to` and `message` — the platform picks the sending line and fails over between lines, and the response tells you which one it used. `chats.create` **requires** a `from`, so reaching for it forces you to hardcode a line.

## Step 3 — Receive messages

Two shapes. Use the first while developing, the second in production.

**Local development** — no tunnel, no public URL:

```bash
linq webhooks listen --forward-to http://localhost:3000/webhook
```

This creates a temporary subscription, streams events, forwards each to the local URL, and deletes the subscription on Ctrl+C. Public `target_url`s must be HTTPS and private IPs are blocked, so this is the only way to reach localhost.

**Production** — a durable subscription:

```bash
linq webhooks create --url https://your-server.com/webhook --all-events
linq webhooks events   # list available event types
```

## Step 4 — Verify webhook signatures

The SDK verifies for you. Use it — do not hand-roll HMAC:

```typescript
import express from 'express';
import Linq from '@linqapp/sdk';

const client = new Linq({ apiKey: process.env.LINQ_API_V3_API_KEY });
const app = express();

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    let event;
    try {
      event = client.webhooks.unwrap(req.body.toString('utf8'), {
        headers: req.headers as Record<string, string>,
        key: process.env.LINQ_WEBHOOK_SECRET,
      });
    } catch {
      return res.status(400).send('invalid signature');
    }

    // event is verified and parsed
    res.sendStatus(200);
  },
);
```

`unwrap` verifies and parses in one step, and throws when the signature does not check out.

Two things that break this:

- **Use the raw body.** `express.raw({ type: 'application/json' })` on the route, and pass the exact bytes received. A re-serialized object will not match the signature.
- **Do not write your own HMAC.** Linq signs with Standard Webhooks: the signed content is `{webhook-id}.{webhook-timestamp}.{body}`, base64-encoded, keyed on the base64-decoded secret with the `whsec_` prefix stripped. An HMAC of the body alone — the obvious hand-rolled version — rejects every genuine delivery, and the natural next move is to delete verification entirely.

Never ship a webhook handler without this. An unverified endpoint accepts forged events from anyone who learns the URL.

## Step 5 — Handle opt-outs

There is no suppression endpoint. The application owns this state.

On every inbound message, check whether the trimmed, uppercased text is STOP, UNSUBSCRIBE, OPTOUT, CANCEL, END, or QUIT. If so, record the handle as opted out and stop sending to it. `OPTIN` reverses it, so store a flag you can clear rather than a permanent tombstone.

Cross-check `health_status.status` on the chat, which is present on every chat and reads `OPTED_OUT` — treat that as authoritative even if you missed the inbound keyword. Accounts are scored on sends after an opt-out, and it affects line reputation.

## Step 6 — Rate limits and retries

- On `429`, read the `Retry-After` header and wait. There are no `X-RateLimit-*` headers to read proactively.
- Error bodies are `{ success, error: { status, code, message, doc_url, retry_after? }, trace_id }` — the four fields are **nested under `error`**, not top level. Through the SDK that reads `err.error.error.code`. Fetch the `doc_url` before guessing at a cause.
- `403` with code `2008` means the recipient has not messaged the line first. The sender is not the problem — do not retry with a different `from`.

## Step 7 — Verify it end to end

```bash
linq doctor
```

Then send one real message to your own phone and confirm your webhook handler received the `message.received` event for your reply.

## Using the MCP tools

If the Linq MCP server is connected, it is faster and more reliable than guessing:

- `search_docs` — look up the exact method and parameters before writing SDK code.
- `execute` — run TypeScript against an authenticated client to check a call shape or inspect real data.

`execute` makes real API calls. Sending a message through it delivers a real message to a real phone, so confirm with the user before any call that sends.

## Reference

- API docs: https://docs.linqapp.com
- Dashboard: https://dashboard.linqapp.com
- CLI source: https://github.com/linq-team/linq-cli
