# CLI reference

Every command the `docko` CLI implements, with its options, output fields, and exit codes. Each
entry matches the usage that `docko <command> --help` prints.

## Conventions

The rules in this section hold for every command on the page.

### Output contract

- A successful command prints one JSON object to stdout and exits `0`.
- A failed command prints one JSON object with an `error` member to stderr and exits non-zero.
- `--help` and `--version` print plain text.
- `docko session current --id-only` prints the session id as plain text.
- Guided `docko init` prints human-readable prompts and a human-readable summary. Add `--json` to
  force the JSON payload.

Output blocks on this page come from real runs, trimmed to the fields the surrounding text
discusses. `<workspace-root>` stands in for the absolute path docko resolved.

### Root resolution

The starting point is `--root`, then `DOCKO_ROOT`, then the current directory. Read and write
commands resolve up from there to the nearest directory that owns `docko/registry.json`, the way
git locates `.git`, and report the answer as `resolved_root`. Running a read or write command from
inside a slot therefore works.

`docko init` and `docko adapter claude-code install` act on the directory they were pointed at and
never resolve up. Both refuse a directory inside another workspace root's `slots/` tree with
`ROOT_INSIDE_SLOT`, and `install` also refuses a non-workspace directory inside another workspace
root with `ROOT_NOT_WORKSPACE`. Both errors report `provided_root` and `workspace_root`.

### Session resolution

Session-aware commands resolve the acting session in this order: `--session <id>`,
`DOCKO_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`, then the single active session when exactly one is
active. An environment id that matches no active session is ignored rather than fatal.

Two or more active sessions with no explicit id fail with `AMBIGUOUS_SESSION`, and the payload
carries `active_session_count`, `active_sessions`, `newest_session_id`, `resolution`, `next_steps`,
and `suggested_command`: the command you ran, re-rendered with `--session` filled in.

### Compact output and help

`--brief` returns a compact projection of the same result on five commands: `status`,
`slot acquire`, `session list`, `session prune`, and `release`. The payload prints on one line
without indentation. Every other command ignores the flag.

`docko --help` lists every command. `docko <command> --help` prints that command's usage, and
`docko app --help`, `docko slot --help`, `docko resource --help`, `docko session --help`,
`docko adapter --help`, and `docko adapter claude-code --help` list that namespace's commands.
`--help` and `--version` answer before root resolution, so a `--root` that would otherwise be
refused still prints usage.

### Exit codes

A successful command exits `0` and every failure exits between `1` and `5`.
[Errors](errors.md#exit-codes) lists each exit code, maps every error code to it, and gives the
recovery command.

## Global options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--root <path>` | path | `DOCKO_ROOT`, then the current directory | Sets the starting point for workspace root resolution. |
| `--session <id>` | string | `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, then the single active session | Names the acting session. |
| `--brief` | boolean | `false` | Returns the compact payload on the five commands that support it. |
| `--help` | boolean | `false` | Prints usage for the command or namespace and exits. |
| `--version` | boolean | `false` | Prints the package version as plain text and exits. |

Repeating an option that takes a value collects the values into a list on `--slot` and `--keyword`,
and keeps the last value everywhere else.

## `docko init`

Creates a workspace root, scaffolds `slots/`, discovers slot resources, and writes
`docko/registry.json`. Run it once per workspace root.

```bash
docko init --root ./workspace
```

```json
{
  "ok": true,
  "mode": "workspace",
  "created_directories": ["slots", "slots/main"],
  "starter_slots": ["main"],
  "discovered_slots": ["main"],
  "workspace_config": null
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--mode <mode>` | `auto \| workspace \| repo` | `auto` | Records the scaffold mode in the result. |
| `--slot <id>` | string (repeatable) | `main` | Creates a starter slot directory under `slots/`. |
| `--slot-stale-after-ms <n>` | number | none | Stores the default stale window for slot claims in this workspace root. |
| `--session-stale-after-ms <n>` | number | none | Stores the default stale window for sessions in this workspace root. |
| `--claude` | boolean | `false` | Installs the repo-local Claude Code assets during init. |
| `--codex` | boolean | `false` | Prepares `AGENTS.md` guidance during init. |
| `--inject-claude` | boolean | `false` | Appends the managed docko block to `CLAUDE.md`. |
| `--inject-codex` | boolean | `false` | Appends the managed docko block to `AGENTS.md`. |
| `--claude-file <path>` | path | `CLAUDE.md` under the workspace root | Overrides the `CLAUDE.md` target for injection. |
| `--agents-file <path>` | path | `AGENTS.md` under the workspace root | Overrides the `AGENTS.md` target for injection. |
| `--clone-source <path>` | path | none | Copies an existing non-empty directory into a managed slot. |
| `--clone-slot <id>` | string | the first `--slot`, otherwise `main` | Names the slot that `--clone-source` fills. |
| `--existing` | boolean | `false` | Asks the guided flow for existing clone directories to import. |
| `--prompt` | boolean | `false` | Forces the guided flow when stdin is not a terminal. |
| `--json` | boolean | `false` | Forces the JSON payload in the guided flow. |
| `--force` | boolean | `false` | Overwrites managed Claude Code files installed by `--claude`. |

### Notes

- `--mode` sets the reported `mode` field. `auto` reports `repo` when the root holds `.git`,
  `package.json`, `pnpm-workspace.yaml`, `pyproject.toml`, `Cargo.toml`, or `go.mod`, and
  `workspace` otherwise. All three values scaffold the same directories.
- `--inject-claude` turns on `--claude`, and `--inject-codex` turns on `--codex`.
- `--claude` installs the adapter assets and always writes `.claude/settings.local.json`. See
  [Use docko with Claude Code](claude-code.md).
- Injection appends the block once, wrapped in `<!-- docko:begin:claude -->` and
  `<!-- docko:end:claude -->` (or the matching `codex` markers). A file that already carries the
  start marker is left alone and reports `injected: false`.
- Existing directories under `slots/` are kept and registered rather than replaced.
- `workspace_root` and `root_check.root` are display paths relative to the current directory.
  `workspace_root_absolute` and `root_check.absolute_root` are always absolute.
- The guided flow runs when stdin is a terminal or `--prompt` is passed. Everything it asks for has
  a flag, so a script can skip it entirely.

## `docko app ensure`

Registers an application and, when you pass `--source`, seeds its slot pool under
`slots/<application-id>/`.

```bash
docko app ensure --root ./workspace --id backend --source ../backend --slots 2 --keyword api
```

```json
{
  "ok": true,
  "application": {
    "application_id": "backend",
    "name": "Backend",
    "keywords": ["api"],
    "source_path": "../backend"
  },
  "created_directories": ["slots/backend"],
  "discovered_slots": ["backend.main_1", "backend.main_2"]
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--id <application-id>` | string | required | Names the application. |
| `--name <text>` | string | the title-cased `--id` | Sets the human-facing application name. |
| `--description <text>` | string | `null` | Stores a short description in the registry. |
| `--keyword <value>` | string (repeatable) | `[]` | Adds an inference keyword for `docko slot acquire`. |
| `--source <path>` | path | none | Copies an existing non-empty directory into each generated slot. |
| `--slots <n>` | number | one slot when `--source` is set, otherwise none | Generates that many slots from `--slot-base`. |
| `--slot-base <id>` | string | `main` | Sets the base name for generated slots. |
| `--slot <id>` | string (repeatable) | none | Names the slots explicitly instead of generating a sequence. |

### Notes

- `--slots 1` generates one slot named after `--slot-base`; two or more generate `main_1`, `main_2`,
  and so on. Their resource ids are `<application-id>.<slot-name>` and their paths are
  `slots/<application-id>/<slot-name>`.
- `--slot` wins over `--slots` when both are passed.
- A slot name that already exists gets a numeric suffix instead of being overwritten.
- Task-shaped setup lives in [Application slot pools](applications.md).

## `docko slot acquire`

Claims a slot that docko picks, and clones a fresh one when every slot is busy. Prefer it over
`docko claim` whenever the exact slot does not matter.

```bash
docko slot acquire --root ./workspace --session leader --branch feat/api --task "update auth" --brief
```

```json
{"ok":true,"action":"claimed-existing-slot","resolved_root":"<workspace-root>","session_id":"leader","slot_id":"backend.main_1","application_id":"backend","slot_name":"main_1","slot_path":"<workspace-root>/slots/backend/main_1","availability":{"total_slots":2,"free_slots_before":2,"claimed_slots_before":0,"pinned_slot_count":0},"clone":null}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--application <id>` | string | inferred from `--task` and `--branch` | Restricts the pick to one application's slot pool. |
| `--prefer <slot-id>` | string | none | Takes that slot when it is free, otherwise falls back to rotation. |
| `--branch <name>` | string | `null` | Records the branch this work belongs to as claim metadata. |
| `--task <text>` | string | `null` | Records what the claim is for. |
| `--runtime <name>` | string | `DOCKO_RUNTIME`, then the session's runtime | Records the runtime on the claim. |
| `--stale-after-ms <n>` | number | `workspace.config.janitor.slot_stale_after_ms` | Overrides the stale window for this claim. |
| `--clone-when-busy` | boolean | `false` | Clones and claims a fresh slot when none are free. |
| `--clone-from <path-or-slot>` | string | `main`, then `main_1`, then the first slot | Chooses the source for the clone fallback. |
| `--clone-slot <id>` | string | derived from the clone source | Names the slot the clone fallback creates. |
| `--prompt` | boolean | `false` | Asks before cloning when stdin is not a terminal. |
| `--brief` | boolean | `false` | Returns the compact payload shown above. |

### Notes

- Selection is round-robin. It starts after the last slot claimed for the same application, tracked
  in `workspace.config.scheduler.last_slot_id`, and wraps, so the slot released most recently is
  picked last.
- `action` is `claimed-existing-slot` or `cloned-and-claimed`. A cloned slot also reports
  `clone.size_bytes` and `clone.size_mb`.
- `availability` counts the state before the claim: `total_slots`, `free_slots_before`,
  `claimed_slots_before`, and `pinned_slot_count`.
- Slots whose registry entry sets `auto_acquire: false` are skipped by rotation and stay reachable
  by name through `--prefer` or `docko claim`.
- An unknown `--prefer` value fails with `PREFERRED_SLOT_NOT_FOUND` and lists `known_slot_ids`.
- Every slot busy without `--clone-when-busy` fails with `NO_FREE_SLOT` (exit `2`), reporting
  `busy_slot_count`, `pinned_slot_count`, `pinned_slot_ids`, and `next_steps`.
- Keyword inference matches `--task` and `--branch` text against each application's id, name, and
  keywords. Two applications scoring equally fail with `AMBIGUOUS_APPLICATION`.

## `docko slot duplicate`

Copies a directory or an existing slot into a new managed slot and re-runs slot discovery.

```bash
docko slot duplicate --root ./workspace --from main --to main-copy
```

```json
{
  "ok": true,
  "source_kind": "slot",
  "source_path": "<workspace-root>/slots/main",
  "application_id": null,
  "slot_name": "main-copy",
  "slot_id": "main-copy",
  "slot_path": "<workspace-root>/slots/main-copy"
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--from <path-or-slot>` | string | required | Names the source slot or directory. |
| `--to <slot-id>` | string | required | Names the slot to create. |
| `--application <id>` | string | none | Resolves `--from` inside that application and writes the target into its pool. |

### Notes

- `source_kind` is `slot` when `--from` resolved to a managed slot and `path` when it resolved to a
  directory.
- An empty source fails with `SOURCE_EMPTY`, and a missing one with `SOURCE_NOT_FOUND`.
- A target that exists and is not an empty directory fails with `TARGET_EXISTS` (exit `2`).

## `docko status`

Reads the registry, runs stale recovery, and returns the resource list with a summary block.

```bash
docko status --root ./workspace
```

```json
{
  "schema_version": "0.1.0",
  "resources": [
    {
      "resource_type": "slot",
      "resource_id": "main",
      "path": "slots/main",
      "status": "free",
      "claim": null,
      "delegations": []
    }
  ],
  "ignored_slot_dirs": [],
  "janitor": { "released_claims": [], "ended_sessions": [], "deleted_manifests": 0 },
  "resolved_root": "<workspace-root>",
  "summary": {
    "slots": { "total": 1, "free": 1, "claimed": 0 },
    "applications": [],
    "session_id": null,
    "my_claims": [],
    "stale_candidates": []
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--resource <type>` | string | all types | Returns only resources of that type. |
| `--id <id>` | string | all ids | Returns only the resource with that id. |
| `--application <id>` | string | all applications | Returns only that application's resources. |
| `--claimed` | boolean | `false` | Returns only claimed resources. |
| `--brief` | boolean | `false` | Returns slot counts, compact resource rows, and janitor counts. |

### Notes

- `status` never fails on an ambiguous session. `summary.session_id` and `summary.my_claims` are
  empty when the acting session cannot be resolved.
- `summary.my_claims` lists every resource this session owns or is delegated, at either scope. A
  slot there is not proof that writes are authorized; confirm the delegation `scope` is `write`.
- `summary.stale_candidates` lists claims quiet for more than half their stale window, with
  `owner_session_id`, `last_heartbeat_at`, `age_ms`, and `stale_after_ms`.
- Claims the janitor released during this read appear under `janitor.released_claims`.
- `ignored_slot_dirs` lists directories under `slots/` whose name is not a valid resource id. They
  own no resource and can never be claimed.
- `--brief` renames the janitor fields to `janitor_released`, `janitor_ended_sessions`,
  `janitor_ended_sessions_truncated`, and `janitor_deleted_manifests`.

## `docko logs`

Returns recent debug entries from `docko/logs/`, newest first.

```bash
docko logs --root ./workspace --limit 2
```

```json
{
  "retention_days": 3,
  "days": 3,
  "entries": [
    {
      "timestamp": "2026-09-07T07:15:38.409Z",
      "operation": "render",
      "outcome": "ok",
      "session_id": null,
      "resource_type": null,
      "resource_id": null
    }
  ]
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--days <n>` | number | `3` | Reads that many recent UTC days, capped at the 3 days retained. |
| `--limit <n>` | number | `200` | Returns at most that many entries. |

## `docko claim`

Claims one named resource for a session. Use it when you already know the resource id.

```bash
docko claim --root ./workspace --session leader --resource slot --id main --branch feat/docs --task "refresh docs"
```

```json
{
  "resource_type": "slot",
  "resource_id": "main",
  "status": "claimed",
  "claim": {
    "owner_session_id": "leader",
    "runtime": "shell",
    "branch": "feat/docs",
    "task": "refresh docs",
    "stale_after_ms": 3600000,
    "release_reason": null
  },
  "delegations": []
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--resource <type>` | string | required | Names the resource type, such as `slot` or `shared-env`. |
| `--id <id>` | string | required | Names the resource. |
| `--branch <name>` | string | `null` | Records the branch as claim metadata. |
| `--task <text>` | string | `null` | Records what the claim is for. |
| `--runtime <name>` | string | `DOCKO_RUNTIME`, then the session's runtime | Records the runtime on the claim. |
| `--stale-after-ms <n>` | number | the workspace default for that resource type | Overrides the stale window for this claim. |

### Notes

- `branch` and `task` are metadata. docko never runs `git checkout`.
- Claims are slot-scoped. They reserve a directory, not a branch, a pull request, or a file.
- A claim on an already claimed resource fails with `RESOURCE_ALREADY_CLAIMED` (exit `2`).
- Manual claims never move the `slot acquire` rotation cursor.

## `docko heartbeat`

Refreshes `updated_at` and `heartbeat_at` on a claim the acting session owns.

```bash
docko heartbeat --root ./workspace --session leader --resource slot --id main
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--resource <type>` | string | required | Names the resource type. |
| `--id <id>` | string | required | Names the resource. |

The payload is the full resource document, the same shape `docko claim` returns.

## `docko release`

Releases a claimed resource.

```bash
docko release --root ./workspace --session leader --resource slot --id main --reason "docs done" --brief
```

```json
{"ok":true,"released":true,"resource_type":"slot","resource_id":"main","released_by_session_id":"leader","previous_owner_session_id":"leader","forced_by_session_id":null,"release_reason":"docs done"}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--resource <type>` | string | required | Names the resource type. |
| `--id <id>` | string | required | Names the resource. |
| `--reason <text>` | string | `null` | Stores a release reason on the claim. |
| `--force` | boolean | `false` | Releases a claim the acting session does not own. |
| `--brief` | boolean | `false` | Returns the compact payload shown above. |

### Notes

- Release is owner-only. A non-owner release fails with `RESOURCE_OWNED_BY_OTHER_SESSION` (exit `2`)
  and the error carries a `suggested_command` that adds `--force`.
- A forced release records `force-release` as the release reason and reports `forced_by_session_id`
  next to `previous_owner_session_id`.
- Releasing a free resource fails with `RESOURCE_NOT_CLAIMED` and reports `next_steps`.

> **Warning:** `--force` takes a slot from a live session. Use it only for deliberate recovery.

## `docko delegate`

Grants a child session write authority on a resource the acting session owns.

```bash
docko delegate --root ./workspace --session leader --child-session teammate --resource slot --id main
```

```json
{
  "resource_id": "main",
  "status": "claimed",
  "delegations": [
    {
      "child_session_id": "teammate",
      "granted_by_session_id": "leader",
      "granted_at": "2026-09-07T07:14:45.360Z",
      "scope": "write"
    }
  ]
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--child-session <id>` | string | required | Names the session receiving authority. |
| `--resource <type>` | string | required | Names the resource type. |
| `--id <id>` | string | required | Names the resource. |
| `--scope <scope>` | `read \| write` | `write` | Sets what the child session may do. |

### Notes

- The child session must already exist.
- Delegation never changes `owner_session_id`, and child authority ends when the claim ends.
- `--scope read` does not authorize file writes.
- Task-shaped guidance lives in [Delegate a slot to a teammate](delegation.md).

## `docko render`

Re-renders `docko/registry.md` from `docko/registry.json`.

```bash
docko render --root ./workspace
```

```json
{ "ok": true }
```

The command takes no options beyond the global ones. The registry mirror is generated output and is
never authoritative; see [State files](state-files.md).

## `docko resource ensure`

Registers or updates a non-slot resource, and pins a slot in or out of `slot acquire` rotation.

```bash
docko resource ensure --root ./workspace --resource shared-env --id staging --path shared/staging
```

```json
{
  "resource_type": "shared-env",
  "resource_id": "staging",
  "path": "shared/staging",
  "status": "free",
  "claim": null,
  "delegations": []
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--resource <type>` | string | required | Names the resource type. |
| `--id <id>` | string | required | Names the resource. |
| `--path <path>` | path | unchanged | Sets the managed path, relative to the workspace root. |
| `--auto-acquire` | boolean | `false` | Returns the resource to `slot acquire` rotation. |
| `--no-auto-acquire` | boolean | `false` | Pins the resource out of `slot acquire` rotation. |

### Notes

- Slot resources are discovered from `slots/`. Use `docko slot duplicate` to create one.
- Changing the path of a claimed resource is denied.
- With `--auto-acquire` or `--no-auto-acquire`, the payload spells out the effective `auto_acquire`
  value. The opt-out survives slot rediscovery; `true` is the default and is not written.

## `docko session start`

Creates a session manifest and returns the session id with its startup context.

```bash
docko session start --root ./workspace --session leader --runtime shell
```

```json
{
  "session_id": "leader",
  "runtime": "shell",
  "additionalContext": "Your docko session id is leader and this workspace root is <workspace-root>.\n...",
  "env": { "DOCKO_SESSION_ID": "leader", "DOCKO_RUNTIME": "shell" }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--session <id>` | string | a generated `ses_*` id | Sets the session id explicitly. |
| `--runtime <name>` | string | `DOCKO_RUNTIME`, then `portable` | Records the runtime on the session manifest. |
| `--actor-mode <mode>` | `interactive \| delegated \| automation` | `interactive` | Records how the session runs. |
| `--parent-session <id>` | string | `null` | Links the session to its parent. |
| `--delegated-from-session <id>` | string | `null` | Records the session that delegated this one. |

### Notes

- The command also reads `session_id`, `parent_session_id`, and `delegated_from_session_id` from a
  JSON object on stdin. Explicit options win.
- `additionalContext` states the session id, the workspace root, and the acquire, claim, and release
  commands with `--session` already filled in.
- Reusing an active session id fails with `SESSION_ID_CONFLICT`.
- Only a runtime's own session id is recognized by that runtime's write hook. Do not invent one.

## `docko session end`

Ends a session, releases the claims it owns, and ends the sessions it delegated to.

```bash
docko session end --root ./workspace --session leader
```

```json
{ "ok": true, "released": true, "session_id": "leader" }
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--session <id>` | string | stdin `session_id`, then `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID` | Names the session to end. |

When no session can be resolved, the command returns `{ "ok": true, "released": false }` and exits
`0`, which makes it safe to call at shutdown.

## `docko session current`

Returns the resolved session manifest.

```bash
docko session current --root ./workspace --session leader
```

```json
{
  "schema_version": "0.1.0",
  "session_id": "leader",
  "runtime": "shell",
  "actor_mode": "interactive",
  "parent_session_id": null,
  "delegated_from_session_id": null,
  "ended_at": null,
  "workspace_root": "<workspace-root>",
  "metadata": { "pid": 74280, "hostname": "DELLA" }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--id-only` | boolean | `false` | Prints the session id as plain text instead of the manifest. |

## `docko session list`

Lists active sessions, newest first. Ended sessions are excluded.

```bash
docko session list --root ./workspace --brief
```

```json
{"active_session_count":2,"returned_session_count":2,"limit":20,"active_sessions":[{"session_id":"leader","runtime":"shell","actor_mode":"interactive","parent_session_id":null,"delegated_from_session_id":null,"started_at":"2026-09-07T07:14:17.385Z","updated_at":"2026-09-07T07:14:45.794Z"}]}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit <n>` | number | `20` | Returns at most that many sessions. |
| `--brief` | boolean | `false` | Returns the counts plus compact session rows. |

`active_session_count` is the full total and `returned_session_count` reflects `--limit`. This is
the command to run after an `AMBIGUOUS_SESSION` error.

## `docko session prune`

Ends sessions that have gone quiet and deletes old ended manifests.

```bash
docko session prune --root ./workspace --dry-run
```

```json
{
  "dry_run": true,
  "max_age_ms": 28800000,
  "pruned_session_count": 0,
  "pruned_sessions": [],
  "retention_ms": 604800000,
  "deleted_manifests": 0
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--max-age-ms <n>` | number | `workspace.config.janitor.session_stale_after_ms` | Sets the quiet time after which a session is ended. |
| `--retention-ms <n>` | number | `604800000` | Deletes ended manifests older than this window. |
| `--delete-ended-older-than-ms <n>` | number | `604800000` | Alias for `--retention-ms`. |
| `--dry-run` | boolean | `false` | Reports what would be ended without writing anything. |
| `--brief` | boolean | `false` | Returns the compact payload. |

### Notes

- Both duration options accept `0`, which cuts off at now.
- A session that still owns, or is delegated, a live claim is never ended.
- The janitor runs the same sweep on every registry mutation, including `docko status`. Use this
  command to clear a backlog immediately or to preview one.
- Ending a session moves its manifest to `docko/sessions/ended/`.

## `docko adapter claude-code install`

Installs the repo-local Claude Code assets into the workspace root.

```bash
docko adapter claude-code install --root ./workspace --write-settings-local
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--dest <path>` | path | `.claude-plugin/docko` | Sets the plugin destination, which the generated hook command follows. |
| `--write-settings-local` | boolean | `false` | Merges the hook settings into `.claude/settings.local.json`. |
| `--force` | boolean | `false` | Overwrites managed files that are otherwise preserved. |

Output fields:

| Field | Type | Description |
| --- | --- | --- |
| `workspace_root` | string | Absolute path the install acted on. |
| `plugin_root` | string | Absolute path of the installed plugin directory. |
| `settings_fragment` | object | The hook settings for the four events. |
| `settings_file` | string | Path written by `--write-settings-local`, otherwise `null`. |
| `written_files` | array | Files created or changed by this install. |
| `unchanged_files` | array | Managed files whose content already matched. |
| `skipped_files` | array | Managed files preserved because `--force` was absent. |
| `launcher_version` | string | Version stamped into the installed hook launcher. |

### Notes

- The install acts on `--root` exactly and never resolves up. See
  [Root resolution](#root-resolution).
- `--dest` must resolve inside the workspace root. A path that escapes it fails with `USAGE_ERROR`.
- `<dest>/plugin.json`, `<dest>/hooks/hooks.json`, and `.claude/settings.docko.json` are generated
  on every install. The hook launcher is refreshed whenever its stamped version differs from the
  shipped one. Everything else is preserved unless `--force` is passed.
- The written file list and the choice between this and the plugin install are covered in
  [Use docko with Claude Code](claude-code.md).

## `docko adapter claude-code settings`

Prints the hook settings fragment for a repo-local install without writing anything.

```bash
docko adapter claude-code settings --root ./workspace
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<workspace-root>/.claude-plugin/docko/scripts/docko-claude-hook.mjs\" pre-tool-use",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--dest <path>` | path | `.claude-plugin/docko` | Renders the launcher path for a non-default destination. |

The full fragment carries all four events. `SessionStart`, `SessionEnd`, and `SubagentStart` take
the same shape without a matcher, with timeouts 60, 15, and 30. The copy-pastable version is
[`examples/claude-code-settings.json`](../examples/claude-code-settings.json).

## `docko adapter claude-code doctor`

Diagnoses a repo-local Claude Code install and, with `--fix`, removes broken hook registrations.

```bash
docko adapter claude-code doctor --root ./workspace
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--dest <path>` | path | `.claude-plugin/docko` | Inspects a non-default plugin destination. |
| `--fix` | boolean | `false` | Removes hook entries pointing at a missing or outdated launcher. |

Output fields:

| Field | Type | Description |
| --- | --- | --- |
| `shipped_launcher_version` | string | Launcher version the running `docko` ships. |
| `launcher` | object | Installed launcher `path`, `exists`, `version`, and `up_to_date`. |
| `plugin_manifest` | object | Installed `<dest>/plugin.json` path, version, and whether it matches. |
| `settings_files` | array | Per file: `path`, `exists`, `docko_hook_entries`, `stale_entries`, `removed_entries`. |
| `docko_binary` | object | `docko_bin_env`, `resolved_path`, `on_path`, and the `npx` `fallback`. |
| `session` | object | `docko_session_id`, `claude_code_session_id`, and `resolved_session_id`. |
| `issues` | array | Findings, each with a `fixable` flag. |
| `fixed` | array | What `--fix` changed. |
| `ok` | boolean | True when `issues` is empty. |

### Notes

- `--fix` collapses duplicate registrations down to the first healthy one, judged per event and per
  matcher, then re-runs the diagnosis so `issues` and `ok` describe the install as it is now.
- Entries anchored on `${CLAUDE_PLUGIN_ROOT}` belong to the plugin install and are left alone.

## `docko adapter claude-code session-start`

Starts a Claude Code session from the `SessionStart` hook. The launcher calls it; you rarely do.

```bash
docko adapter claude-code session-start --root ./workspace --session leader
```

```json
{
  "additionalContext": "Your docko session id is leader and this workspace root is <workspace-root>.\n...",
  "env": { "DOCKO_SESSION_ID": "leader", "DOCKO_RUNTIME": "claude-code" }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--session <id>` | string | stdin `session_id`, then a generated id | Sets the session id Claude Code reported. |

The runtime is always `claude-code`. The hook launcher appends `env`, plus `DOCKO_ROOT`, to
`$CLAUDE_ENV_FILE` so later tool calls in the same session inherit them.

## `docko adapter claude-code session-end`

Ends a Claude Code session from the `SessionEnd` hook.

```bash
docko adapter claude-code session-end --root ./workspace --session leader
```

```json
{ "ok": true }
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--session <id>` | string | stdin `session_id`, then `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID` | Names the session to end. |

When no session can be resolved the command returns `{ "ok": true }` and exits `0`.

## `docko adapter claude-code pre-tool-use`

Answers a write authorization question from the `PreToolUse` hook. It reads the pending file path
from stdin as `file_path` or `tool_input.file_path`.

```bash
docko adapter claude-code pre-tool-use --root ./workspace --session other-session
```

```json
{
  "allow": false,
  "reason": "unrelated-session",
  "session_id": "other-session",
  "resource_id": "backend.main_1",
  "owner_session_id": "agent-1",
  "owner_task": "update backend auth",
  "owner_branch": "feat/api",
  "owner_session_active": true,
  "expired_at": null,
  "claim_stale_after_ms": 3600000,
  "previous_owner_session_id": null,
  "application_id": "backend",
  "slot_path": "<workspace-root>/slots/backend/main_1",
  "invalid_slot_dir": null,
  "session_known": false,
  "workspace_root": "<workspace-root>"
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--session <id>` | string | stdin `session_id`, then normal session resolution | Names the session that wants to write. |

### Notes

- `reason` is one of `path-not-managed`, `owner`, `delegated` (allowed) or `slot-not-claimed`,
  `claim-expired`, `unrelated-session` (denied).
- A payload with no file path returns `{"allow": true, "reason": "no-file-path"}` and nothing else.
- A write outside the managed slots returns `allow: true` without taking the registry lock, and
  `resource_id`, `owner_session_id`, and `slot_path` are `null`.
- `slot_path` is absolute, so a deny message can name a directory a shell can enter.

## `docko adapter claude-code subagent-start`

Starts a delegated child session from the `SubagentStart` hook and inherits the parent's
delegations.

```bash
docko adapter claude-code subagent-start --root ./workspace --session leader
```

```json
{
  "additionalContext": "You are a delegated teammate. Parent session: leader. Your session: ses_fd734a0d62424d9a965e89f21e32bd61.",
  "env": {
    "DOCKO_SESSION_ID": "ses_fd734a0d62424d9a965e89f21e32bd61",
    "DOCKO_PARENT_SESSION_ID": "leader",
    "DOCKO_RUNTIME": "claude-code"
  }
}
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `--session <id>` | string | stdin `parent_session_id`, then `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID` | Names the parent session. |

Without a parent session the command fails with `USAGE_ERROR`. The child session is created with
`actor_mode: "delegated"` and runtime `claude-code`.

## Related

- [Errors](errors.md): every error code, its exit code, and its fix.
- [Protocol](protocol.md): what a claim, a delegation, and stale recovery mean.
- [State files](state-files.md): the registry and session manifest fields these payloads mirror.
- [Use docko with Claude Code](claude-code.md): the hooks that call the adapter commands.
- [Quickstart](quickstart.md): the shortest path from install to a claimed slot.
- [Troubleshooting](troubleshooting.md): symptom-first fixes.
