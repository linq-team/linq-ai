---
name: linq-quickstart
description: Set up a brand-new Linq account from scratch — install the CLI, sign up, provision a Linq Number, add a first contact, and send a first iMessage with effects, reactions, and live webhooks. Use when the user has no Linq account yet, or says they want to try Linq for the first time.
---

# Linq quickstart

A guided first run: from nothing installed to a live iMessage conversation the user can see on their own phone.

## First: does the user already have a Linq account?

Run `linq whoami --json`. If it prints anything with an `apiKey`, they are already set up — **stop and use the `linq-build` skill instead**; this skill is only for new signups.

Note that `whoami` only reads local config and never calls the API, so it also exits 0 for a revoked or expired token. If you need to know the credential actually works, run `linq doctor` — but only once an account exists.

If the command prints nothing useful, or the CLI is not installed, continue here.

## What Linq is

Linq is a single API for iMessage, RCS, and SMS fallback over real Apple infrastructure. The CLI (`linq`) is the official command-line client and the fastest way to send a first iMessage from code. It is open and inspectable at https://github.com/linq-team/linq-cli, and every command below can be verified with `linq --help` or `linq <command> --help`.

## Step 1 — Install the CLI

Requires Node 22 or later. If the user has no Node, point them at https://nodejs.org (LTS installer).

```bash
npm install -g @linqapp/cli@latest
linq --version
```

Confirm `linq --version` prints something. Do **not** run `linq doctor` here — it checks config, credentials, and API connectivity, none of which exist before signup, so it exits non-zero by design on a fresh install. Save it for Step 11, after there is an account to check.

If `which linq` resolves under `~/.nvm/`, the binary is scoped to the active Node version and will vanish in a new terminal tab. Tell the user in one sentence and ask before running:

```bash
nvm alias default "$(node -v | sed 's/^v//')"
```

If they decline, that is fine — they can call `linq` by the absolute path `which linq` printed.

## Step 2 — Collect email + name, then sign up

Ask the user for their **email** (used for OTP verification and as the login identity) and their **full name** (used as the account name).

Send the OTP:

```bash
linq signup --email <user-email>
```

That prints "Check `<email>` for your verification code" and exits. Ask the user to read the 6-digit code from their inbox, then complete signup in one shot:

```bash
linq signup --email <user-email> --code <6-digit-code> --name "<user-name>"
```

This creates the account, mints an API key, and assigns a Linq Number.

### If they turn out to have an account already

Two different outcomes, and they need different responses:

- **"You already have a Linq account"** — note this exits **0**, so do not branch on exit status; read the output. They are an existing user. Ask them to paste their API token (from https://dashboard.linqapp.com/api-tooling/) and switch to the `linq-build` skill.
- **"…do not have a Blue number. Contact your Linq Account Manager"** — this is a genuine failure and a token will **not** get past it. Stop and tell them to contact their account manager; do not keep trying.

To carry the token forward:

```bash
linq login --token <pasted-api-token>
```

That writes `~/.linq/config.json`, which the Linq MCP server also reads — so one login covers the CLI and the MCP tools everywhere.

This needs a current CLI (`npm install -g @linqapp/cli@latest`). Older builds prompted for a default Linq Number before saving, so on a multi-number account this exited from an agent shell without writing anything. On an older CLI, `export LINQ_API_V3_API_KEY=<token>` or pass `--token <t>` per command.

## Step 3 — Save the API key

The key is shown once, and Linq does not store the raw value, so it cannot be retrieved from the server later. Two things to tell the user:

1. The CLI already persisted it to `~/.linq/config.json`. Reprint it any time with `linq tokens show`, or `linq tokens show --copy` to put it back on the clipboard.
2. Have them paste it into a password manager (1Password, Bitwarden, Apple Keychain).

Never write the key to a plaintext file. If they lose it entirely, they can mint a new one with `linq tokens create`.

## Step 4 — Show them what they got

```bash
linq whoami
```

A new self-serve signup lands on a **shared line** — `tier` is `"Free"` and `line` is `"Shared"`. That combination has two restrictions, and they apply *only* to it:

- **Contact cap.** A limited number of contacts per shared-line account. The API returns a clear error when you hit it; do not hardcode the number.
- **Inbound-first.** A contact must text the Linq Number before you can text them. This keeps the shared sandbox from being used to message strangers.

Paid dedicated lines (`tier` `"Paid"`, `line` `"Dedicated"`) have neither restriction. If you are ever working against an existing account, re-check with `linq whoami --json` rather than assuming these apply.

## Step 5 — Add the user's own phone as the first contact

Inbound-first means the user cannot send to anyone who has not texted them. The simplest first test is the user's own phone.

Ask for **their personal phone number including country code** (e.g. "415-555-1234, US" or "+44 7700 900123"). Convert it to E.164 yourself — do not make the user format it. If you are unsure of the country, ask.

Set the stage in your own voice right before running it. Two beats — what Linq is, and that you are about to text them live:

> *"Quick context before I run it: Linq is the conversational layer for iMessage, RCS, and SMS — the infrastructure agents use to actually message people. I'm about to text you live from this terminal. Watch your phone."*

Then:

```bash
linq contacts add +1XXXXXXXXXX
```

On success the CLI prints the Linq Number to text and the contact number to text it from. It also prints a share URL (`shareLink` in `--json`) — on mobile it opens Messages with a pre-filled draft, on desktop it shows a scannable QR. Surface that link when it helps: someone else who needs to text the line first, or a user who would rather scan than type.

**Start a webhook listener so you detect the inbound message yourself** rather than relying on the user to report it. Run it in the background from your own shell:

```bash
linq webhooks listen
```

Then tell the user:

> *"Open Messages on `+1XXXXXXXXXX` and text your Linq Number `<from linq whoami>` — even just 'hi'. I'll watch for it on my end."*

Poll the background process for a `message.received` event whose payload matches their number, then kill the listener and confirm:

> *"Got it — saw your message land on my side."*

If your environment cannot run background processes, ask the user to run `linq webhooks listen` in a second terminal and tell you when the event appears. Fall back to a purely verbal "tell me when you've sent it" only if neither works.

## Step 6 — Send the first message

```bash
linq chats create --to +1XXXXXXXXXX --message "Hello from your Linq CLI" --json
```

Save `chat.id` and `chat.message.id` from the output — later steps need both.

**Then stop and ask:** *"I sent 'Hello from your Linq CLI' to your phone. Did you receive it?"* Wait for confirmation before continuing.

## Step 7 — Send a follow-up with an iMessage effect

```bash
linq messages send <chat-id> --message "🎉 here's confetti" --effect confetti --json
```

Effects: `confetti`, `fireworks`, `lasers`, `sparkles`, `celebration`, `hearts`, `love`, `balloons`, `happy_birthday`, `echo`, `spotlight`, `slam`, `loud`, `gentle`, `invisible`.

**Then stop and ask:** *"I just sent a confetti effect. Did you see the animation?"* Wait for confirmation.

## Step 8 — React to the user's first message

React to a message the **user** sent, not one you sent. Find it first:

```bash
linq messages list <chat-id> --json
```

Take the most recent message where `is_from_me` is `false` and grab its `id`. Tell the user what is coming:

> *"I'm going to react with ❤️ to the last message you sent me. Watch for it."*

```bash
linq messages react <message-id> --type love --json
```

Reaction types: `love`, `like`, `dislike`, `laugh`, `emphasize`, `question`, `custom` (with `--emoji 🔥`). Add `--operation remove` to undo.

**Then stop and ask:** *"Did you see the ❤️ appear on your message?"* Wait for confirmation.

## Step 9 — Show the typing indicator

Tell the user to look at their phone, then:

```bash
linq chats typing <chat-id>
# wait 5–8 seconds so they have time to notice the bubble
linq chats typing <chat-id> --stop
```

Ask whether they saw the "typing…" bubble appear and disappear.

**If they did not**, the chat is likely stale — Apple only surfaces typing indicators in conversations with recent activity. Wake it and retry once:

```bash
linq chats create --to +1XXXXXXXXXX --message "One more — watch for a typing indicator just below this." --json
```

Wait about a second, then repeat the typing commands. If they still do not see it, move on; do not keep retrying.

## Step 10 — Show live webhook events

This is where the user sees how they would actually build on Linq. Explain first, in your own voice:

> *"Webhooks are how your code finds out things happened — a message came in, someone reacted, someone started typing. `linq webhooks listen` streams those events live as JSON, with no public URL, tunnel, or server setup. You'll text your Linq Number and watch the `message.received` event land in real time. That's the same stream a production server consumes."*

Ask them to open a second terminal and run `linq webhooks listen`. Once they confirm they see "Listening for events...", have them text the Linq Number from their phone and watch for `message.received` within about a second.

**Then stop and ask:** *"Did you see the message.received event?"*

Once confirmed, tell them Ctrl+C stops it, and mention the other two shapes:

- `linq webhooks listen --forward-to http://localhost:3000/webhook` — same stream, also POSTs each event to a local URL while building.
- `linq webhooks create --url https://your-server.com/webhook --all-events` — a durable subscription to a production endpoint.

Production webhooks are signed. The current header is `webhook-signature` (Standard Webhooks, `v1,<base64>`); the older `X-Webhook-Signature` is still sent but deprecated. Do not verify by hand — `@linqapp/sdk` does it via `client.webhooks.unwrap()`. Covered in the `linq-build` skill.

## Step 11 — Managing API tokens

```bash
linq tokens list                          # all tokens on the account
linq tokens show                          # print the token in local config
linq tokens show --copy                   # copy it to the clipboard
linq tokens create --name "<label>"       # mint a new one
linq tokens regenerate <id>               # rotate (revokes the old secret immediately)
# linq tokens delete <id> is interactive-only: it refuses to run in an agent
# shell, and refuses to delete the token you are currently authenticated with.
linq tokens rename <id> --name "<label>"  # relabel (--name is required)
```

Create separate tokens per environment (`prod`, `staging`, `ci`) so one can be revoked without taking everything down.

## Where to go next: write the actual app

The CLI proved the account works. Application code uses the SDK.

```bash
npm install @linqapp/sdk
```

Then switch to the `linq-build` skill, which covers sending from code, receiving webhooks with signature verification, and the production concerns this walkthrough skipped.

## What Linq is built for

iMessage is a peer-to-peer, conversational channel. The strongest fit is **conversational AI** — a real two-way exchange where the agent listens, understands, and replies.

Patterns that do **not** work and risk getting the user's Linq Number flagged or shut down by Apple: one-way blasts, pure outbound marketing or cold outreach, notification-only flows with no expected reply, and anything where the recipient has not opted in conversationally.

If the user describes any of those, redirect toward a conversational design — same product, agent listening and responding rather than broadcasting. For real examples, point them at https://linqapp.com/s/example-apps rather than inventing use cases.

## Links

- CLI source: https://github.com/linq-team/linq-cli
- API docs: https://docs.linqapp.com
- Dashboard: https://dashboard.linqapp.com
