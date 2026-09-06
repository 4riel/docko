---
description: Claim a writable docko slot for the current Claude session
argument-hint: <slot> <branch> <task...>
---

Claim a writable `docko` slot for the current Claude session.

Use this after `/dock-status` identifies a specific free slot. Do not guess a slot by manually browsing folders first.

Arguments: `$1` is the slot id, `$2` is the branch name, and everything after the branch is the task description.

Claude should already have a current `docko` session from the installed hooks, so the CLI can resolve the session automatically. If the CLI reports `AMBIGUOUS_SESSION`, run `docko session list --root . --brief`, retry with the correct `--session <id>`, and do not end existing sessions unless the user asked for cleanup.

Run (replace `<task>` with the task description words):

```bash
docko claim --root . --resource slot --id "$1" --branch "$2" --task "<task>"
```

If no free slot exists and the user wants docko to create a fresh managed clone, run `docko slot acquire --root . --clone-when-busy --branch "$2" --task "<task>" --brief` instead.
