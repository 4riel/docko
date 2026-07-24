Claim a writable `docko` slot for the current Claude session.

Use this after `/dock-status` identifies a specific free slot. Do not guess a slot by manually browsing folders first.

Arguments:

- `$ARGUMENTS[0]`: slot id
- `$ARGUMENTS[1]`: branch name
- `$ARGUMENTS[2...]`: task description

Claude should already have a current `docko` session from the installed hooks, so the CLI can resolve the session automatically. If the CLI reports `AMBIGUOUS_SESSION`, run `docko session list --root . --brief`, retry with the correct `--session <id>`, and do not end existing sessions unless the user asked for cleanup.

Run:

```bash
docko claim --root . --resource slot --id "$ARGUMENTS[0]" --branch "$ARGUMENTS[1]" --task "$ARGUMENTS[2...]"
```

If no free slot exists and the user wants docko to create a fresh managed clone, run `docko slot acquire --root . --clone-when-busy --branch "$ARGUMENTS[1]" --task "$ARGUMENTS[2...]" --brief` instead.
