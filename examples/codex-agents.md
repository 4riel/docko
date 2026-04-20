# Codex AGENTS.md Example

This is a manual Docko example for Codex. It is not an installed adapter asset.

```md
## docko Working Default

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Work from the workspace root.
2. Run `docko status --root . --brief`.
3. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
4. Reuse `DOCKO_SESSION_ID` if it already exists. Otherwise choose a unique session ID for the run.
5. Claim or acquire the slot before writing:
   `docko slot acquire --root . --session <session-id> --application backend --branch <branch> --task "update backend auth" --brief`
6. Use `docko claim --root . --session <session-id> --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot id.
7. Release it when done:
   `docko release --root . --session <session-id> --resource slot --id <slot>`

Rules:

- Work from the root. Do code work inside `slots/*`.
- Read the `applications` section from `docko status --root . --brief` when the workspace has multiple app pools.
- If docko reports `AMBIGUOUS_SESSION`, retry with an explicit `--session <id>` from `docko session list --root . --brief`; do not end existing sessions unless the user asked for cleanup.
- If no free slot exists, stop and report the conflict.
- If `docko` is not runnable, try `DOCKO_BIN`. If it still fails, stop and tell the user.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback.
- Do not assume Codex subagents inherit Docko slot authority automatically. This repo does not ship a first-class Codex adapter.
```

OpenAI's Codex docs currently document `AGENTS.md`, repo skills, and explicit subagent workflows. They also document hooks as experimental and currently disabled on Windows. That is why this example stays instruction-first instead of prescribing a hook-based Docko integration for Codex.
