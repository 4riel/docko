---
description: Refresh the heartbeat for a claimed docko slot
argument-hint: <slot>
---

Refresh the heartbeat for the claimed slot owned by the current Claude session.

Argument: `$1` is the slot id.

Claude should already have a current `docko` session from the installed hooks, so the CLI can resolve the session automatically. If the CLI reports `AMBIGUOUS_SESSION`, run `docko session list --root . --brief`, retry with the correct `--session <id>`, and do not end existing sessions unless the user asked for cleanup.

Run:

```bash
docko heartbeat --root . --resource slot --id "$1"
```
