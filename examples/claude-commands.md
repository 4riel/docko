# Claude Command Examples

These are examples of the shipped Claude command files under `.claude/commands/`. They are Claude-specific, not generic Docko commands for every runtime.

- `/dock-status`
- `/dock-claim <slot> <branch> <task...>`
- `/dock-release <slot>`
- `/dock-heartbeat <slot>`
- `/dock-doctor`

These should remain thin wrappers over the public CLI so protocol changes stay centralized.

The installed command bodies pass `--session "$DOCKO_SESSION_ID"`, which the SessionStart hook exports for the session. They do not pass `--root`: docko walks up from the current directory to the workspace root, so the same command works from inside a slot.

Prefer shell-neutral command bodies in the installed command files so the same workflow reads cleanly in PowerShell, `cmd.exe`, and POSIX shells.
