# Documentation

Everything docko ships, grouped by what you are trying to do.

## Get started

- [Quickstart](quickstart.md): install the CLI, create a workspace root, claim and release a slot.
- [Use docko with Claude Code](claude-code.md): install the plugin and let hooks drive docko for you.

## Guides

- [Application slot pools](applications.md): give backend and frontend their own slots.
- [Delegate a slot to a teammate](delegation.md): let a second session write inside your claim.
- [Codex and other AGENTS.md runtimes](agents-md-runtimes.md): guidance-based setup without hooks.
- [Migrate an existing workflow](migration-guide.md): move lock files and naming conventions onto docko.

## Concepts

- [Concepts](concepts.md): workspace root, slot, application, session, claim, delegation.
- [Persistent slots compared with git worktrees](why-not-just-worktrees.md): which model fits.
- [Architecture](architecture.md): how core, CLI, and adapters are split.

## Reference

- [CLI reference](cli-reference.md): every command, option, and payload note.
- [Protocol](protocol.md): claim, delegation, and stale-recovery semantics.
- [State files](state-files.md): the on-disk layout and every registry and session field.
- [Errors](errors.md): error codes, exit codes, and authorization reasons.
- [Adapter specification](adapter-spec.md): the contract for a runtime adapter.

## Troubleshooting

- [Troubleshooting](troubleshooting.md): symptom-first fixes for sessions, claims, writes, and locks.

## Examples

- [Workspace layout](../examples/workspace-layout.md): a fully populated managed workspace.
- [Claude Code hook settings](../examples/claude-code-settings.json): the repo-local settings fragment.

## Project

- [Development](development.md): local setup, verification, and change expectations.
- [Repository structure](repo-structure.md): what each directory owns.
- [Tests](tests.md): the suites and what they cover.
- [Contributing](../CONTRIBUTING.md): commit format and pull request flow.
- [Security](../SECURITY.md): vulnerability reporting and the security-boundary scope note.
- [Changelog](../CHANGELOG.md): published release history.

## Moved and removed pages

- `concepts.md` keeps its filename; `faq.md` now points at the page that owns each answer.
- `contributing.md` is now [development.md](development.md).
- `docs-sync.md`, `agent-onboarding.md`, and `agent-team-kit.md` merged into
  [development.md](development.md) and [delegation.md](delegation.md).
- `public-positioning.md` and `public-copy.md` merged into the [README](../README.md) and
  [why-not-just-worktrees.md](why-not-just-worktrees.md).
- `implementation-roadmap.md` was removed. Roadmap work is tracked in GitHub milestones.
- `examples/claude-commands.md` and `examples/codex-agents.md` merged into
  [claude-code.md](claude-code.md) and [agents-md-runtimes.md](agents-md-runtimes.md).
