# Changelog

All notable changes to `docko-workspace` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (currently in the `0.1.0-alpha.x` prerelease line).

## [Unreleased]

## [0.1.0-alpha.16]

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
  `expired_at`, `claim_stale_after_ms`, `previous_owner_session_id`, `application_id`, and
  `slot_path`, and core exports the closed reason vocabulary as `AUTHORIZATION_REASONS`. The
  Claude Code deny message uses `application_id` to render a usable `--application` flag.
- The registry lock directory records its holder in `owner.json` (`pid`, `hostname`, `acquired_at`),
  and `REGISTRY_LOCK_TIMEOUT` now reports the lock directory, the wait duration, and that owner.
- `docko adapter claude-code doctor [--fix]` reports launcher and plugin manifest version drift,
  duplicate or dangling docko hook registrations in `.claude/settings.json` and
  `.claude/settings.local.json`, how the `docko` binary resolves, and the session id the shell
  exports. `--fix` removes registrations that point at a launcher which is missing or out of date
  and collapses duplicate registrations for an event down to the first healthy one, then re-runs
  the diagnosis so `issues` and `ok` describe the post-fix state. The plugin ships it as
  `/dock-doctor`.
- `docko slot acquire --prefer <slot-id>` takes that slot when it is free and falls back to
  round-robin when it is not; an unknown id fails with `PREFERRED_SLOT_NOT_FOUND`. Slots whose
  registry entry sets `auto_acquire: false` are skipped by automatic selection and stay claimable by
  name, and `resource ensure` gained `--auto-acquire` / `--no-auto-acquire`. The opt-out is stored on the
  registry resource as `auto_acquire: false` and survives slot rediscovery.
- `docko status --claimed` lists only claimed resources, and every status payload carries
  `resolved_root` plus a `summary` block: per-application free/claimed counts, `my_claims` for the
  resolved session, and `stale_candidates` with the owner's last heartbeat.
- `docko session list --limit <n>` (default 20, newest first) with `active_session_count` and
  `returned_session_count`; `docko session prune --retention-ms <n>` (alias
  `--delete-ended-older-than-ms`, default 7 days) reporting `retention_ms` and `deleted_manifests`.
  `--retention-ms` and `--max-age-ms` accept `0`, meaning "now".
- `slot acquire` availability now reports `pinned_slot_count`, and `NO_FREE_SLOT` reports
  `busy_slot_count` and `pinned_slot_count` separately, so a slot pinned out of rotation is no
  longer counted as busy.
- `docko <command> --help` prints usage for that command instead of the generic command list, and
  `docko slot|session|adapter --help` prints that namespace's subcommands. `--help` and `--version`
  are answered before any workspace resolution, so `docko init --root <slot> --help` prints usage
  instead of failing.
- `AMBIGUOUS_SESSION` errors carry `suggested_command`: the command that was just run, re-rendered
  with `--session` filled in from the runtime's own session id.
- The Claude Code SessionStart hook exports `DOCKO_SESSION_ID`, `DOCKO_RUNTIME`, and `DOCKO_ROOT`
  through `$CLAUDE_ENV_FILE`, so later Bash tool calls in the session resolve their own session
  without an explicit `--session`. Its `additionalContext` now states the session id, the workspace
  root, and the acquire/claim/release commands with `--session` already filled in.
- `release --brief`, and successful releases report `released_by_session_id`,
  `previous_owner_session_id`, and `forced_by_session_id` for a `--force` takeover.

### Changed

- Write checks for paths outside the workspace's `slots/` tree are answered from an unlocked
  registry read: no lock, no session touch, no writes. Anything under `slots/` takes the locked
  path, where an allowed write by the owner or a delegate refreshes the claim heartbeat. The
  refresh is throttled to `min(30_000, max(1_000, floor(stale_after_ms / 4)))` ms, so a claim with
  a short stale window still gets several heartbeats inside it.
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
  than 30 seconds immediately instead of waiting out the timeout, and retries recovery. Breaking a
  lock renames it aside to a unique `docko/.registry.lock.stale-<random>` before deleting it, and
  the acquirer reads its own `owner.json` stamp back before running, so two processes can never
  hold the lock at once. Staleness is judged by age only; the recorded `pid` is diagnostic and is
  never probed for liveness.
- Debug log retention is enforced once per process instead of on every append.
- The CLI resolves the session from `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, then the
  single active session.
- An explicit `--root` inside a managed slot now resolves up to the owning workspace instead of
  failing with `ROOT_INSIDE_SLOT`, so `docko status --root .` works from inside a slot. The
  scaffolding commands never resolve up: `init` and `adapter claude-code install` both refuse a
  directory inside another workspace's `slots/` tree with `ROOT_INSIDE_SLOT`, with or without an
  explicit `--root`, and `install` also refuses a non-workspace directory inside another workspace
  with the new `ROOT_NOT_WORKSPACE` rather than installing Claude Code assets into the parent
  project. Both errors report `provided_root` and `workspace_root` and name the explicit `--root`
  to use.
- The machine-local `.claude/settings.local.json` gets the absolute launcher path (derived from
  `--dest`), so hooks resolve from any working directory and shell; the committed files
  (`.claude/settings.docko.json` and `<dest>/hooks/hooks.json`) stay portable by anchoring on
  `$CLAUDE_PROJECT_DIR` and `${CLAUDE_PLUGIN_ROOT}`. The generated fragment now matches the plugin
  bundle: no matcher on `SessionStart`, `SessionEnd`, or `SubagentStart`, and per-event timeouts of
  60 s / 15 s / 30 s / 30 s.
- `adapter claude-code install` refreshes an outdated hook launcher without `--force` by comparing a
  `// docko-launcher-version:` header, reports unchanged files under `unchanged_files`, and replaces
  a previous docko hook registration for an event instead of appending a second one.
- Generated hook config (`<dest>/plugin.json`, `<dest>/hooks/hooks.json`,
  `.claude/settings.docko.json`) is machine state and is now rewritten on every install so it
  always matches the installed docko version. It was previously preserved, which left an install
  advertising a stale version and stale hook commands. Identical content is still reported under
  `unchanged_files`, so `written_files` only lists files whose content actually changed.
- Blocked writes explain themselves per reason: `slot-not-claimed` names the previous owner and a
  `slot acquire --prefer` line, `claim-expired` names the expiry and quiet window with a `docko
  claim` line, and `unrelated-session` names the owner's task, branch, and liveness with a
  `docko release --force` line.
- Shipped commands, skill, and snippets dropped `--root .`, describe selection as round-robin, tell
  agents to pass `$DOCKO_SESSION_ID` and never invent a session id, and state that `branch` is claim
  metadata and claims are slot-scoped.

### Fixed

- Abandoned sessions no longer accumulate as active forever when a runtime crashes without calling
  `session end`, which made `docko session list` grow unbounded.
- A slot directory created since the last registry mutation is no longer writable by any session:
  the unlocked fast path used to answer `path-not-managed` for it because slot discovery had not
  run yet.
- `AMBIGUOUS_SESSION` no longer suggests the environment session id that just failed to resolve.
  The suggestion is the newest active session, or the first listed candidate.
- `docko status` no longer reports an environment session id that names no active session in this
  workspace; the summary omits `session_id` instead.
- `docko session current` refuses an ended session with `SESSION_NOT_FOUND` instead of returning it
  and restarting its retention clock; touching an ended manifest is now a no-op.
- A non-dry `session prune` drains every legacy ended manifest in one pass instead of the 100 per
  mutation the opportunistic janitor moves, so a large backlog no longer needs dozens of commands.
- Temp write artifacts are swept on the read path as well as the write path, and the sweep now
  includes `docko/sessions/ended/`. A workspace whose registry never changes used to keep them
  forever.
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
- `release` on a resource that is already free reports `RESOURCE_NOT_CLAIMED` with an explanation
  instead of a bare non-zero exit, and a non-owner release suggests `--force` explicitly.

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

[Unreleased]: https://github.com/4riel/docko/compare/v0.1.0-alpha.16...HEAD
[0.1.0-alpha.16]: https://github.com/4riel/docko/compare/v0.1.0-alpha.15...v0.1.0-alpha.16
[0.1.0-alpha.15]: https://github.com/4riel/docko/compare/v0.1.0-alpha.14...v0.1.0-alpha.15
[0.1.0-alpha.14]: https://github.com/4riel/docko/compare/v0.1.0-alpha.13...v0.1.0-alpha.14
[0.1.0-alpha.13]: https://github.com/4riel/docko/releases/tag/v0.1.0-alpha.13
