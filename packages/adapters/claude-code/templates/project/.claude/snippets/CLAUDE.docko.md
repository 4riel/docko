## docko Workspace Rules

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Start at the workspace root. `docko` walks up to it on its own, so commands also work from inside a slot.
2. Run `/dock-status` or `docko status --brief` once. Read the `summary` block: free/claimed counts, `my_claims`, `stale_candidates`.
3. Pass `--session "$DOCKO_SESSION_ID"` on every claim, heartbeat, and release. The SessionStart hook exports it.
4. Prefer `docko slot acquire --session "$DOCKO_SESSION_ID" --branch <branch> --task "<task>" --brief` when you want docko to choose the slot. Selection is round-robin, starting after the last slot claimed for that application.
5. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
6. Example:
   `docko slot acquire --session "$DOCKO_SESSION_ID" --application backend --branch <branch> --task "update backend auth" --brief`
7. Add `--prefer <slot-id>` when one specific slot is the right one. docko takes it when free and rotates normally when it is not.
8. If every slot is busy and docko asks whether it should create a fresh managed clone, answer explicitly.
9. Use `/dock-claim <slot> <branch> <task>` or `docko claim --session "$DOCKO_SESSION_ID" --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot.
10. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko.
11. Release it with `/dock-release <slot>` or:
    `docko release --session "$DOCKO_SESSION_ID" --resource slot --id <slot>`

Rules:

- Work from the root. Edit code in `slots/*`, not at the root.
- Never invent a session id. The write hook checks the runtime's own session, so a made-up id claims a slot that then blocks your own writes. Use `$DOCKO_SESSION_ID`, or an id from `docko session list --brief`.
- `branch` is claim metadata. docko records it and never runs `git checkout`.
- Claims are slot-scoped. They do not reserve a branch, a PR, or individual files.
- Read the `applications` section from `docko status --brief` when the workspace has multiple app pools.
- If a parent session already owns the slot, reuse that authority. Do not open a second claim for the same slot.
- Subagents started with the Agent tool share the parent's session id and inherit its claim. A separately launched `claude` process needs `docko delegate`.
- If docko reports `AMBIGUOUS_SESSION`, run the `suggested_command` from the error payload; do not end existing sessions unless the user asked for cleanup.
- If a write is blocked, read the deny message: it names the slot, the reason, and the command that fixes it.
- If every slot is busy and the user already approved the fallback, re-run `docko slot acquire` with `--clone-when-busy`.
- If `docko` is not runnable, check `DOCKO_BIN`. If it still fails, stop and tell the user. `/dock-doctor` reports launcher, hook, and binary problems.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback. Use `docko status --brief --claimed`. Only read the registry when the user asked to debug docko itself.
