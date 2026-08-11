---
name: linq-best-practices
description: The canonical checklist for a healthy Linq integration — opt-out compliance, line selection and load balancing, onboarding, contact cards, blocked handles, health gating, engagement, and volume. Use when auditing or reviewing code that sends through Linq, or when another skill needs the authoritative wording for a specific check.
---

# Linq integration checklist

The single source of truth for what a correct Linq integration does. The
`/linq-audit` command sweeps all of it; the `linq-reputation` skill routes into
individual sections based on what an audit says is actually wrong. Change a check
here and both surfaces get it.

Each item is something the integrating code is supposed to do. When auditing,
confirm whether it actually does, and cite `file:line`. If you cannot determine an
item, mark it **unknown** rather than guessing.

Section names are stable — other skills reference them by heading.

## Opt-out

Compliance. The most important section here, and the one where a wrong "fix" is a
legal problem rather than a deliverability one. Never rewrite opt-out handling
silently; propose the change and let a human apply it.

- Scan every inbound message on the `message.received` webhook for opt-out
  keywords — STOP, UNSUBSCRIBE, OPTOUT, CANCEL, END, QUIT (whole message; exact
  and case-sensitive, except OPT OUT which matches in any casing, spaced,
  hyphenated or not) — plus any clear "stop messaging me" intent. A match should
  immediately stop all outbound to that recipient. Linq rejects sends to a
  keyword-opted-out recipient with `403` (error code `2024`), but only the exact
  keywords trigger that block. Conversational stop requests are the code's job to
  catch, and a `2024` rejection should be honored, not retried.
- Every send to an opted-out recipient is rejected, including a final courtesy
  message. If the code sends one confirmation telling the recipient they can reply
  any time to resume, that single request should set `override_optout: true`. The
  override applies only to the request it is set on and does not lift the block.
  Each use is recorded, so it should appear once per opt-out, never in a retry loop.
- Treat a chat whose `health_status` is `OPTED_OUT` as never-send until Linq clears
  it. Linq clears it as soon as the recipient replies again in any chat with you
  (any inbound that is not itself an opt-out keyword), so gate on the current
  `health_status` rather than tracking opt-ins yourself.

## Sending & line selection

This is the load-balancing section. Bypassing it is the most common cause of one
line carrying traffic that should have been spread across the pool.

- Send with `POST /v3/messages` using `to` and **no** `from`. Linq then picks the
  best line, load-balances across the pool, reuses the recipient's existing healthy
  line, and fails over off a flagged line automatically. The response explains the
  choice in `from_selection.reason` — `reused_active_chat`, `new_best_number`, or
  `failover_flagged`.
- Do **not** call `GET /v3/available_number`, or pin a fixed `from`, before each
  send. Either defeats automatic load balancing and failover. A hardcoded `from`
  anywhere in a send path is a finding.

## Onboarding new users

- Use `GET /v3/available_number` when onboarding a **new** user, to get the best
  available line and its `vcf_url` contact card to show them — a number or deeplink
  at signup — so new users spread evenly across the pool. That is what
  `available_number` is for; it is not a per-message call.

## Contact card

- Create the contact card once per line with `POST /v3/contact_card` (initial setup
  only — later changes use `PATCH /v3/contact_card`), and share it through the
  dedicated `POST /v3/chats/{chatId}/share_contact_card` endpoint.
- New contacts should be inbound-first — let the recipient message first. Share the
  card only after at least one outbound message exists in the chat, and re-share
  about once a day, since there is no confirmation the user saved it.

## Blocked handles

Partner-initiated filtering, distinct from opt-out: opt-out is the recipient asking
you to stop, blocking is you refusing traffic from a handle.

- Inbound from a blocked handle is dropped and produces no webhooks. If the code
  maintains its own suppression list for abusive or spam senders, prefer
  `POST /v3/blocked_handles` so the filtering happens before it reaches your
  webhook at all, rather than receiving and discarding.
- `GET /v3/blocked_handles` lists them and `DELETE /v3/blocked_handles` removes one.
  Code that blocks should have a path to unblock — a one-way list becomes a support
  problem.
- Do not use blocking as a substitute for opt-out handling. A recipient who texts
  STOP must be handled by the opt-out path; blocking them instead skips the
  compliance record.

## Health & reputation gating

- Before sending, check the chat's `health_status` and the line's `reputation` from
  `GET /v3/phone_numbers`, and slow or pause on `AT_RISK` / `CRITICAL`.
- Handle the `phone_number.status_updated` webhook so the code reacts when a line's
  reputation changes, rather than discovering it on the next send.
- Onboard new users onto `HEALTHY` lines. Do **not** migrate users off an `AT_RISK`
  line to escape the status — improve engagement and let the line recover. Migration
  spreads the problem and resets nothing.

## Engagement & cadence

- Outbound should be built to get replies — aim for 3+ replies early and roughly a
  1:2 inbound:outbound ratio.
- When a recipient stops replying, slow down and then stop. Continuing to message
  someone who is not responding is the single clearest one-sided-conversation signal.

## Volume & ramp

- Keep each line under roughly 7,000 messages/day (inbound + outbound). This is a
  performance guideline, not a reputation threshold — steady high volume with
  healthy reply rates is fine.
- Do not start roughly 50 or more brand-new conversations per line in a rolling 24
  hours. Check bulk import, list upload, and campaign kickoff paths for anything
  that opens a whole audience at once, and confirm first contact is spread across
  days and across lines.
- Ramp a line's daily volume gradually rather than jumping several-fold above what
  it has recently been sending. Look for scheduled or triggered sends that can take
  a quiet line to a large day in one step.
