---
name: linq-audit
description: Audit this codebase's Linq integration against Linq's published best practices for opt-out compliance, deliverability, chat health, and line reputation. Read-only.
---

You are auditing a codebase that integrates with the Linq Partner API
(iMessage / RCS / SMS messaging). Verify it follows Linq's best practices for
deliverability, chat health, and line reputation. This is READ-ONLY — do not
change code unless I ask.

Step 1 — Ground yourself in Linq's docs. If the Linq MCP server is connected,
use `search_docs` for each area below — it is faster and returns exactly the
relevant sections. Otherwise start with the index at
https://docs.linqapp.com/llms.txt, then fetch the pages you need — at minimum
Best Practices, Chat Health, Phone Reputation, Sending Messages, and Webhooks,
plus the /v3 API reference for the endpoints below. (https://docs.linqapp.com/llms-full.txt
has every page in one file, but it is large — prefer the index and targeted
pages.) If you cannot fetch these, stop and tell me rather than auditing from
memory.

Step 2 — Locate the integration. Search the codebase for the Linq base URL
(api.linqapp.com/api/partner), "/v3/" request paths, an official SDK — Node
`@linqapp/sdk`, Python `linq-python` (imported as `linq`), or Go
`github.com/linq-team/linq-go` — and the inbound webhook handler, so you know
where sending, onboarding, and webhook handling live.

Step 3 — Audit against these requirements. Each item is something my code is
supposed to do — confirm whether it actually does, and cite the file and line:

Opt-out (compliance — most important)
- The code should scan every inbound message on the message.received webhook for
  opt-out keywords — STOP, UNSUBSCRIBE, OPTOUT, CANCEL, END, QUIT (whole message;
  exact and case-sensitive, except OPT OUT which matches in any casing, spaced,
  hyphenated or not) — plus any clear "stop messaging me" intent, and a match
  should immediately stop all outbound to that recipient. Linq rejects sends to
  a keyword-opted-out recipient with 403 (error code 2024), but only the exact
  keywords trigger that block — conversational stop requests are the code's job
  to catch — and a 2024 rejection should be honored, not retried.
- Every send to an opted-out recipient is rejected, including a final courtesy
  message. If the code sends one confirmation telling the recipient they can
  reply any time to resume, that single request should set override_optout: true.
  The override applies only to the request it is set on and does not lift the
  block; each use is recorded, so it should appear once per opt-out, never in a
  retry loop.
- The code should treat a chat whose health_status is OPTED_OUT as never-send
  until Linq clears the status. Linq clears it as soon as the recipient replies
  again in any chat with you (any inbound that is not itself an opt-out
  keyword), so the code should gate on the current health_status rather than
  tracking opt-ins itself.

Sending & line selection
- The code should send with POST /v3/messages using `to` and NO `from`. Linq
  then picks the best line, load-balances across your pool, reuses the
  recipient's existing healthy line, and fails over off a flagged line
  automatically (see from_selection.reason in the response).
- The code should NOT call GET /v3/available_number (or pin a fixed `from`)
  before each send — that defeats the automatic load-balancing and failover.

Onboarding new users
- The code should use GET /v3/available_number when onboarding a NEW user, to
  get the best available line (and its vcf_url contact card) to show them — e.g.
  a number or deeplink shown at signup — so new users spread evenly across the
  pool. That is what available_number is for; it is not a per-message call.

Contact card
- The code should create the contact card once per line with
  POST /v3/contact_card (initial setup only — later changes use
  PATCH /v3/contact_card), and share it through the dedicated
  POST /v3/chats/{chatId}/share_contact_card endpoint.
- New contacts should be inbound-first — let the recipient message first. The
  card should be shared only after at least one outbound message exists in the
  chat, and re-shared about once a day, since there's no confirmation the user
  saved it.

Health & reputation gating
- Before sending, the code should check the chat's health_status and the line's
  reputation from GET /v3/phone_numbers, and slow or pause on AT_RISK /
  CRITICAL. It should also handle the phone_number.status_updated webhook to
  react when a line's reputation changes.
- New users should onboard onto HEALTHY lines. The code should NOT migrate users
  off an AT_RISK line to escape the status — improve engagement and let the line
  recover instead.

Engagement & cadence
- Outbound should be built to get replies (aim for 3+ replies early and roughly
  a 1:2 inbound:outbound ratio). When a recipient stops replying, the code
  should slow down and then stop, rather than keep messaging someone who isn't
  responding.

Volume & ramp
- The code should keep each line under ~7,000 messages/day (inbound + outbound).
  That is a performance guideline, not a reputation threshold — steady high
  volume with healthy reply rates is fine.
- The code should not start roughly 50 or more brand-new conversations per line
  in a rolling 24 hours. Check bulk import, list upload, and campaign kickoff
  paths for anything that opens a whole audience at once, and confirm first
  contact is spread across days and across lines.
- The code should ramp a line's daily volume gradually rather than jumping
  several-fold above what that line has recently been sending. Look for
  scheduled or triggered sends that can take a quiet line to a large day in one
  step.

Step 4 — Report:
1. A table: Check | Status (pass / gap / n/a / unknown) | Where (file:line) | Fix.
2. A short action list, highest deliverability and compliance risk first.
Ground every finding in code you actually read. If you cannot determine an item,
mark it unknown rather than guessing.
