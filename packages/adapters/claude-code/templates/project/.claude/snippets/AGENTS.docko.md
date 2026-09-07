## docko Working Default

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Work from the workspace root. `docko` walks up to it on its own, so commands also work from inside a slot.
2. Run `docko status --brief` once. Read the `summary` block: free/claimed counts, `my_claims`, `stale_candidates`.
3. Use `docko slot acquire --session <session-id> --branch <branch> --task "<task>" --brief` before writing. Selection is round-robin, starting after the last slot claimed for that application.
4. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
5. Example:
   `docko slot acquire --session <session-id> --application backend --branch <branch> --task "update backend auth" --brief`
6. Add `--prefer <slot-id>` when one specific slot is the right one.
7. If docko asks whether it should create a fresh managed clone because all slots are busy, answer explicitly.
8. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko.
9. Release it when done:
   `docko release --session <session-id> --resource slot --id <slot>`

Rules:

- Work from the root. Do code work inside `slots/*`.
- Reuse `DOCKO_SESSION_ID` when a runtime already set it. Otherwise choose a unique session ID for the run and use it consistently.
- `branch` is claim metadata. docko records it and never runs `git checkout`.
- Claims are slot-scoped. They do not reserve a branch, a PR, or individual files.
- Read the `applications` section from `docko status --brief` when the workspace has multiple app pools.
- If docko reports `AMBIGUOUS_SESSION`, run the `suggested_command` from the error payload, or retry with an explicit `--session <id>` from `docko session list --brief`; do not end existing sessions unless the user asked for cleanup.
- If every slot is busy and the user already approved the fallback, add `--clone-when-busy` to `docko slot acquire`.
- Releasing a claim owned by another session requires `--force`, and the release is recorded with `forced_by_session_id`.
- If `docko` is not on PATH, try `DOCKO_BIN`. If it still is not runnable, stop and tell the user.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback. Use `docko status --brief --claimed`.
- Delegated Claude teammates inherit parent slot authority when the parent already owns the slot.
- Do not assume Codex subagents inherit Docko session or slot authority automatically. Docko does not ship a Codex adapter yet.
