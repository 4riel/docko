---
description: Refresh the heartbeat for a claimed docko slot
argument-hint: <slot>
---

Refresh the heartbeat for the claimed slot owned by the current Claude session.

Argument: `$1` is the slot id.

The docko SessionStart hook exports `DOCKO_SESSION_ID` for this session, so pass `--session "$DOCKO_SESSION_ID"` when the variable is set. If it is not set, take the id from `docko session list --brief` and pass it explicitly. Never invent a session id.

Run:

```bash
docko heartbeat --session "$DOCKO_SESSION_ID" --resource slot --id "$1"
```

Use this when `docko status --brief` lists the claim under `summary.stale_candidates`, or before a long stretch of work that does not write inside the slot.
