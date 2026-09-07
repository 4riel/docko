---
description: Diagnose the repo-local docko Claude Code install
argument-hint: [--fix]
---

Diagnose this project's repo-local `docko` Claude Code integration.

Run:

```bash
docko adapter claude-code doctor
```

Add `--fix` only when the report lists fixable issues and the user agrees:

```bash
docko adapter claude-code doctor --fix
```

The report covers:

- `launcher` — whether the installed hook launcher exists and matches the shipped version.
- `settings_files` — docko hook registrations in `.claude/settings.json` and `.claude/settings.local.json`, including duplicates and entries pointing at launchers that no longer exist. `--fix` removes those stale entries.
- `docko_binary` — whether `docko` resolves from PATH or `DOCKO_BIN`, or falls back to a slow `npx` cold start.
- `session` — the session id this shell sees (`DOCKO_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`).

If `launcher.up_to_date` is false, re-run `docko adapter claude-code install` to refresh it.
