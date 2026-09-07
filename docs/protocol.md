# Protocol Specification

## Purpose

`docko` is a local-first protocol for coordinating writable resources inside one workspace root.
The protocol is intentionally small:

- the canonical machine-readable state lives on disk
- claims and releases are explicit
- session identity is explicit
- stale recovery is cheap and deterministic
- runtime adapters may automate the workflow, but they do not redefine the rules

## Goals

- runtime-agnostic core semantics
- cheap filesystem reads and atomic writes
- explicit ownership and delegation
- safe crash and stale-session recovery
- one canonical registry plus separate session manifests

## Workspace Layout

```text
workspace/
|-- slots/
|   |-- main/
|   |-- backend/
|   |   |-- main_1/
|   |   `-- main_2/
|   `-- frontend/
|       `-- main_1/
`-- docko/
    |-- registry.json
    |-- registry.md
    |-- .registry.lock/
    |   `-- owner.json
    |-- sessions/
    |   |-- <session-id>.json
    |   |-- ...
    |   `-- ended/
    |       |-- <session-id>.json
    |       `-- ...
    `-- logs/
        |-- YYYY-MM-DD.jsonl
        `-- ...
```

## Canonical Persistence Surfaces

- `docko/registry.json`: canonical registry for workspace metadata, resources, claims, and delegations
- `docko/registry.md`: generated human mirror of the registry; best-effort output, never authoritative
- `docko/sessions/*.json`: one manifest per active session; sessions are not embedded in `registry.json`
- `docko/sessions/ended/*.json`: manifests of sessions that have ended, kept for the retention window
- `docko/logs/*.jsonl`: best-effort debug trail for recent operations
- `docko/.registry.lock/`: filesystem lock directory used to serialize registry mutations
- `docko/.registry.lock/owner.json`: `{ pid, hostname, acquired_at }` of the process holding the lock

## Core Entities

### Workspace

The workspace descriptor lives inside `registry.json` and identifies the managed root:

- `workspace_id`: stable workspace identifier
- `workspace_root`: absolute path to the managed workspace root
- `name`: human-facing label
- `config.janitor.slot_stale_after_ms`: optional default stale timeout for future slot claims
- `config.janitor.session_stale_after_ms`: optional quiet time after which the janitor ends an active session
- `config.scheduler.last_slot_id`: round-robin cursor for `slot acquire`, keyed by application id (or a default key for flat slot pools). Each entry records the last slot id claimed so the next acquire starts after it, leaving the just-released slot last in the ring

### Session Manifest

Each session is stored as its own file under `docko/sessions/`.
The manifest shape is runtime-agnostic even when an adapter populates it.

```json
{
  "schema_version": "0.1.0",
  "session_id": "ses_123",
  "runtime": "claude-code",
  "actor_mode": "delegated",
  "parent_session_id": "ses_parent",
  "delegated_from_session_id": "ses_parent",
  "started_at": "2026-03-21T08:11:22.000Z",
  "updated_at": "2026-03-21T08:15:11.000Z",
  "ended_at": null,
  "workspace_root": "/Users/example/workspace",
  "metadata": {
    "pid": 12345,
    "hostname": "mbp.local"
  }
}
```

Semantics:

- `session_id` must be unique among active sessions
- `actor_mode` is one of `interactive`, `delegated`, or `automation`
- `parent_session_id` records the parent session when the runtime started this session under another
- `delegated_from_session_id` records the session that delegated authority to this session when applicable
- `ended_at: null` means active; ended sessions remain on disk until explicitly cleaned up
- `updated_at` is the freshness signal used by stale recovery
- `metadata` is open-ended and may contain runtime-specific fields

### Registry Document

The registry tracks workspace-level state only. It does not inline session manifests.

```json
{
  "schema_version": "0.1.0",
  "generated_at": "2026-03-21T08:15:11.000Z",
  "workspace": {
    "workspace_id": "wk_123",
    "workspace_root": "/Users/example/workspace",
    "name": "workspace",
    "config": {
      "janitor": {
        "slot_stale_after_ms": 14400000,
        "session_stale_after_ms": 28800000
      },
      "scheduler": {
        "last_slot_id": {
          "_default": "main"
        }
      }
    }
  },
  "applications": [
    {
      "application_id": "backend",
      "name": "Backend",
      "description": "Backend API service",
      "keywords": ["backend", "api"],
      "source_path": "/Users/example/code/backend"
    }
  ],
  "resources": [
    {
      "resource_type": "slot",
      "resource_id": "backend.main_1",
      "path": "slots/backend/main_1",
      "application_id": "backend",
      "slot_name": "main_1",
      "status": "claimed",
      "claim": {
        "owner_session_id": "ses_123",
        "runtime": "claude-code",
        "branch": "feat/protocol",
        "task": "document the protocol",
        "claimed_at": "2026-03-21T08:12:00.000Z",
        "updated_at": "2026-03-21T08:15:11.000Z",
        "heartbeat_at": "2026-03-21T08:15:11.000Z",
        "stale_after_ms": 14400000,
        "release_reason": null
      },
      "last_claim": {
        "owner_session_id": "ses_previous",
        "released_at": "2026-03-21T08:11:00.000Z",
        "reason": "stale-recovery",
        "branch": "feat/previous",
        "task": "previous task",
        "stale_after_ms": 14400000
      },
      "delegations": [
        {
          "child_session_id": "ses_child",
          "granted_by_session_id": "ses_123",
          "granted_at": "2026-03-21T08:13:01.000Z",
          "scope": "write"
        }
      ]
    }
  ]
}
```

## Resource Model

### Resource Types

The core recognizes three contract-level resource classes:

- `slot`: a writable directory under `slots/`
- `shared-env`: a named shared environment such as staging or a long-lived service
- `custom`: any other runtime-neutral resource type registered explicitly

Custom resource types are allowed as safe string identifiers. The core does not hardcode extra semantics for them beyond claim ownership and stale recovery.

A slot may carry `auto_acquire: false`. Round-robin selection (`slot acquire`) skips such a slot; an explicit claim or `--prefer` still reaches it. The field is only written for the opt-out (omitted means `true`) and survives slot rediscovery.

### Applications

Applications are optional workspace-level descriptors stored in the registry.

They let one workspace define multiple slot pools such as `backend` and `frontend`, each with:

- `application_id`
- `name`
- `description`
- `keywords`
- `source_path`

The CLI may use those keywords to infer the correct application when the task text clearly says things like "update backend auth" or "refresh frontend landing page".

### Resource Identity

`resource_type`, `resource_id`, and `session_id` must match the safe ID rule used by the core:

- start with a word character
- continue with word characters, `-`, or `.`
- never contain `..`

### Slot Discovery

Slot resources are discovered from `workspace/slots/*`.

Rules:

- `init`, `status`, `claim`, `release`, `delegate`, `heartbeat`, `render`, and write-authorization all run through the same registry mutation path
- that path re-discovers slot directories before it reads or writes registry state
- free slot resources that no longer exist on disk are removed from the registry
- claimed slot resources are preserved in the registry even if the directory is currently missing, so ownership is not silently discarded
- legacy flat slots are tracked as `slots/<slot-id>` with `resource_id: "<slot-id>"`
- application-aware slots are tracked as `slots/<application-id>/<slot-name>` with `resource_id: "<application-id>.<slot-name>"`
- application-aware slots also record `application_id` and `slot_name`
- a slot or application directory whose name is not a valid resource id is skipped: it would be discovered but never claimable, which left writes into it denied forever. Skipped directories are reported as `ignored_slot_dirs` in the status payload, and writes into them are still denied — the fix is to rename the directory

### Non-Slot Resources

`shared-env` and custom resources enter the registry only through `docko resource ensure`.

Rules:

- they are not auto-discovered from the filesystem
- `path` may be `null`
- `resource ensure` may update the path of an existing non-slot resource only while that resource is free
- `resource ensure` does not let callers redefine slot paths

## Session Lifecycle

### Start

`docko session start` creates a manifest file and returns a session identifier.

Rules:

- if `--session` is omitted, the core generates a `ses_<uuid>` identifier
- reusing an active session ID is an ownership conflict
- when `parent_session_id` is supplied, the parent session must already exist and still be active

### Resolve

Commands that need a session resolve it in this order:

1. explicit `--session`
2. the environment session id (`DOCKO_SESSION_ID`), but only when it names an active session
3. the only active session in `docko/sessions/`

An environment id that matches no active session is ignored rather than fatal: a runtime that
exports a session id docko never saw still resolves through single-active resolution.

If no active session exists, the command fails with `NO_ACTIVE_SESSION`.
If more than one active session exists and neither an explicit nor a matching environment id is
available, the command fails with `AMBIGUOUS_SESSION`.

The `AMBIGUOUS_SESSION` payload carries:

- `active_session_count`: how many sessions are active
- `active_sessions`: the 10 most recently updated candidates, newest first
- `newest_session_id`: the newest interactive candidate, for a copy-pastable `--session <id>`
- `next_steps`: safe recovery steps that never suggest ending unrelated sessions
- `resolution`: the explicit and environment ids that were considered

### Current And List

- `docko session current` returns the resolved session and refreshes `updated_at`
- `docko session list` returns only active sessions

### End

`docko session end` is the normal shutdown path.

Rules:

- it releases every claim owned by that session
- it ends any delegated child sessions whose `parent_session_id` or `delegated_from_session_id` matches the ending session
- if the manifest file exists, it marks the manifest with `ended_at` and updates `updated_at`
- it moves the manifest to `docko/sessions/ended/`, so the hot directory only holds live sessions
- it does not delete the manifest

Ended manifests are read back by `session current` and by any lookup of a specific session id.
They are removed only by the retention sweep described in [Prune](#prune).

### Prune

`docko session prune` is the recovery path for sessions that never ran `session end`, and the
reclaim path for ended manifests on disk.

Rules:

- it applies the same session janitor pass described in [Stale Recovery](#stale-recovery)
- `--max-age-ms <n>` overrides the workspace session stale window for that run only
- it deletes ended manifests older than the retention window (default `604800000`, seven days)
- the result reports `retention_ms` and `deleted_manifests`
- `--dry-run` reports the sessions that would be ended and the manifests that would be deleted, and writes nothing
- it does not cascade to delegated children; each session is judged on its own quiet time

## Claim Lifecycle

### Claim

A successful claim records exactly one owner:

```text
free -> claimed
```

On claim:

- the session must exist and be active
- the resource must be free after stale cleanup has already run
- the resource becomes `claimed`
- `claim.owner_session_id` is set to the claiming session
- `claim.runtime` is set from the explicit claim option, or inherited from the owning session's runtime
- `claim.claimed_at`, `claim.updated_at`, and `claim.heartbeat_at` are initialized to the current timestamp
- `claim.release_reason` is reset to `null`
- existing delegations are cleared

### Heartbeat

`docko heartbeat` is an owner-only update:

```text
claimed -> claimed
```

It refreshes:

- `claim.updated_at`
- `claim.heartbeat_at`
- the session manifest `updated_at`

An authorized file write inside a claimed slot refreshes the same fields implicitly, so active
work never goes stale while it is happening. That refresh is throttled, and the throttle scales
with the claim's own stale window so a short window still gets several refreshes inside it:

```text
throttle = min(30_000, max(1_000, floor(claim.stale_after_ms / 4)))
```

Between refreshes the registry is left untouched.

### Release

Normal release is owner-only:

```text
claimed -> free
```

Rules:

- the registry record is cleared back to `status: "free"`, `claim: null`, and `delegations: []`
- the released claim is recorded on the resource as `last_claim` with the release reason
- the command response returns a snapshot of the previous claimed state
- that snapshot uses `release_reason: "manual"` by default
- `--reason <text>` overrides the release reason in the returned snapshot
- `--force` allows a non-owner to recover the resource and defaults the returned reason to `"force-release"` when no explicit reason is supplied

## Ownership And Delegation

### Ownership

- every claimed resource has exactly one owner session
- only the owner can heartbeat the claim
- only the owner can delegate child authority
- only the owner can release normally
- `--force` release is the only built-in non-owner recovery path

### Delegation

Delegation is explicit per resource. Session ancestry alone does not grant write authority.

Each delegation records:

- `child_session_id`
- `granted_by_session_id`
- `granted_at`
- `scope`: `read` or `write`

Rules:

- the parent session must actively own the resource when delegation is granted
- the child session must exist and be active when delegation is granted
- delegation never changes `owner_session_id`
- granting delegation to the same child again updates the existing record instead of creating duplicates
- `read` delegation is informational in the core contract; it does not authorize file writes
- file-write authorization accepts only owner sessions or delegated children with `scope: "write"`

### Delegation Lifetime

Child authority exists only while the parent claim remains active.

That means child write access ends immediately when:

- the owner releases the claim
- stale recovery clears the claim
- session-end cleanup releases the owner's claims and ends delegated children

## Stale Recovery

Stale recovery runs before registry-backed reads and writes.

### Thresholds

Per-claim stale timeout:

- slot: claim value if present, otherwise `workspace.config.janitor.slot_stale_after_ms`, otherwise `3600000`
- shared-env: `600000`
- custom and other resource types: `1800000`

### Freshness Source

Freshness is evaluated from the latest active session activity that is relevant to the resource:

1. take the newest `updated_at` across the owner session and any delegated child sessions whose manifests are still active
2. if no relevant active manifest exists, fall back to the claim timestamps: `heartbeat_at`, then `updated_at`, then `claimed_at`

Important clarifications:

- active delegated child activity can keep a parent-owned claim fresh
- ended or missing session manifests do not count as fresh activity
- invalid timestamps are treated as stale

### Recovery Result

When a claim is stale:

- the janitor records a snapshot of the pre-release resource with `release_reason: "stale-recovery"`
- the live registry entry is reset to `status: "free"`, `claim: null`, and `delegations: []`
- the resource keeps `last_claim` with `reason: "stale-recovery"`, so a later write by the lapsed owner is answered with `claim-expired` instead of a bare `slot-not-claimed`
- `docko status` reports the released snapshots under `janitor.released_claims`
- the debug log records a `stale-recovery` entry

### Stale Sessions

The same janitor pass also ends sessions that stopped reporting activity, so a crashed or abandoned
runtime does not stay active forever.

Threshold:

- `workspace.config.janitor.session_stale_after_ms`, otherwise `28800000` (8 hours)

Rules:

- only sessions without `ended_at` are considered, using `updated_at` as the activity source
- invalid timestamps are treated as stale
- sessions are evaluated after claim recovery, so a claim released in the same pass no longer protects its owner
- a session that still owns, or is delegated, a claim that survived the pass is never ended
- ending a stale session marks and relocates the manifest exactly like `session end` does; the file is not deleted
- one pass ends at most 100 stale sessions; when more remain, `janitor.ended_sessions_truncated` is `true` and the next pass continues
- a pass also deletes ended manifests past the retention window, at most 200 per pass, reported as `janitor.deleted_manifests`
- `docko status` reports the ended manifests under `janitor.ended_sessions`
- the debug log records a `stale-session-recovery` entry

## File-Write Authorization

The core write-authorization check is intentionally narrow.

Rules:

- it applies only to paths inside managed slot directories
- non-slot resources are not part of file-path authorization
- paths outside managed slots are allowed with reason `path-not-managed`
- writes into a free slot are denied with reason `slot-not-claimed`
- writes into a slot whose claim the janitor released, by the session that held it, are denied with reason `claim-expired`
- writes by the owner are allowed with reason `owner`
- writes by a child with explicit `write` delegation are allowed with reason `delegated`
- all other writes into a claimed slot are denied with reason `unrelated-session`

The reason vocabulary is closed. Core exports it as `AUTHORIZATION_REASONS`.

The result carries enough context to explain itself:

- `session_id`, `resource_id`, `owner_session_id`
- `owner_task`, `owner_branch`: what the owner is doing
- `owner_session_active`: whether the owner session is still active, or `null` when unknown
- `expired_at`: when the lapsed claim was released, for `claim-expired`
- `claim_stale_after_ms`: the stale window of the current or last claim
- `previous_owner_session_id`: who held the slot last, when it is currently free
- `application_id` and `slot_path`: the slot's identity, so an adapter can render a usable retry command
- `invalid_slot_dir`: the offending directory when the write targets a slot directory whose name is not a valid resource id
- `session_known`: whether the acting session is registered and active. `false` means the runtime's SessionStart hook never ran, so the session owns nothing; `null` on the unlocked fast path, which does not read session state

An unregistered or ended session is answered, not rejected: it is evaluated as a session with no
claims and no delegations, so a write inside `slots/` is denied with its natural reason and
`session_known: false`. Failing the check instead let a fail-open adapter allow the write.

Cost model:

- a path outside the workspace's `slots/` tree is answered from an unlocked registry read: no registry lock, no session read, and no registry or session writes (abandoned temp artifacts are still swept)
- a path anywhere under `slots/` takes the normal locked path, whether or not a resource exists for it yet: slot discovery runs there, so a directory created since the last mutation is answered as the unclaimed slot it is, not as an unmanaged path
- an allowed write by the owner or a delegate refreshes the claim heartbeat, throttled to `min(30_000, max(1_000, floor(claim.stale_after_ms / 4)))` ms

## Status And Mirror Semantics

### Status

`docko status` returns a status payload, not the raw registry file.

It includes:

- `schema_version`
- `workspace`
- `applications`
- filtered `resources`
- `ignored_slot_dirs`
- `janitor.released_claims`
- `janitor.ended_sessions`, `janitor.ended_sessions_truncated`, `janitor.deleted_manifests`

Reads do not rewrite state. `status`, `session list`, and `logs` leave `registry.json` and
`registry.md` byte-identical unless the janitor actually changed something in that pass.

### Mirror

`docko/registry.md` is regenerated whenever `registry.json` changes, and on demand by `docko render`.

It is a human summary only. It exists to answer operational questions quickly, not to define the
contract, so rendering it is best effort: a failed mirror write is logged and never fails the command.

## Logs

Debug logs are best-effort and never block normal protocol operations.

Rules:

- entries are newline-delimited JSON
- files rotate by UTC day
- retention keeps the most recent 3 UTC days
- `docko logs` reads recent entries newest-first and clamps the query window to retained days
- retention is enforced once per process, not on every append

## Concurrency And Writes

Registry-backed operations serialize on `docko/.registry.lock/`, a lock directory created with an
atomic `mkdir`.

Rules:

- the holder writes `owner.json` (`pid`, `hostname`, `acquired_at`) inside the lock directory, then reads it back: only the process whose stamp survived holds the lock, so a directory removed between the `mkdir` and the stamp does not hand two processes the same lock
- a waiter polls with jittered backoff (10 ms up to 100 ms) for up to 10 seconds
- the holder re-stamps `owner.json` every 10 seconds on an unref'd timer and moves the lock directory's mtime with it, so a living holder stays fresh however long its operation runs
- a lock older than 30 seconds is treated as abandoned and may be broken. Staleness is judged purely by age, from the older of `owner.json`'s `acquired_at` and the lock directory's mtime; a timestamp more than a second in the future (clock skew, a restored backup) counts as the oldest possible time rather than postponing recovery forever, while a sub-second difference is filesystem timestamp precision and reads as "now". The recorded pid is diagnostic only and is never probed for liveness
- breaking a lock renames it to a unique `docko/.registry.lock.stale-<random>` and deletes that, so only the process that won the rename breaks it and no one deletes a lock a third process has already re-created
- the holder re-checks its stamp immediately before persisting the registry. If the lock was broken under it, the operation fails with `REGISTRY_LOCK_LOST` (exit 2) and writes nothing; retrying the command is the fix
- the holder releases the lock only while it still owns it, so a lock broken and re-acquired by another process is never deleted from underneath it
- a locked operation on a root with no `docko/` directory fails with `WORKSPACE_NOT_INITIALIZED`, not a raw filesystem error

Every registry and manifest write is atomic: content is written to a sibling temp file and renamed
over the target. A rename that fails for a transient reason (`EPERM`, `EBUSY`, `EACCES`,
`ENOTEMPTY` — typical of Windows file scanners and concurrent readers) is retried with backoff, and
exhausting the budget raises `ATOMIC_WRITE_FAILED`. Temp artifacts left behind by killed processes
are swept once per process, on both the registry read and write paths, across `docko/`,
`docko/sessions/`, and `docko/sessions/ended/`.

## Runtime-Neutral CLI Contract

The stable runtime-neutral command surface is:

```text
docko init --root <path> [--slot-stale-after-ms <n>]
docko app ensure --root <path> --id <app-id> [--name <text>] [--description <text>] [--keyword <term>]... [--source <path>] [--slots <n>] [--slot-base <id>] [--slot <id>]...
docko slot acquire --root <path> [--session <id>] [--application <app-id>] [--branch <name>] [--task <text>] [--runtime <name>] [--stale-after-ms <n>] [--clone-when-busy] [--clone-from <path-or-slot>] [--clone-slot <id>] [--brief]
docko slot duplicate --root <path> [--application <app-id>] --from <path-or-slot> --to <slot-id>
docko status [--root <path>] [--resource <type>] [--id <id>] [--application <app-id>] [--brief]
docko logs [--root <path>] [--days <n>] [--limit <n>]
docko claim --root <path> [--session <id>] --resource <type> --id <id> [--branch <name>] [--task <text>] [--runtime <name>] [--stale-after-ms <n>]
docko heartbeat --root <path> [--session <id>] --resource <type> --id <id>
docko release --root <path> [--session <id>] --resource <type> --id <id> [--reason <text>] [--force]
docko delegate --root <path> [--session <id>] --child-session <id> --resource <type> --id <id> [--scope read|write]
docko resource ensure --root <path> --resource <type> --id <id> [--path <path>]
docko render --root <path>
docko session start --root <path> --runtime <name> [--session <id>] [--parent-session <id>] [--delegated-from-session <id>] [--actor-mode interactive|delegated|automation]
docko session end --root <path> [--session <id>]
docko session current --root <path> [--session <id>] [--id-only]
docko session list --root <path> [--brief]
docko session prune --root <path> [--max-age-ms <n>] [--dry-run] [--brief]
```

Runtime-specific adapter commands exist under adapter namespaces and may automate these flows, but they must preserve the same claim, ownership, and stale-recovery semantics.

## Error Contract

Fatal errors are emitted as structured JSON on stderr.
Successful command payloads are emitted as JSON on stdout unless a command intentionally returns plain text.
Some CLI commands also support `--brief`, which is an output projection only. It does not change registry, session, claim, delegation, or stale-recovery semantics.

Current exit codes:

- `0`: success
- `1`: usage error, invalid input, or missing resource
- `2`: ownership or active-ID conflict
- `3`: ambiguous session resolution
- `4`: missing, ended, or otherwise unavailable session
- `5`: corrupted registry

Representative error codes include:

- `USAGE_ERROR`
- `INVALID_ID`
- `NO_ACTIVE_SESSION`
- `AMBIGUOUS_SESSION`
- `SESSION_NOT_FOUND`
- `SESSION_ID_CONFLICT`
- `RESOURCE_NOT_FOUND`
- `RESOURCE_NOT_CLAIMED`
- `RESOURCE_ALREADY_CLAIMED`
- `RESOURCE_OWNED_BY_OTHER_SESSION`
- `RESOURCE_MUTATION_DENIED`
- `ROOT_INSIDE_SLOT`
- `ROOT_NOT_WORKSPACE`
- `CORRUPTED_REGISTRY`
- `WORKSPACE_NOT_INITIALIZED`
- `REGISTRY_LOCK_TIMEOUT`
- `REGISTRY_LOCK_LOST`
- `ATOMIC_WRITE_FAILED`

## Architectural Boundaries

- `packages/core` defines protocol semantics and the on-disk contract
- `schemas/` define the canonical registry and session shapes
- `packages/cli` parses flags, resolves sessions, and shapes command output
- `packages/adapters/*` automate runtime-specific integration without changing core claim semantics

That split is part of the contract: adapters may enrich metadata and automate delegation flows, but ownership, release, stale cleanup, and registry/session persistence remain core responsibilities.
