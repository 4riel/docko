# Claude Command Examples

These are examples of the shipped Claude command files under `.claude/commands/`. They are Claude-specific, not generic Docko commands for every runtime.

- `/dock-status`
- `/dock-claim <slot> <branch> <task...>`
- `/dock-release <slot>`
- `/dock-heartbeat <slot>`

These should remain thin wrappers over the public CLI so protocol changes stay centralized.

The installed command bodies assume Claude's hook-managed session context, so `docko claim`, `docko release`, and `docko heartbeat` can resolve the current session without an explicit `--session`.

Prefer shell-neutral command bodies in the installed command files so the same workflow reads cleanly in PowerShell, `cmd.exe`, and POSIX shells.
