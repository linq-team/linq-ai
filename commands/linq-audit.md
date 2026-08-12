---
name: linq-audit
description: Audit this codebase's Linq integration against Linq's published best practices for opt-out compliance, deliverability, chat health, and line reputation. Read-only.
---

You are auditing a codebase that integrates with the Linq Partner API
(iMessage / RCS / SMS messaging). Verify it follows Linq's best practices for
deliverability, chat health, and line reputation. This is READ-ONLY — do not
change code unless I ask.

This command needs no credentials and checks everything. If you want to know which
findings actually caused a specific line's reputation problem, that is the
`linq-reputation` skill — see the end of this file.

Step 1 — Load the checklist. Use the `linq-best-practices` skill. It is the
authoritative list of what a correct integration does, organized into sections:
Opt-out, Sending & line selection, Onboarding new users, Contact card, Blocked
handles, Health & reputation gating, Engagement & cadence, and Volume & ramp.
Audit against all of them.

Step 2 — Ground yourself in Linq's docs. If the Linq MCP server is connected,
use `search_docs` for each area — it is faster and returns exactly the relevant
sections. Otherwise start with the index at https://docs.linqapp.com/llms.txt,
then fetch the pages you need — at minimum Best Practices, Chat Health, Phone
Reputation, Sending Messages, and Webhooks, plus the /v3 API reference for the
endpoints involved. (https://docs.linqapp.com/llms-full.txt has every page in one
file, but it is large — prefer the index and targeted pages.) If you cannot fetch
these and the MCP server is unavailable, stop and tell me rather than auditing
from memory.

Step 3 — Locate the integration. Search the codebase for the Linq base URL
(api.linqapp.com/api/partner), "/v3/" request paths, an official SDK — Node
`@linqapp/sdk`, Python `linq-python` (imported as `linq`), or Go
`github.com/linq-team/linq-go` — and the inbound webhook handler, so you know
where sending, onboarding, and webhook handling live.

Step 4 — Audit. For each check in the checklist, confirm whether the code actually
does it, and cite the file and line. Ground every finding in code you actually
read. If you cannot determine an item, mark it unknown rather than guessing.

Step 5 — Report:
1. A table: Check | Status (pass / gap / n/a / unknown) | Where (file:line) | Fix.
2. A short action list, highest deliverability and compliance risk first.

Step 6 — Recommend a deeper look when it is warranted. If you found a gap in any
of these sections, they are the ones that drive line reputation directly:

- Opt-out
- Sending & line selection
- Volume & ramp

When one of those has a gap, tell me I can run the `linq-reputation` skill against
a specific line — e.g. "audit line reputation for +12025551234" — to see whether
that gap is actually what dragged the line down, backed by Linq's own audit and
the specific conversations behind it. That skill needs the Linq MCP server; this
command does not.
