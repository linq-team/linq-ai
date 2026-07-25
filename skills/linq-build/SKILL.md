---
name: linq-build
description: Build an application on an existing Linq account — authenticate, send messages from code with @linqapp/sdk, receive webhooks with signature verification, and handle opt-outs and rate limits. Use when the user already has a Linq account or API key.
---

# Build on Linq

For developers with an existing Linq account. If the user has no account yet, use the `linq-quickstart` skill instead.

## Step 1 — Authenticate and identify the line

```bash
linq login --token <their-api-token>
linq whoami --json
```

Tokens come from https://dashboard.linqapp.com/api-tooling/.

Read `tier` and `line` from the JSON. Both are strings, and you need both — the CLI collapses Shared and Sandbox into `"Free"`, and Sandbox and Paid into `"Dedicated"`:

| `tier` | `line` | Meaning |
|---|---|---|
| `"Paid"` | `"Dedicated"` | Paid dedicated line. No inbound-first rule, no contact cap. This is the common case here. |
| `"Free"` | `"Shared"` | Shared line. Recipients must message the line first, and there is a contact cap. |
| `"Free"` | `"Dedicated"` | Sandbox. Recipients must message the line first. |

If the user expected a dedicated line and `tier` is `"Free"`, they are on the wrong token.

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

const chat = await client.chats.create({
  to: ['+14155551234'],
  message: { parts: [{ type: 'text', value: 'Hello from my app' }] },
});

console.log(chat.id, chat.message.id);
```

Prefer letting the platform pick the sending line over hardcoding `from` — it fails over between lines.

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

The SDK does **not** verify signatures. Write it:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyLinqWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Use the **raw** request body, not a re-serialized object. In Express that means `express.raw({ type: 'application/json' })` on the webhook route, and parsing JSON yourself after verifying.

Never write a webhook handler without this. An unverified endpoint accepts forged events from anyone who learns the URL.

## Step 5 — Handle opt-outs

There is no suppression endpoint. The application owns this state.

On every inbound message, check whether the trimmed, uppercased text is STOP, UNSUBSCRIBE, OPTOUT, CANCEL, END, or QUIT. If so, record the handle as opted out and never send to it again. Accounts are scored on sends after an opt-out, and it affects line reputation.

## Step 6 — Rate limits and retries

- On `429`, read the `Retry-After` header and wait. There are no `X-RateLimit-*` headers to read proactively.
- Every error body has `status`, `code`, `message`, and `doc_url`. Fetch the `doc_url` before guessing at a cause.
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
