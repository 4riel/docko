# CLI Reference

This page documents the current public CLI as implemented in `packages/cli/src/index.ts` and exercised by `tests/cli.unit.test.mjs` plus `tests/docko.e2e.test.mjs`.

Public package: [`docko-workspace`](https://www.npmjs.com/package/docko-workspace)
Source repository: [`4riel/docko`](https://github.com/4riel/docko)
Current install tag: `docko-workspace@alpha`
CLI command: `docko`

## Basics

- Use `docko --help` for the command list.
- Use `docko --version` for the package version.
- All commands accept `--root <path>`. If omitted, docko uses `DOCKO_ROOT` or the current working directory.
- Root resolution walks up like git: when the starting point (cwd, `--root`, or `DOCKO_ROOT`) sits inside a workspace but below its root, docko resolves up to the nearest ancestor that owns `docko/registry.json` instead of fragmenting state into a slot. `--root .` from inside a slot therefore works and reports the resolved root as `resolved_root`.
- `init` is the exception: it scaffolds at the given location and refuses an explicit `--root` inside a managed `slots/` directory with `ROOT_INSIDE_SLOT`, so it can never leak a second registry into a slot.
- Session-aware commands also accept `--session <id>`. If omitted, docko tries `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, then auto-resolution from active sessions. An env id that matches no active session is ignored rather than failing.
- When session resolution is ambiguous, the error carries `active_session_count`, the newest active sessions, `newest_session_id`, and `suggested_command`: the command you just ran, re-rendered with `--session` filled in.
- Agent-facing commands can add `--brief` for a smaller JSON payload on `status`, `slot acquire`, `session list`, `session prune`, and `release`.
- Every command accepts `--help` and prints usage for that command: `docko slot acquire --help`.
- `docko --help` and `docko --version` print plain text.
- Success payloads are JSON on stdout.
- Fatal errors are JSON on stderr with a non-zero exit code.
- `docko init` is the exception in guided mode: interactive `init` prints human-readable prompts and a human-readable summary unless you add `--json`.
- `docko session current --id-only` is also an exception: it prints plain text, not JSON.

## Common Manual Flow

Create or inspect a workspace:

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace
docko status --root ./workspace
docko app ensure --root ./workspace --id backend --source ../backend --slots 2 --keyword backend --keyword api
docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

Start a session, claim a slot, do work, then release it:

```text
docko session start --root ./workspace --runtime shell --session leader
docko claim --root ./workspace --session leader --resource slot --id main --branch feat/docs --task "refresh operator docs"
docko heartbeat --root ./workspace --session leader --resource slot --id main
docko release --root ./workspace --session leader --resource slot --id main
docko session end --root ./workspace --session leader
```

## `docko init`

Initializes a workspace, bootstraps `docko/`, discovers slot resources, and optionally installs Claude and Codex onboarding assets.

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace
```

Useful options:

- `--mode auto|workspace|repo`: choose scaffolding mode. `auto` is the default.
- `--slot <id>`: create starter slot directories. Repeatable. Duplicate values are de-duplicated.
- `--slot-stale-after-ms <n>`: store the default slot stale timeout in `workspace.config.janitor.slot_stale_after_ms`.
- `--session-stale-after-ms <n>`: store the session stale timeout in `workspace.config.janitor.session_stale_after_ms`. Workspaces without it use `28800000` (8 hours).
- `--claude`: install Claude Code assets during init.
- `--codex`: prepare Codex onboarding guidance during init.
- `--inject-claude`: inject the managed docko block into `CLAUDE.md`.
- `--inject-codex`: inject the managed docko block into `AGENTS.md`.
- `--claude-file <path>`: override the target `CLAUDE.md` path for injection.
- `--agents-file <path>`: override the target `AGENTS.md` path for injection.
- `--clone-source <path>`: duplicate an existing non-empty repo or clone into a managed slot during init.
- `--clone-slot <id>`: target slot for `--clone-source`. Default: the first starter slot.
- `--existing`: in guided mode, import already-existing clones instead of asking for one primary repo to duplicate.
- `--prompt`: force the guided onboarding flow even outside a normal TTY.
- `--json`: force JSON output for guided init.
- `--force`: overwrite managed Claude files when used with `--claude`.

Tested defaults and behaviors:

- Empty roots default to `workspace` mode and create `slots/main`.
- Repo-like roots default to `repo` mode and still create `slots/main`.
- Existing slot directories are preserved and registered instead of being replaced.
- Guided init auto-detects `CLAUDE.md` from the workspace root, `.claude/`, or `docs/`.
- Guided init auto-detects `AGENTS.md` from the workspace root, `docs/`, or `.claude/`.
- Guided init assumes you want fresh managed clones unless you pass `--existing`.
- `--claude` installs the Claude adapter with `--write-settings-local`.

Init payload path notes:

- `workspace_root` and `root_check.root` are display-oriented values, so they may be relative to the current terminal folder.
- `workspace_root_absolute` and `root_check.absolute_root` always return the resolved absolute workspace path for scripts and QA tooling.

Examples:

```text
docko init --root ./workspace --claude --codex --inject-claude --inject-codex
docko init --root ./workspace --slot api --slot worker --slot-stale-after-ms 14400000
docko init --root ./workspace --clone-source ./source-repo --clone-slot main
docko init --root ./workspace --prompt --json --existing
```

## `docko app ensure`

Registers or updates an application descriptor and, when you pass `--source`, seeds an application-specific slot pool under `slots/<application-id>/`.

```text
docko app ensure --root ./workspace --id backend --name Backend --description "Backend API service" --keyword backend --keyword api --source ../backend --slots 2
docko app ensure --root ./workspace --id frontend --name Frontend --description "Frontend web app" --keyword frontend --keyword web --source ../frontend --slot main
```

Options:

- `--id <app-id>` is required.
- `--name <text>` sets a human-facing name. Default: title-cased `--id`.
- `--description <text>` stores a short description in the registry.
- `--keyword <term>` is repeatable and gives `slot acquire` inference hints for task text.
- `--source <path>` seeds slots from an existing repo or clone.
- `--slots <n>` generates numbered slot names from `--slot-base` such as `main_1`, `main_2`, and so on.
- `--slot-base <id>` sets the generated slot base. Default: `main`.
- `--slot <id>` is repeatable when you want explicit slot names instead of a generated sequence.

Notes:

- Application metadata appears under `applications` in `docko status` and `docko/registry.json`.
- Application-aware slots use resource ids like `backend.main_1` and paths like `slots/backend/main_1`.
- If you reuse an existing flat slot id as an application id, docko rejects the change to avoid ambiguity.

## `docko slot acquire`

Claims a free managed slot for a session. Acquisition is round-robin: it starts at the slot after the last one claimed for the same application (tracked in `config.scheduler.last_slot_id`) and wraps around the ring, so the just-released slot is picked last and gets an incidental cooldown. A cold start with no cursor picks the lowest slot. Manual `docko claim <slot>` never moves the cursor. If every managed slot is already claimed, the command can prompt to create a fresh managed clone or do it programmatically with `--clone-when-busy`.

```text
docko slot acquire --root ./workspace --session leader --branch feat/docs --task "refresh docs"
docko slot acquire --root ./workspace --session leader --application backend --branch feat/api --task "update backend auth"
docko slot acquire --root ./workspace --session leader --clone-when-busy --clone-from main --clone-slot main-hotfix --branch feat/hotfix --task "urgent fix"
docko slot acquire --root ./workspace --session leader --application backend --branch feat/api --task "update backend auth" --brief
```

Options:

- `--application <id>` restricts acquisition to one application slot pool. docko never hands back a slot from a different application than the one requested.
- `--prefer <slot-id>` takes that slot when it is free and falls back to normal round-robin when it is not. An unknown id fails with `PREFERRED_SLOT_NOT_FOUND`. `--prefer` also reaches slots that are pinned out of rotation.
- `--branch <name>` and `--task <text>` record operator context in the resulting claim. `branch` is metadata only: docko never runs `git checkout`.
- `--runtime <name>` overrides the runtime stored on the claim.
- `--stale-after-ms <n>` overrides the stale timeout for the resulting claim.
- `--clone-when-busy` duplicates and claims a fresh managed slot when none are free.
- `--clone-from <path-or-slot>` chooses the source slot or path for that clone fallback. Default: `main` when present, otherwise the first managed slot.
- `--clone-slot <id>` sets the preferred slot id for the clone fallback. If that id already exists, docko appends a numeric suffix.
- `--prompt` forces the clone confirmation prompt even outside a normal TTY.
- `--brief` returns only the selected slot, session, availability, and clone summary fields.

Notes:

- Successful output always includes the claimed slot, `resolved_root`, and availability counts from before the claim.
- Slots whose registry entry sets `auto_acquire: false` are skipped by automatic selection. They stay claimable by name with `docko claim` or `--prefer`.
- When applications are configured, `docko` can infer the right application from keywords in `--task` or `--branch` text.
- When docko creates a new clone, the payload includes `clone.size_bytes` and `clone.size_mb`.
- `claim` remains the explicit low-level command when you already know the exact slot id you want.

## `docko slot duplicate`

Duplicates a non-empty source repo or managed slot into `slots/<target>` or, when `--application` is present, into `slots/<application>/<target>`.

```text
docko slot duplicate --root ./workspace --from main --to main-copy
docko slot duplicate --root ./workspace --application backend --from main_1 --to hotfix
docko slot duplicate --root ./workspace --from ./source-repo --to warm-copy
```

Notes:

- `--from` accepts either a managed slot ID or a filesystem path.
- `--application <id>` makes `--from main_1` resolve inside that application first and writes the target under that application pool.
- `--to` must resolve to an empty or new managed slot directory.
- The command re-runs slot discovery after copying so the new slot appears in `docko status`.

## `docko status`

Reads the registry, filters by resource when requested, and runs stale recovery before returning results.

```text
docko status --root ./workspace
docko status --root ./workspace --resource slot --id main
docko status --root ./workspace --application backend
docko status --root ./workspace --resource shared-env --id staging
docko status --root ./workspace --application backend --brief
```

Notes:

- Use `--resource <type>` and `--id <id>` to narrow the result set.
- Use `--application <id>` to view only one application slot pool.
- Use `--claimed` to list only claimed resources instead of hand-filtering the full array.
- Use `--brief` when an agent or script only needs slot counts, compact resource rows, and janitor release counts.
- Every status payload carries `resolved_root` and a `summary` block: per-application free/claimed counts, `my_claims` for the resolved session (empty when the session cannot be resolved), and `stale_candidates` — claims quiet for more than half their stale window, with the owner's `last_heartbeat_at` and `age_ms`.
- If stale claims were released during the read, they appear under `janitor.released_claims`. `--brief` also reports `janitor_ended_sessions_truncated` and `janitor_deleted_manifests`.
- Free slot resources deleted from `slots/` are dropped from the returned registry state.

## `docko logs`

Reads recent debug entries from `docko/logs/`.

```text
docko logs --root ./workspace
docko logs --root ./workspace --limit 20
docko logs --root ./workspace --days 2 --limit 50
```

Notes:

- Entries are returned newest first.
- Retention is capped at 3 days even if `--days` asks for more.

## `docko claim`

Claims a resource for a session.

```text
docko claim --root ./workspace --session leader --resource slot --id main --branch feat/docs --task "refresh docs"
```

Options:

- `--resource <type>` and `--id <id>` are required.
- `--branch <name>` and `--task <text>` record operator context in the claim.
- `--runtime <name>` overrides the claim runtime. If omitted, docko uses `DOCKO_RUNTIME` when present.
- `--stale-after-ms <n>` overrides the stale timeout for this claim only.

Notes:

- If you omit `--session`, docko tries to resolve it from `DOCKO_SESSION_ID` or the active session set.
- Ambiguous resolution fails with `AMBIGUOUS_SESSION` and includes compact `active_sessions` plus safe `next_steps`. Retry with an explicit `--session <id>`; do not end sessions unless you are intentionally cleaning up workspace state.
- No active session fails with `NO_ACTIVE_SESSION`.
- Slot claims inherit the workspace default stale timeout when configured.
- Application-aware slots use explicit slot ids such as `backend.main_1`.
- `shared-env` resources use a shorter built-in default stale timeout than slots.
- If you want docko to choose a free slot or clone a new one when all current slots are busy, use `docko slot acquire` instead.

## `docko heartbeat`

Refreshes `updated_at` and `heartbeat_at` for an owned claim.

```text
docko heartbeat --root ./workspace --session leader --resource slot --id main
```

## `docko release`

Releases a claimed resource.

```text
docko release --root ./workspace --session leader --resource slot --id main
docko release --root ./workspace --session operator --resource slot --id main --force
```

Options:

- `--reason <text>` stores a release reason.
- `--force` allows an explicit operator recovery release by a non-owner.

Notes:

- Normal release is owner-only. A non-owner release fails with `RESOURCE_OWNED_BY_OTHER_SESSION`, and the error carries a `suggested_command` that adds `--force`.
- Releasing a resource that is already free fails with `RESOURCE_NOT_CLAIMED` and says so explicitly, including under `--brief`; the janitor or a session end may have released it first.
- Forced release records `force-release` as the claim release reason and reports `forced_by_session_id` alongside `previous_owner_session_id`.
- Successful output also reports `released_by_session_id`. `--brief` returns the compact form.

## `docko delegate`

Records delegated authority from a leader session to a child session for one resource.

```text
docko delegate --root ./workspace --session leader --child-session teammate --resource slot --id main
docko delegate --root ./workspace --session leader --child-session reviewer --resource slot --id main --scope read
```

Options:

- `--child-session <id>` is required.
- `--scope read|write` defaults to `write`.

Notes:

- The child session must already exist.
- Read-scoped delegation does not authorize file writes.
- Child authority disappears when the parent releases the claim.

## `docko resource ensure`

Registers or updates a non-slot resource such as a shared environment.

```text
docko resource ensure --root ./workspace --resource shared-env --id staging --path shared/staging
docko resource ensure --root ./workspace --resource slot --id backend.libs --no-auto-acquire
```

Options:

- `--path <path>` sets the managed path for a non-slot resource.
- `--no-auto-acquire` / `--auto-acquire` pin a resource out of, or back into, `slot acquire` rotation. A pinned resource stays claimable by name (`docko claim`, `slot acquire --prefer`).

Notes:

- Slot resources are discovered from `slots/`; do not use `resource ensure` to create them.
- Updating the path of a claimed resource is denied.
- When `--no-auto-acquire`/`--auto-acquire` is passed, the payload reports the stored `auto_acquire` value (`auto_acquire_persisted` is `true` once the registry recorded it). The opt-out survives slot rediscovery; `true` is the default and is not written to the registry.

## `docko render`

Re-renders `docko/registry.md` from `docko/registry.json`.

```text
docko render --root ./workspace
```

## `docko session start`

Creates a session manifest and returns the resolved session context.

```text
docko session start --root ./workspace --runtime shell --session leader
docko session start --root ./workspace --runtime shell --session teammate --actor-mode delegated --parent-session leader --delegated-from-session leader
```

Options:

- `--runtime <name>` sets the runtime. If omitted, docko uses `DOCKO_RUNTIME` or `portable`.
- `--session <id>` sets an explicit session ID.
- `--actor-mode interactive|delegated|automation` defaults to `interactive`.
- `--parent-session <id>` links a child session to its parent.
- `--delegated-from-session <id>` records the original delegating session.

Notes:

- Hook integrations may also pass `session_id`, `parent_session_id`, and `delegated_from_session_id` via stdin JSON.
- Reusing an active session ID fails with `SESSION_ID_CONFLICT`.
- Delegated startup with a missing parent session fails with `SESSION_NOT_FOUND`.

## `docko session end`

Ends a session, releases the claims it owns, and ends any delegated child sessions.

```text
docko session end --root ./workspace --session leader
```

Notes:

- This is safe to call at shutdown.
- If docko cannot resolve any session from flags, stdin, or environment, it returns a successful no-op.

## `docko session current`

Returns the current session manifest.

```text
docko session current --root ./workspace --session leader
docko session current --root ./workspace --session leader --id-only
```

Notes:

- `--id-only` prints just the session ID as plain text.

## `docko session list`

Lists active sessions only.

```text
docko session list --root ./workspace
docko session list --root ./workspace --limit 5
docko session list --root ./workspace --brief
```

Options:

- `--limit <n>` returns only the newest `n` sessions. Default: 20.

Notes:

- Ended sessions are excluded.
- Sessions come back newest first, so the first row is usually the one you want.
- `active_session_count` is the full count; `returned_session_count` reflects `--limit`.
- `--brief` returns those counts plus compact active session rows for recovery from `AMBIGUOUS_SESSION`.

## `docko session prune`

Ends sessions that have gone quiet for longer than the session stale window.

```text
docko session prune --root ./workspace --dry-run
docko session prune --root ./workspace
docko session prune --root ./workspace --max-age-ms 3600000 --brief
docko session prune --root ./workspace --retention-ms 86400000
```

Options:

- `--max-age-ms <n>` overrides `workspace.config.janitor.session_stale_after_ms` for this run only.
- `--retention-ms <n>` deletes ended session manifests older than this window. Default: `604800000` (7 days). Alias: `--delete-ended-older-than-ms`.
- `--dry-run` reports what would be ended without writing anything.

Notes:

- The janitor already runs this sweep on every registry mutation, including `docko status`. Use this command to clear an existing backlog immediately or to preview one.
- A session that still owns, or is delegated, a live claim is never ended.
- Ending a session moves its manifest to `docko/sessions/ended/`, so the hot path only ever reads live sessions.
- The result reports `retention_ms` and `deleted_manifests` alongside the ended sessions.

## `docko adapter claude-code install`

Installs Claude Code adapter assets into the workspace.

```text
docko adapter claude-code install --root ./workspace --write-settings-local
docko adapter claude-code install --root ./workspace --dest .claude-plugin/docko --force
```

Options:

- `--dest <path>` overrides the plugin destination. The generated hook command follows it.
- `--write-settings-local` writes merged hook config into `.claude/settings.local.json`.
- `--force` overwrites managed Claude files.

Notes:

- Use this when you want the adapter install without running full `init --claude`.
- The hook launcher carries a `// docko-launcher-version:` header and is refreshed whenever the installed version differs from the shipped one, with or without `--force`. Commands, skills, and generated settings are still preserved unless `--force` is passed.
- Generated hook commands use the absolute launcher path, so hooks resolve from any working directory and any shell.
- Re-installing an unchanged file reports it under `unchanged_files` rather than `written_files`.
- Merging into `.claude/settings.local.json` replaces any previous docko registration for an event instead of appending a second one.

## `docko adapter claude-code doctor`

Diagnoses a repo-local Claude Code install.

```text
docko adapter claude-code doctor --root ./workspace
docko adapter claude-code doctor --root ./workspace --fix
```

Options:

- `--dest <path>` inspects a non-default plugin destination.
- `--fix` removes docko hook registrations that point at a launcher which does not exist or is out of date.

Reports:

- `launcher`: installed path, version header, and whether it matches the shipped version.
- `settings_files`: docko hook registrations in `.claude/settings.json` and `.claude/settings.local.json`, with duplicate and stale counts. Entries anchored on `${CLAUDE_PLUGIN_ROOT}` belong to the installed plugin and are left alone.
- `docko_binary`: `DOCKO_BIN`, the resolved PATH entry, and the `npx` fallback used when neither is available.
- `session`: `DOCKO_SESSION_ID` and `CLAUDE_CODE_SESSION_ID` as this shell sees them.
- `issues` with `fixable` flags, `fixed` for what `--fix` changed, and `ok`.

## `docko adapter claude-code settings`

Prints the recommended Claude hook settings fragment as JSON.

```text
docko adapter claude-code settings --root ./workspace
```

## `docko adapter claude-code session-start`

Hook-facing command that starts a Claude session and returns `additionalContext` plus environment values.

```text
docko adapter claude-code session-start --root ./workspace --session leader
```

Notes:

- The runtime is always `claude-code`.
- In real hook usage, Claude may also pass `session_id` on stdin JSON.
- `additionalContext` states the session id, the resolved workspace root, and the acquire/claim/release commands with `--session` already filled in.
- `env` carries `DOCKO_SESSION_ID` and `DOCKO_RUNTIME`. The plugin's hook launcher appends those (plus `DOCKO_ROOT`) to `$CLAUDE_ENV_FILE`, so later Bash tool calls in the same session inherit them.

## `docko adapter claude-code session-end`

Hook-facing command that ends a Claude session.

```text
docko adapter claude-code session-end --root ./workspace --session leader
```

Notes:

- The command can resolve the session from `--session`, stdin JSON, or `DOCKO_SESSION_ID`.
- If no session is known, it returns a successful no-op.

## `docko adapter claude-code pre-tool-use`

Hook-facing authorization check for Claude `Edit` and `Write` operations.

```text
docko adapter claude-code pre-tool-use --root ./workspace --session leader
```

Notes:

- Real hook usage passes the pending file path on stdin JSON as `file_path` or `tool_input.file_path`.
- The response carries `allow`, `reason`, `session_id`, `resource_id`, `owner_session_id`, `workspace_root`, and, when the answer depends on a claim, `owner_task`, `owner_branch`, `owner_session_active`, `expired_at`, `claim_stale_after_ms`, and `previous_owner_session_id`.
- `reason` is one of `path-not-managed`, `owner`, `delegated` (allowed) or `slot-not-claimed`, `claim-expired`, `unrelated-session` (denied).
- Writes outside managed slots return `allow: true` without taking the registry lock.
- Writes into unclaimed slots return `allow: false`.
- If the hook payload is missing a file path, the command returns `allow: true` with `reason: "no-file-path"`.

## `docko adapter claude-code subagent-start`

Hook-facing command that starts a delegated Claude teammate session and inherits the parent authority.

```text
docko adapter claude-code subagent-start --root ./workspace --session leader
```

Notes:

- The command requires a parent session from `--session`, stdin JSON, or `DOCKO_SESSION_ID`.
- The returned environment includes `DOCKO_SESSION_ID`, `DOCKO_PARENT_SESSION_ID`, and `DOCKO_RUNTIME=claude-code`.
