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
    |-- sessions/
    |   |-- <session-id>.json
    |   `-- ...
    `-- logs/
        |-- YYYY-MM-DD.jsonl
        `-- ...
```

## Canonical Persistence Surfaces

- `docko/registry.json`: canonical registry for workspace metadata, resources, claims, and delegations
- `docko/registry.md`: generated human mirror of the registry; never authoritative
- `docko/sessions/*.json`: one manifest per session; sessions are not embedded in `registry.json`
- `docko/logs/*.jsonl`: best-effort debug trail for recent operations
- `docko/.registry.lock/`: filesystem lock directory used to serialize registry mutations

## Core Entities

### Workspace

The workspace descriptor lives inside `registry.json` and identifies the managed root:

- `workspace_id`: stable workspace identifier
- `workspace_root`: absolute path to the managed workspace root
- `name`: human-facing label
- `config.janitor.slot_stale_after_ms`: optional default stale timeout for future slot claims
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
        "slot_stale_after_ms": 14400000
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
2. `DOCKO_SESSION_ID` from the environment
3. the only active session in `docko/sessions/`

If none exist, the command fails with `NO_ACTIVE_SESSION`.
If more than one active session exists and neither `--session` nor `DOCKO_SESSION_ID` is set, the command fails with `AMBIGUOUS_SESSION`.
The error payload includes compact active session candidates and safe next steps so agents can retry with an explicit `--session <id>` without ending unrelated sessions.

### Current And List

- `docko session current` returns the resolved session and refreshes `updated_at`
- `docko session list` returns only active sessions

### End

`docko session end` is the normal shutdown path.

Rules:

- it releases every claim owned by that session
- it ends any delegated child sessions whose `parent_session_id` or `delegated_from_session_id` matches the ending session
- if the manifest file exists, it marks the manifest with `ended_at` and updates `updated_at`
- it does not remove the manifest file by default

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

### Release

Normal release is owner-only:

```text
claimed -> free
```

Rules:

- the registry record is cleared back to `status: "free"`, `claim: null`, and `delegations: []`
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
- `docko status` reports the released snapshots under `janitor.released_claims`
- the debug log records a `stale-recovery` entry

## File-Write Authorization

The core write-authorization check is intentionally narrow.

Rules:

- it applies only to paths inside managed slot directories
- non-slot resources are not part of file-path authorization
- paths outside managed slots are allowed with reason `path-not-managed`
- writes into a free slot are denied with reason `slot-not-claimed`
- writes by the owner are allowed with reason `owner-session`
- writes by a child with explicit `write` delegation are allowed with reason `delegated-child`
- all other writes into a claimed slot are denied with reason `unrelated-session`

## Status And Mirror Semantics

### Status

`docko status` returns a status payload, not the raw registry file.

It includes:

- `schema_version`
- `workspace`
- `applications`
- filtered `resources`
- `janitor.released_claims`

### Mirror

`docko/registry.md` is generated after every registry mutation.

It is a human summary only. It exists to answer operational questions quickly, not to define the contract.

## Logs

Debug logs are best-effort and never block normal protocol operations.

Rules:

- entries are newline-delimited JSON
- files rotate by UTC day
- retention keeps the most recent 3 UTC days
- `docko logs` reads recent entries newest-first and clamps the query window to retained days

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
- `CORRUPTED_REGISTRY`

## Architectural Boundaries

- `packages/core` defines protocol semantics and the on-disk contract
- `schemas/` define the canonical registry and session shapes
- `packages/cli` parses flags, resolves sessions, and shapes command output
- `packages/adapters/*` automate runtime-specific integration without changing core claim semantics

That split is part of the contract: adapters may enrich metadata and automate delegation flows, but ownership, release, stale cleanup, and registry/session persistence remain core responsibilities.
