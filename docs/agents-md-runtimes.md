# Codex and other AGENTS.md runtimes

Codex and other runtimes that read `AGENTS.md` can use docko without an installed adapter. Use
this page to prepare the guidance file and confirm the CLI works before you rely on it.

## What guidance-based support means

docko does not ship `packages/adapters/codex`, Codex installer templates, or Codex adapter tests.
There are no hooks and no automatic write enforcement for Codex.

A guidance-based runtime reads `AGENTS.md` and follows the written rules. Nothing calls the
`docko` CLI for you, and nothing blocks a write outside a claimed slot. The model has to run
`docko` itself, the way the guidance block tells it to.

Claude Code is the only implemented runtime adapter today. See
[Adapter specification](adapter-spec.md) for what a runtime needs before docko documents it the
same way.

## Prepare the guidance

`docko init` can note where Codex guidance belongs and write it for you.

```bash
docko init --root ./workspace --codex --inject-codex
```

```json
{
  "codex": {
    "agents_file": "workspace/AGENTS.md"
  },
  "injected_files": [
    { "file": "workspace/AGENTS.md", "injected": true, "target": "codex" }
  ]
}
```

- `--codex` alone only records the target path in `codex.agents_file`. It writes nothing.
- `--inject-codex` writes the guidance block into that file, wrapped in
  `<!-- docko:begin:codex -->` and `<!-- docko:end:codex -->` markers so a later run does not
  duplicate it.
- `--agents-file <path>` overrides the target. The default is `AGENTS.md` at the workspace root.

Run this once per workspace. `--inject-codex` is a no-op on a file that already has the block.

## The AGENTS.md block

This is the guidance `--inject-codex` writes. Paste it by hand into an existing `AGENTS.md`
instead if you already manage that file another way.

```md
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
8. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by docko.
9. Release it when done:
   `docko release --session <session-id> --resource slot --id <slot>`

Rules:

- Work from the root. Do code work inside `slots/*`.
- Reuse `DOCKO_SESSION_ID` when a runtime already set it. Otherwise choose a unique session ID for the run and use it consistently.
- `branch` is claim metadata. docko records it and never runs `git checkout`.
- Claims are slot-scoped. They do not reserve a branch, a PR, or individual files.
- Read the `applications` section from `docko status --brief` when the workspace has more than one application slot pool.
- If docko reports `AMBIGUOUS_SESSION`, run the `suggested_command` from the error payload, or retry with an explicit `--session <id>` from `docko session list --brief`; do not end existing sessions unless the user asked for cleanup.
- If every slot is busy and the user already approved the fallback, add `--clone-when-busy` to `docko slot acquire`.
- Releasing a claim owned by another session requires `--force`, and the release is recorded with `forced_by_session_id`.
- If `docko` is not on PATH, try `DOCKO_BIN`. If it still is not runnable, stop and tell the user.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback. Use `docko status --brief --claimed`.
- Delegated Claude teammates inherit parent slot authority when the parent already owns the slot.
- Do not assume Codex subagents inherit docko session or slot authority automatically. docko ships no Codex adapter.
```

## Verify the setup

Run these once by hand to confirm the workspace is ready before Codex relies on the guidance.

```bash
docko status --root ./workspace --brief
```

```json
{
  "slots": { "total": 1, "free": 1, "claimed": 0 },
  "summary": { "my_claims": [], "stale_candidates": [] }
}
```

```bash
docko session start --root ./workspace --session ses_codex1 --runtime codex
docko slot acquire --root ./workspace --session ses_codex1 --branch docs/example --task "verify codex setup" --brief
```

```json
{
  "ok": true,
  "action": "claimed-existing-slot",
  "session_id": "ses_codex1",
  "slot_id": "main"
}
```

Release the slot when you finish testing.

```bash
docko release --root ./workspace --session ses_codex1 --resource slot --id main --brief
```

## Next steps

- [Application slot pools](applications.md): give a backend and a frontend their own slot pools.
- [Delegate a slot to a teammate](delegation.md): let a second Codex process write in a slot you
  already own.
- [CLI reference](cli-reference.md): look up every flag and payload field, including `--brief`.
- [Troubleshooting](troubleshooting.md): fixes for ambiguous sessions, busy slots, and denied
  writes.

## Related

- [Adapter specification](adapter-spec.md)
- [Use docko with Claude Code](claude-code.md)
- [Concepts](concepts.md)
