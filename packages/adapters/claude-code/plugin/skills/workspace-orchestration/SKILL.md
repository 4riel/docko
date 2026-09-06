---
name: workspace-orchestration
description: |
  Use when working in a persistent-slot workspace that uses docko. Covers slot claims,
  delegated teammate inheritance, and the rule that code edits inside slots/ require an active claim.
---

# docko Workspace Orchestration

Use this skill whenever work touches files in `slots/` or when the user asks about workspace coordination.

## Quick Path

1. Start at the workspace root.
2. Run `/dock-status` or `docko status --root . --brief`.
3. Prefer `docko slot acquire --root . --branch <branch> --task "<task>" --brief` when you want docko to choose the first free slot.
4. If every slot is busy and docko asks whether it should create a fresh managed clone, answer explicitly.
5. Use `docko claim --root . --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot.
6. Do the work inside that slot.
7. Release the slot when done:
   `docko release --root . --resource slot --id <slot>`

Prefer slash commands when installed:

- `/dock-status`
- `/dock-claim <slot> <branch> <task>`
- `/dock-heartbeat <slot>`
- `/dock-release <slot>`

## Rules

- Work from the root. Edit code in `slots/*`.
- If a parent session already owns the slot, reuse that authority instead of creating a second claim.
- If docko reports `AMBIGUOUS_SESSION`, retry with an explicit `--session <id>` from `docko session list --root . --brief`; do not end existing sessions unless the user asked for cleanup.
- If every slot is busy and the user already approved the fallback, add `--clone-when-busy` to `docko slot acquire`.
- If `docko` is not runnable, check `DOCKO_BIN`. If it still fails, stop and tell the user.
- Do not inspect slots one by one or replace the CLI with `docko/registry.json` during normal work.
