---
description: Claim a writable docko slot for the current Claude session
argument-hint: <slot> <branch> <task...>
---

Claim a writable `docko` slot for the current Claude session.

Use this after `/dock-status` identifies a specific free slot. Do not guess a slot by manually browsing folders first.

Arguments: `$1` is the slot id, `$2` is the branch name, and everything after the branch is the task description.

The docko SessionStart hook exports `DOCKO_SESSION_ID` for this session, so pass `--session "$DOCKO_SESSION_ID"` when the variable is set. If it is not set, take the id from `docko session list --brief` and pass it explicitly. Never invent a session id: the write hook checks the runtime's own session, so a made-up one blocks every later edit.

Run (replace `<task>` with the task description words):

```bash
docko claim --session "$DOCKO_SESSION_ID" --resource slot --id "$1" --branch "$2" --task "<task>"
```

`branch` is claim metadata only — docko records it, it never runs `git checkout`.

If no free slot exists and the user wants docko to create a fresh managed clone, run `docko slot acquire --session "$DOCKO_SESSION_ID" --clone-when-busy --branch "$2" --task "<task>" --brief` instead.
