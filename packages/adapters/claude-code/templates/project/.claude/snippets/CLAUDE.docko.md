## docko Workspace Rules

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Start at the workspace root.
2. Run `/dock-status` or `docko status --root . --brief` once.
3. Prefer `docko slot acquire --root . --branch <branch> --task "<task>" --brief` when you want docko to choose the first free slot.
4. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
5. Example:
   `docko slot acquire --root . --application backend --branch <branch> --task "update backend auth" --brief`
6. If every slot is busy and docko asks whether it should create a fresh managed clone, answer explicitly.
7. Use `/dock-claim <slot> <branch> <task>` or `docko claim --root . --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot.
8. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko.
9. Release it with `/dock-release <slot>` or:
   `docko release --root . --resource slot --id <slot>`

Rules:

- Work from the root. Edit code in `slots/*`, not at the root.
- Read the `applications` section from `docko status --root . --brief` when the workspace has multiple app pools.
- If a parent session already owns the slot, reuse that authority. Do not open a second claim for the same slot.
- If docko reports `AMBIGUOUS_SESSION`, retry with an explicit `--session <id>` from `docko session list --root . --brief`; do not end existing sessions unless the user asked for cleanup.
- If every slot is busy and the user already approved the fallback, re-run `docko slot acquire` with `--clone-when-busy`.
- If `docko` is not runnable, check `DOCKO_BIN`. If it still fails, stop and tell the user.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback. Only do that when the user asked to debug docko itself.
