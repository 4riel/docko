# State files

docko keeps every piece of coordination state in plain files under the workspace root. This page
describes each file and each field it carries. [Protocol](protocol.md) states the rules that change
them.

## Workspace layout

`docko init` creates `docko/` and `slots/`. The rest of the tree appears as sessions start, claim,
and release.

```text
workspace/
|-- slots/                        <- writable directories agents work in
|   |-- main/                     <- flat slot, resource id "main"
|   `-- backend/                  <- application slot pool
|       |-- main_1/               <- resource id "backend.main_1"
|       `-- main_2/
`-- docko/
    |-- registry.json             <- canonical workspace, application, and claim state
    |-- registry.md               <- generated mirror, never authoritative
    |-- .registry.lock/           <- registry lock, present only while a mutation runs
    |   `-- owner.json
    |-- sessions/
    |   |-- <session-id>.json     <- one manifest per active session
    |   `-- ended/
    |       `-- <session-id>.json <- manifests kept for the retention window
    `-- logs/
        `-- YYYY-MM-DD.jsonl      <- one debug log file per UTC day
```

A flat slot lives at `slots/<slot-id>` and carries the resource id `<slot-id>`. An application slot
lives at `slots/<application-id>/<slot-name>` and carries the resource id
`<application-id>.<slot-name>`.

Every `resource_type`, `resource_id`, `application_id`, and `session_id` matches the safe-id rule:
it starts with a word character, continues with word characters, `-`, or `.`, and never contains
`..`. Slot discovery skips a directory under `slots/` whose name breaks that rule and reports it as
`ignored_slot_dirs`.

## `docko/registry.json`

The registry is the canonical machine state for the workspace, its applications, its resources, and
their claims and delegations. Session manifests are not inlined here.

```json
{
  "schema_version": "0.1.0",
  "generated_at": "2026-09-07T07:14:33.173Z",
  "workspace": {
    "workspace_id": "wk_8277ca7ec6e54af7a3029a1af84f6ca8",
    "workspace_root": "/Users/example/workspace",
    "name": "workspace",
    "config": {
      "janitor": { "slot_stale_after_ms": 3600000, "session_stale_after_ms": 28800000 },
      "scheduler": { "last_slot_id": { "backend": "backend.main_2", "_default": "main" } }
    }
  },
  "applications": [
    {
      "application_id": "backend",
      "name": "Backend",
      "description": "Backend API service",
      "keywords": ["backend", "api"],
      "source_path": null
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
        "owner_session_id": "ses_owner",
        "runtime": "portable",
        "branch": "feat/protocol",
        "task": "document the protocol",
        "claimed_at": "2026-09-07T07:14:32.460Z",
        "updated_at": "2026-09-07T07:14:32.460Z",
        "heartbeat_at": "2026-09-07T07:14:32.460Z",
        "stale_after_ms": 3600000,
        "release_reason": null
      },
      "delegations": [
        {
          "child_session_id": "ses_child",
          "granted_by_session_id": "ses_owner",
          "granted_at": "2026-09-07T07:14:32.690Z",
          "scope": "write"
        }
      ],
      "last_claim": {
        "owner_session_id": "ses_owner",
        "released_at": "2026-09-07T07:14:32.225Z",
        "reason": "manual",
        "branch": "feat/protocol",
        "task": "document the protocol",
        "stale_after_ms": 3600000
      }
    }
  ]
}
```

### Document fields

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | string | Protocol schema version of the document. The current value is `0.1.0`. |
| `generated_at` | string | Timestamp of the most recent registry write. |
| `workspace` | object | Workspace descriptor. |
| `applications` | array | Application descriptors, sorted by `application_id`. |
| `resources` | array | Claimable resources, sorted by `resource_id`. |

All five fields are required.

### Workspace fields

| Field | Type | Description |
| --- | --- | --- |
| `workspace_id` | string | Stable identifier generated at first write as `wk_<uuid>`. |
| `workspace_root` | path | Absolute path to the workspace root, rewritten on every read. |
| `name` | string | Human-facing label, `workspace` unless you change it. |
| `config.janitor.slot_stale_after_ms` | number | Stale window written onto future slot claims. |
| `config.janitor.session_stale_after_ms` | number | Quiet time after which the janitor ends a session. |
| `config.scheduler.last_slot_id` | object | Round-robin cursor per application key. |

`workspace_id`, `workspace_root`, and `name` are required. `config` is absent until `docko init`
receives `--slot-stale-after-ms` or `--session-stale-after-ms`, or until `docko slot acquire` writes
a cursor. Each `last_slot_id` entry maps an `application_id`, or `_default` for the flat slot pool,
to the last slot id claimed through rotation.

### Application fields

| Field | Type | Description |
| --- | --- | --- |
| `application_id` | string | Identifier and the directory name under `slots/`. |
| `name` | string | Human-facing label, defaulting to `application_id`. |
| `description` | string or null | Free text. |
| `keywords` | array | Deduplicated terms matched against `--task` and `--branch` text. |
| `source_path` | path or null | Repository or clone used to seed the pool. |

`application_id` and `name` are required.

### Resource fields

| Field | Type | Description |
| --- | --- | --- |
| `resource_type` | string | `slot`, `shared-env`, or a custom safe id. |
| `resource_id` | string | Identifier, unique within a resource type. |
| `path` | path or null | Workspace-relative path for a filesystem-backed resource. |
| `application_id` | string or null | Application that owns this slot. |
| `slot_name` | string or null | Slot name inside the application pool. |
| `status` | `free` or `claimed` | Current ownership state. |
| `claim` | object or null | Ownership record, `null` while the resource is free. |
| `auto_acquire` | boolean | Written only as `false`, which pins the slot out of rotation. |
| `last_claim` | object or null | Snapshot of the claim that ended most recently. |
| `delegations` | array | Resource-scoped child authority records. |

`resource_type`, `resource_id`, and `status` are required, and `claim` is required when `status` is
`claimed`. A resource with `auto_acquire: false` keeps that field across slot rediscovery.

### Claim fields

| Field | Type | Description |
| --- | --- | --- |
| `owner_session_id` | string | Session that holds the claim. |
| `runtime` | string or null | Runtime recorded at claim time, inherited from the owner session. |
| `branch` | string or null | Claim metadata. docko never runs `git checkout`. |
| `task` | string or null | Claim metadata describing the work. |
| `claimed_at` | string | When the claim was taken. |
| `updated_at` | string | Last claim mutation. |
| `heartbeat_at` | string or null | Last heartbeat, explicit or from an authorized write. |
| `stale_after_ms` | number | Stale window resolved at claim time and compared by the janitor. |
| `release_reason` | string or null | `null` while active; a release snapshot carries the reason. |

Every claim field is required.

### `last_claim` fields

| Field | Type | Description |
| --- | --- | --- |
| `owner_session_id` | string | Session that held the claim. |
| `released_at` | string | When the claim ended. |
| `reason` | string | `manual`, `force-release`, `session-end`, or `stale-recovery`. |
| `branch` | string or null | Branch metadata copied from the claim. |
| `task` | string or null | Task metadata copied from the claim. |
| `stale_after_ms` | number or null | Stale window the ended claim used. |

`owner_session_id`, `released_at`, and `reason` are required.

### Delegation fields

| Field | Type | Description |
| --- | --- | --- |
| `child_session_id` | string | Session receiving resource-scoped authority. |
| `granted_by_session_id` | string | Owner session that granted it. |
| `granted_at` | string | When the record was written or last updated. |
| `scope` | `read` or `write` | Only `write` authorizes a file write. |

Every delegation field is required.

## `docko/sessions/<id>.json`

One manifest per active session. The shape is runtime-neutral even when a runtime adapter fills it
in.

```json
{
  "schema_version": "0.1.0",
  "session_id": "ses_child",
  "runtime": "portable",
  "actor_mode": "delegated",
  "parent_session_id": "ses_owner",
  "delegated_from_session_id": null,
  "started_at": "2026-09-07T07:14:31.308Z",
  "updated_at": "2026-09-07T07:14:43.731Z",
  "ended_at": null,
  "workspace_root": "/Users/example/workspace",
  "metadata": { "pid": 57352, "hostname": "della" }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | string | Protocol schema version of the manifest. |
| `session_id` | string | Identifier, generated as `ses_<uuid>` when you do not pass one. |
| `runtime` | string | Runtime name such as `portable` or `claude-code`. |
| `actor_mode` | `interactive`, `delegated`, or `automation` | How the session was started. |
| `parent_session_id` | string or null | Session that started this one. |
| `delegated_from_session_id` | string or null | Session that delegated authority to this one. |
| `started_at` | string | When the session started. |
| `updated_at` | string | Freshness signal read by stale recovery. |
| `ended_at` | string or null | `null` while the session is active. |
| `workspace_root` | path | Absolute workspace root the session was started against. |
| `metadata` | object | Open-ended runtime data such as `pid` and `hostname`. |

Every field is required. `docko session start` writes `pid` and `hostname` into `metadata`.

## `docko/sessions/ended/`

A session that ends is rewritten with `ended_at` and moved here, so the hot directory holds only
live work. The file keeps the same name and the same shape.

Manifests stay until their file is older than the retention window, `604800000` ms by default. A
touch on an ended manifest changes nothing, because rewriting the file would restart the clock that
decides when it is deleted.

## `docko/registry.md`

A generated Markdown mirror of the registry, rewritten whenever `registry.json` changes and on
demand by `docko render`. It holds one table of applications, one of slots, one of any other
resources, and a short notes block carrying the workspace stale defaults.

> **Warning:** The registry mirror is generated output. Editing it changes nothing, and the next
> registry write overwrites your edit.

## `docko/logs/`

Newline-delimited JSON, one file per UTC day, named `YYYY-MM-DD.jsonl`. Files older than the three
most recent UTC days are deleted once per process. Read the retained entries with `docko logs`.

| Field | Type | Description |
| --- | --- | --- |
| `timestamp` | string | When the entry was appended. |
| `operation` | string | Operation name such as `claim`, `release`, or `stale-recovery`. |
| `outcome` | `ok` or `error` | Whether the operation succeeded. |
| `session_id` | string or null | Acting session, when the operation had one. |
| `resource_type` | string or null | Resource type the operation touched. |
| `resource_id` | string or null | Resource id the operation touched. |
| `details` | object | Operation-specific summary, carrying `error` on a failure. |

## `docko/.registry.lock/`

The registry lock is a directory created with an atomic `mkdir`. It exists only while a process
holds it, and the holder stamps `owner.json` inside it.

| Field | Type | Description |
| --- | --- | --- |
| `pid` | number | Process id of the holder, diagnostic only. |
| `hostname` | string | Host of the holder. |
| `acquired_at` | string | When the stamp was written, refreshed every 10 seconds. |

Breaking an abandoned lock renames it to `docko/.registry.lock.stale-<random>` before deleting it.
An interrupted write leaves a sibling `<name>.<hex>.tmp` file that the next docko process reclaims
once it is older than five minutes. The same sweep also reclaims legacy `.docko-tmp-*` and
quarantined `.registry.lock.stale-*` directories.

## Schemas

The canonical shapes live in the repository and follow JSON Schema draft 2020-12.

| File | Identifier | Describes |
| --- | --- | --- |
| `schemas/registry.schema.json` | `https://docko.dev/schemas/registry.schema.json` | `docko/registry.json` |
| `schemas/session.schema.json` | `https://docko.dev/schemas/session.schema.json` | A session manifest |

Both schemas set `additionalProperties: true`, so a registry or manifest written by a newer docko
still validates against an older schema.

## Related

- [Protocol](protocol.md): the rules that create, change, and clear these files.
- [CLI reference](cli-reference.md): the commands that write them.
- [Errors](errors.md): what `CORRUPTED_REGISTRY`, `REGISTRY_LOCK_TIMEOUT`, and the rest mean.
- [Workspace layout](../examples/workspace-layout.md): a fully populated managed workspace.
- [Concepts](concepts.md): the vocabulary these fields use.
