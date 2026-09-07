---
description: Release a previously claimed docko slot
argument-hint: <slot>
---

Release a previously claimed `docko` slot.

Argument: `$1` is the slot id.

The docko SessionStart hook exports `DOCKO_SESSION_ID` for this session, so pass `--session "$DOCKO_SESSION_ID"` when the variable is set. If it is not set, take the id from `docko session list --brief` and pass it explicitly. Never invent a session id.

Run:

```bash
docko release --session "$DOCKO_SESSION_ID" --resource slot --id "$1"
```

Expected failures:

- `RESOURCE_NOT_CLAIMED` — the slot is already free (the janitor or a session end released it). Nothing to do.
- `RESOURCE_OWNED_BY_OTHER_SESSION` — another session owns the claim. Stop and explain why; only add `--force` when the user asks for a takeover.
