# Changelog

All notable changes to `docko-workspace` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (currently in the `0.1.0-alpha.x` prerelease line).

## [Unreleased]

### Added

- The stale janitor now ends sessions that stop reporting activity, using the new
  `config.janitor.session_stale_after_ms` knob (default 8 hours, also settable with
  `init --session-stale-after-ms`). Sessions are swept after claim recovery and a session that still
  owns or is delegated a live claim is never ended. `docko status` reports them under
  `janitor.ended_sessions` and the debug log records `stale-session-recovery`.
- `docko session prune` runs the same sweep on demand, with `--max-age-ms <n>` to override the window
  for one run, `--dry-run` to preview without writing, and `--brief` for compact agent output.
- Ended session manifests now live in `docko/sessions/ended/`, are deleted after a seven-day
  retention window, and `session prune` reports `retention_ms` and `deleted_manifests`. Legacy
  workspaces are migrated lazily on the next janitor pass.
- Resources record the last released claim as `last_claim` (owner, release time, reason, branch,
  task, stale window), so a denied write can explain why a slot is free. The field is optional in
  `schemas/registry.schema.json`.
- The write-authorization result now carries `owner_task`, `owner_branch`, `owner_session_active`,
  `expired_at`, `claim_stale_after_ms`, and `previous_owner_session_id`, and core exports the closed
  reason vocabulary as `AUTHORIZATION_REASONS`.
- The registry lock directory records its holder in `owner.json` (`pid`, `hostname`, `acquired_at`),
  and `REGISTRY_LOCK_TIMEOUT` now reports the lock directory, the wait duration, and that owner.

### Changed

- Write checks for paths outside every managed slot are answered from an unlocked registry read: no
  lock, no session touch, no writes. Only slot paths take the locked path, where an allowed write by
  the owner or a delegate refreshes the claim heartbeat (throttled to once every 30 seconds).
- Authorization reasons are now `path-not-managed`, `owner`, `delegated`, `slot-not-claimed`,
  `claim-expired`, and `unrelated-session`. `owner-session` became `owner` and `delegated-child`
  became `delegated`.
- The default `session_stale_after_ms` dropped from 24 hours to 8 hours.
- One automatic janitor pass now ends at most 100 stale sessions (reporting
  `janitor.ended_sessions_truncated`) and deletes at most 200 expired manifests
  (`janitor.deleted_manifests`), so a long-idle workspace cannot hold the lock for minutes.
- `AMBIGUOUS_SESSION` reports `active_session_count`, the 10 newest candidates, and
  `newest_session_id` instead of every active session.
- An environment session id that matches no active session no longer shadows single-active
  resolution.
- The registry lock waits up to 10 seconds with jittered backoff, breaks a lock abandoned for more
  than 30 seconds immediately instead of waiting out the timeout, and retries recovery.
- Debug log retention is enforced once per process instead of on every append.

### Fixed

- Abandoned sessions no longer accumulate as active forever when a runtime crashes without calling
  `session end`, which made `docko session list` grow unbounded.
- Atomic writes now use a sibling temp file and retry a rename that fails with `EPERM`, `EBUSY`,
  `EACCES`, or `ENOTEMPTY`, which is the Windows failure mode when a file scanner or a concurrent
  reader holds the destination open. Exhausting the retry budget raises `ATOMIC_WRITE_FAILED`
  naming the file, and temp artifacts left by killed processes are swept once per process.
- Read-only commands (`status`, `session list`, `logs`) no longer rewrite `registry.json` and
  `registry.md` when the janitor changed nothing.
- Rendering `registry.md` is best effort: a failed mirror write is logged instead of failing the
  command.
- A registry-backed command on a root with no `docko/` directory now fails with
  `WORKSPACE_NOT_INITIALIZED` and an actionable `docko init` message instead of a raw `ENOENT`.

## [0.1.0-alpha.15]

### Added

- Tracked the generated Claude Code commands, skill, snippets, settings fragment, and repo-local
  plugin bundle so this repository exercises the same integration assets it ships to adopters.

### Changed

- Reorganized repository guidance and documentation around the public `docko status`, round-robin
  `slot acquire`, busy-slot cloning, and explicit session-resolution workflow.
- Updated `actions/setup-node` to v7 and refreshed the compatible development toolchain, including
  c8 12, ESLint 10.7, Prettier 3.9.6, and typescript-eslint 8.65 while retaining TypeScript 6.0.
- Updated Codex hook documentation to match current OpenAI guidance without presenting Codex as a
  first-class Docko adapter.

### Fixed

- Scoped generated workspace directories out of linting and configured the TypeScript ESLint
  project root explicitly.
- Preserved executable permissions on the packaged CLI launcher.

## [0.1.0-alpha.14]

### Added

- Repository hardening: CI (build/check/test on Linux + Windows), CodeQL scanning, Dependabot,
  ESLint + Prettier, commit and pre-commit hooks, a provenance-enabled release workflow, and
  community health files.

### Changed

- Rewrote the README for a shorter, more didactic flow (tagline + badges, three quickstart paths,
  deep content linked into `docs/`), and documented all four Claude hooks including SubagentStart.
- Bumped CI actions (checkout, setup-node, pnpm/action-setup, codeql-action) and the TypeScript
  toolchain to 6.0 with `@types/node` 26; added `ignoreDeprecations` and an explicit `types: ["node"]`
  so the build and full test suite pass on the new compiler.
- Normalized the `LICENSE` copyright holder to the `4riel` handle used across the project.

## [0.1.0-alpha.13]

### Added

- `slot acquire` now rotates round-robin per application, tracking the last claimed slot in
  `config.scheduler.last_slot_id` so the just-released slot is picked last.

### Fixed

- Root resolution walks up to the nearest workspace that owns `docko/registry.json`, and an
  explicit `--root` inside a managed slot is refused with `ROOT_INSIDE_SLOT` instead of
  fragmenting state into the slot.
- The Claude adapter now stamps `plugin.json` with the live package version on every install
  instead of copying a hardcoded literal, and its hook launcher only opts into a shell on Windows.

[Unreleased]: https://github.com/4riel/docko/compare/v0.1.0-alpha.15...HEAD
[0.1.0-alpha.15]: https://github.com/4riel/docko/compare/v0.1.0-alpha.14...v0.1.0-alpha.15
[0.1.0-alpha.14]: https://github.com/4riel/docko/compare/v0.1.0-alpha.13...v0.1.0-alpha.14
[0.1.0-alpha.13]: https://github.com/4riel/docko/releases/tag/v0.1.0-alpha.13
