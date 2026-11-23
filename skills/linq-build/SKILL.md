---
name: linq-build
description: Build an application on an existing Linq account — authenticate, send messages from code with @linqapp/sdk, receive webhooks with signature verification, and handle opt-outs and rate limits. Use when the user already has a Linq account or API key.
---

# Build on Linq

For developers with an existing Linq account. If the user has no account yet, use the `linq-quickstart` skill instead.

## Ground rules

Three things hold regardless of what you are building. Do not skip them.

- **Conversational only.** Never build one-way blasts, cold outreach, or notification-only flows. iMessage is a peer-to-peer channel, and broadcast patterns get a line flagged by Apple and can shut the account down. If the user asks for a blast, propose a conversational design that does the same job.
- **Never write an API key to a file.** Use `linq tokens show --copy`, an environment variable, or `linq login`.
- **Phone numbers are E.164** (`+14155551234`). Convert them yourself; never ask the user to reformat.

## Step 1 — Authenticate and identify the line

```bash
npm install -g @linqapp/cli@latest
linq login --token <their-api-token>
linq whoami --json
```

`linq login` is worth preferring over an environment variable: it writes `~/.linq/config.json`, which the Linq MCP server also reads, so one login authenticates both the CLI and the MCP tools for every project on the machine.

Install `@latest` first. Older builds prompted for a default Linq Number before saving, so on a multi-number account `linq login --token` exited from an agent shell without writing anything. If you are stuck on an older CLI, `export LINQ_API_V3_API_KEY=<token>` or pass `--token <t>` per command instead.

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

Linq enforces this one for you, so the job is to stay on the right side of it rather than to build a suppression list.

While a recipient is opted out, **every** send to them is rejected with `403` and error code `2024` before the message is queued. Nothing is dispatched. The block covers that recipient in direct messages across every line on the account, so retrying from a different `from` does not get around it. Group threads are not affected.

Gate on the chat's `health_status.status`, which reads `OPTED_OUT`, and treat that as the source of truth rather than tracking opt-in state yourself:

```typescript
if (chat.health_status?.status === 'OPTED_OUT') return; // do not send
```

The status clears on its own. Any later reply from that recipient — in any chat they have with you — opts them back in immediately, unless the reply is itself a stop keyword. There is no opt-in keyword to teach: `START`, `OPTIN`, and `UNSTOP` work, but so does any other message. Do not build an opt-in keyword handler.

**The one message you can still send.** There is no free follow-up. If the application wants to confirm it has stopped, send exactly one message with `override_optout: true`:

```typescript
await client.chats.messages.send(chatId, {
  override_optout: true,
  message: { parts: [{ type: 'text', value: "You've been unsubscribed. Reply any time if you'd like to hear from us again." }] },
});
```

That flag applies to the single request it is set on, does not lift the block, and each use is recorded against the account. It belongs on one send in the opt-out path — never inside a retry loop.

**What Linq does not catch.** Only the exact keywords trigger the block: `STOP`, `UNSUBSCRIBE`, `OPTOUT`, `CANCEL`, `END`, `QUIT`, matched case-sensitively as the entire message, plus `OPT OUT` in any casing with or without a space or hyphen. `please stop messaging me` matches nothing. Scan inbound text for plain-English stop intent and suppress on it in application code — that is the half Linq cannot do.

## Step 6 — Gate on chat health and line reputation

Two signals, different scopes. Read both before sending at volume.

- **Chat health** — `health_status` on every chat: `HEALTHY`, `AT_RISK`, `CRITICAL`, `OPTED_OUT`. Per recipient.
- **Line state**: `reputation.state` on every entry from `GET /v3/phone_numbers`. Per line, rolled up from the conversations on it and the line's overall activity. The dashboard shows each value by name:
  - `HEALTHY` (Healthy): in good standing. Send normally.
  - `WATCH` (Watch): a recent change in activity that usually settles on its own. No action needed; keep sending normally.
  - `NEEDS_ATTENTION` (Needs Attention): a sustained pattern that needs a change in how the line is used. Slow the line's pace, avoid opening many new conversations at once, and fix the unhealthy chats on it.
  - `DELIVERY_LIMITED` (Delivery Limited): outbound messages from the line are not being delivered. Pause outbound on the line until it returns to `HEALTHY`.

Gate on `state`. `reputation.status` (`HEALTHY` / `AT_RISK` / `CRITICAL`) is the legacy field, derived from `state`: `HEALTHY` and `WATCH` report `HEALTHY`, `NEEDS_ATTENTION` reports `AT_RISK`, and `DELIVERY_LIMITED` reports `CRITICAL`. Read it only in code that has not moved to `state` yet, and show partners the state names above.

Subscribe to `phone_number.status_updated` to react when a line changes rather than polling `GET /v3/phone_numbers` before every send. Read `previous_state` and `new_state` from the event. Both are optional, so when they are missing fall back to the legacy `previous_reputation` / `new_reputation`, which every event carries: `HEALTHY` means no action, `AT_RISK` maps to Needs Attention, and `CRITICAL` maps to Delivery Limited. The event also fires when only the state changes, so the two legacy values can be equal.

Onboard new users onto `HEALTHY` lines. Keep existing recipients on a Needs Attention line rather than migrating them to escape the state. Migration moves the traffic that caused it and takes the problem along.

## Step 7 — Rate limits and retries

- On `429`, read the `Retry-After` header and wait. There are no `X-RateLimit-*` headers to read proactively.
- Error bodies are `{ success, error: { status, code, message, doc_url, retry_after? }, trace_id }` — the four fields are **nested under `error`**, not top level. Through the SDK that reads `err.error.error.code`. Fetch the `doc_url` before guessing at a cause.
- `403` with code `2024` means the recipient asked you to stop. Nothing was queued. Do not retry and do not try another line — see Step 5.
- `403` with code `2008` means the recipient has not messaged the line first. The sender is not the problem — do not retry with a different `from`. `linq contacts add` is the remedy on a **Shared** line only; it hard-errors on Sandbox and Paid, where the recipient simply has to text the line first.

## Step 8 — Verify it end to end

```bash
linq doctor
```

Then send one real message to your own phone and confirm your webhook handler received the `message.received` event for your reply.

## Onboarding new recipients

First contact decides how the rest of the conversation lands.

- **Let them message first wherever you can.** Inbound-first is the healthiest opening, and on Shared and Sandbox lines it is mandatory — see Step 1.
- **`GET /v3/available_number` is for signup, not for sending.** It returns the best available line for a *new* user along with a `vcf_url` contact card to show them, and successive calls cycle the pool so signups spread evenly across lines. Calling it before each message defeats the line selection in Step 2.
- **Set the contact card up once per line** with `POST /v3/contact_card` (`PATCH` for later edits), then share it into a chat with `POST /v3/chats/{chatId}/share_contact_card`. Share only once at least one outbound message exists in that chat, and re-share about once a day — nothing confirms the recipient saved it, so the daily re-share keeps offering.

## Volume and cadence

Guidelines rather than hard caps, but the behavior behind them is what line reputation is scored on.

- Keep each line under roughly **7,000 messages a day**, inbound and outbound combined.
- Do not open **~50 or more brand-new conversations** on a single line in a rolling 24 hours. Audit bulk imports, list uploads, and campaign kickoffs for anything that opens a whole audience at once, and spread first contact across days and across lines.
- Ramp gradually. A quiet line that jumps several-fold in one day reads differently from one that grew into the same volume.
- Build for replies: aim for three or more replies early in a new conversation, and roughly a 1:2 inbound:outbound ratio. When someone stops replying, slow down and then stop.

## Using the MCP tools

If the Linq MCP server is connected, it is faster and more reliable than guessing:

- `search_docs` — look up the exact method and parameters before writing SDK code.
- `execute` — run TypeScript against an authenticated client to check a call shape or inspect real data.

`execute` makes real API calls. Sending a message through it delivers a real message to a real phone, so confirm with the user before any call that sends.

## Reference

- API docs: https://docs.linqapp.com
- Dashboard: https://dashboard.linqapp.com
- CLI source: https://github.com/linq-team/linq-cli
