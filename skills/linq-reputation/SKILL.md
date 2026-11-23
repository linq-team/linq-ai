---
name: linq-reputation
description: Diagnose why a Linq line is Needs Attention or Delivery Limited (NEEDS_ATTENTION / DELIVERY_LIMITED, legacy AT_RISK / CRITICAL), or flagged, and find the code responsible. Runs a reputation audit through the Linq MCP server, maps each driver to the integration checks it implicates, and proposes fixes. Use when someone asks to audit or fix line reputation, why a line got flagged, or why messages stopped being delivered.
---

# Diagnose and fix line reputation

Starts from what a line's reputation actually is, not from a generic sweep. The
audit says which drivers are dragging the line down; this skill turns those into
the specific code that caused them.

Requires the Linq MCP server. If it is not connected, say so and run the
`/linq-audit` command instead — it needs no credentials and sweeps everything,
just without knowing which findings actually matter for this line.

## What this skill will and will not do

**It proposes changes. It never applies them.** Report findings and show diffs;
let the developer apply them. This holds for every finding, not just the
compliance ones.

**A code fix does not repair a reputation.** Reputation recovers from subsequent
sending behavior. Fixing the loop that spiked a line stops the cause; the line
recovers as it sends cleanly from then on. Never tell someone their reputation is
fixed — say what was causing it and what changes now. For a `flagged` line, the
honest answer is to move active traffic off it and let it recover.

## Step 1 — Triage the pool

One cheap call, no audit needed:

```
GET /v3/phone_numbers   →   client.phoneNumbers.list()
```

Each line carries `reputation.state`, `reputation.reason_codes` (what is behind
the state, in the same vocabulary as the audit's driver keys) and a `doc_url`.
Rank on `state`, and show each line's `reason_codes` beside it:

- `DELIVERY_LIMITED` (Delivery Limited): outbound messages are not being
  delivered. Worst.
- `NEEDS_ATTENTION` (Needs Attention): a sustained pattern that needs a change in
  how the line is used.
- `WATCH` (Watch): a recent change that usually settles on its own. No action
  needed, so do not offer it for audit unless the user names it.
- `HEALTHY` (Healthy): in good standing.

`reputation.status` is the legacy field derived from `state` (`NEEDS_ATTENTION`
reports `AT_RISK`, `DELIVERY_LIMITED` reports `CRITICAL`, `HEALTHY` and `WATCH`
report `HEALTHY`). If the user says a line is "at risk" or "critical", map it to
the state name when you report.

- If the user named a line, audit that one.
- If they did not, show the Needs Attention and Delivery Limited lines ranked
  worst-first and ask which to audit. Do not audit the whole pool unprompted.
  Each audit is a separate job.

## Step 2 — Run the audit

```
POST /v3/phone_numbers/{phoneNumber}/reputation_audit        → { audit_id, status }
GET  /v3/phone_numbers/{phoneNumber}/reputation_audit/{id}   → { status, report }
```

Poll the GET until `status` is `complete` or `error`.

Handle these, they are normal:

- **`409`** — an audit is already running for this line. Poll the existing one
  rather than starting another.
- **`429`** — cooldown since the last audit. `Retry-After` carries the wait. Tell
  the user when they can re-run; do not spin.
- **`404` on the audit endpoints, or no such SDK method** — this API may not be
  available on the caller's SDK version. Fall back: report `reputation.state`
  and `reputation.reason_codes` from Step 1, note that the audit's per-chat
  evidence is unavailable, and run the full `linq-best-practices` checklist
  instead of a targeted one. Use the `reason_codes` with the Step 3 table to say
  which sections matter most. Say that is what you
  are doing.

Each `execute` call is capped near 5 minutes total with 30 seconds per request. If
the audit has not completed by then, return the `audit_id`, tell the user, and
fetch the result in a follow-up call rather than burning the sandbox on a poll loop.

## Step 3 — Route drivers to checks

The report's `drivers[]` each carry a `key`, a one-sentence `summary`, and often a
`metric`. `evidence.unhealthy_chats[]` carries the specific `chat_id`s behind
them, each with its own `driver_keys` — those are the conversations to cite.

Load the `linq-best-practices` skill and audit **only** the sections a driver
implicates:

| Driver | Section to audit | Look for |
|---|---|---|
| `volume_spike` | Volume & ramp | Scheduled or triggered sends that take a quiet line to a large day in one step |
| `new_conversation_rate` | Volume & ramp | Bulk import, list upload, campaign kickoff — anything opening a whole audience at once |
| `opt_out_handling` | Opt-out (all of it) | Keyword scan on `message.received`, `403`/`2024` handling, `override_optout` in a retry loop |
| `flagged` | Sending & line selection | A hardcoded `from`, or `available_number` called per send — both defeat failover off a flagged line |
| `low_engagement` | Engagement & cadence | **Report only.** Content and targeting, not code |
| `overall_conversation_health` | rollup of the above | **Report only.** Audit whatever other drivers appear alongside it |
| `other` | — | Report the `summary` verbatim; do not invent a code cause |

Auditing sections no driver implicates is noise. If the user wants the full sweep,
that is what `/linq-audit` is for.

## Step 4 — Find the code

Locate the integration the same way `/linq-audit` does: search for the Linq base
URL (`api.linqapp.com/api/partner`), `/v3/` request paths, an official SDK
(`@linqapp/sdk`, `linq-python`, `github.com/linq-team/linq-go`), and the inbound
webhook handler.

Ground every finding in code you actually read, and cite `file:line`. If a driver
fires but the responsible code is not in this repository — sending happens in
another service, a scheduler you cannot see — say exactly that. Do not attribute a
driver to unrelated code because it was the closest match.

## Step 5 — Report

1. **What the line's state is**: the state name, and each driver with its `summary`
   and `metric`.
2. **What the code does** — table of Driver | Check | Status (pass / gap / unknown)
   | Where (`file:line`).
3. **Proposed changes** — a diff per gap, with the driver it addresses. Say plainly
   that you have not applied them.
4. **Not a code problem** — for `low_engagement`, `overall_conversation_health`, or
   `flagged`, name the cause and pass through the driver's own guidance, which
   already reads as advice. For `flagged`, lead with moving traffic off the line.
5. **What happens next** — which changes stop which driver from recurring, and that
   recovery follows sending behavior over time.

Cite `evidence.unhealthy_chats[].chat_id` where it supports a finding — those are
the partner's own conversations, verifiable against their send logs with
`GET /v3/chats/{chatId}`.

If every implicated check passes, say so. A clean integration with a bad
reputation is a real outcome, and inventing a code change to look productive
wastes the developer's time and buries the actual cause.
