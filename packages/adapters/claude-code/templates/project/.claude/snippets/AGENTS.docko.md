## docko Working Default

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Work from the workspace root.
2. Run `docko status --root . --brief` once.
3. Use `docko slot acquire --root . --session <session-id> --branch <branch> --task "<task>" --brief` before writing.
4. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
5. Example:
   `docko slot acquire --root . --session <session-id> --application backend --branch <branch> --task "update backend auth" --brief`
6. If docko asks whether it should create a fresh managed clone because all slots are busy, answer explicitly.
7. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko.
8. Release it when done:
   `docko release --root . --session <session-id> --resource slot --id <slot>`

Rules:

- Work from the root. Do code work inside `slots/*`.
- Reuse `DOCKO_SESSION_ID` when a runtime already set it. Otherwise choose a unique session ID for the run.
- Read the `applications` section from `docko status --root . --brief` when the workspace has multiple app pools.
- If docko reports `AMBIGUOUS_SESSION`, retry with an explicit `--session <id>` from `docko session list --root . --brief`; do not end existing sessions unless the user asked for cleanup.
- If every slot is busy and the user already approved the fallback, add `--clone-when-busy` to `docko slot acquire`.
- If `docko` is not on PATH, try `DOCKO_BIN`. If it still is not runnable, stop and tell the user.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback.
- Delegated Claude teammates inherit parent slot authority when the parent already owns the slot.
