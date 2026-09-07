# Protocol

This is the normative specification for docko: what a session, a claim, a delegation, and stale
recovery mean, and what a conforming implementation must do. It describes the core package that
every command and every runtime adapter goes through. [State files](state-files.md) documents the
shapes it writes.

## Scope and guarantees

The protocol covers one workspace root and the resources, sessions, claims, and delegations inside
it. It does not touch the contents of a slot, run git, or coordinate anything across two workspace
roots.

A conforming implementation guarantees the following.

- The canonical state is on disk. There is no daemon and no background process.
- Claims and releases are explicit. Ownership never changes as a side effect of reading.
- Session identity is explicit. Ancestry alone grants nothing.
- Registry mutations serialize on the registry lock, and every registry and manifest write is
  atomic.
- Stale recovery runs before every registry-backed read and write, on the same code path.
- A runtime adapter may automate the flow and enrich metadata. It never redefines ownership,
  release, or stale semantics.

Fatal errors are structured JSON on stderr with a non-zero exit code, and successful payloads are
JSON on stdout. [Errors](errors.md) lists every code and exit code.

docko coordinates sessions that cooperate. It is not a security boundary. See
[Security](../SECURITY.md).

## Resource model

A resource is anything one session can own exclusively. The protocol recognizes three classes.

| Resource type | Enters the registry through | Path |
| --- | --- | --- |
| `slot` | Slot discovery under `slots/` | `slots/<slot-id>` or `slots/<application-id>/<slot-name>` |
| `shared-env` | `docko resource ensure` | Optional, may be `null` |
| Custom safe id | `docko resource ensure` | Optional, may be `null` |

The core adds no semantics to a custom resource type beyond claim ownership and stale recovery.

### Slot discovery

Slot resources are discovered from `slots/*` on every registry mutation path, so a directory created
since the last write is seen by the operation that follows it.

- A flat slot is tracked at `slots/<slot-id>` with `resource_id` `<slot-id>`.
- An application slot is tracked at `slots/<application-id>/<slot-name>` with `resource_id`
  `<application-id>.<slot-name>`, plus `application_id` and `slot_name`.
- A free slot resource whose directory no longer exists is dropped from the registry.
- A claimed slot resource whose directory is missing is preserved, so ownership is never discarded
  silently.
- A directory whose name is not a valid resource id is skipped, reported as `ignored_slot_dirs`, and
  writes into it are denied. Rename the directory to make it claimable.
- A slot with `auto_acquire: false` is skipped by `docko slot acquire` rotation and stays reachable
  by an explicit claim or by `--prefer`. The field survives rediscovery.

### Applications

An application is an optional workspace-level descriptor that gives a set of slots its own pool. It
carries `application_id`, `name`, `description`, `keywords`, and `source_path`.

An implementation may match an application's `keywords` against `--task` and `--branch` text to
infer which pool an acquire belongs to. Registering an application whose id collides with an
existing flat slot is refused unless that slot is free and its directory already holds nested slot
directories.

### Non-slot resources

`shared-env` and custom resources are never auto-discovered. `docko resource ensure` may change the
path of an existing non-slot resource only while that resource is free, and may not redefine a slot
path.

## Session lifecycle

A session is a runtime execution identity. Every claim, release, delegation, and write check names
one.

### Start

`docko session start` writes a manifest and returns its identifier. The core generates
`ses_<uuid>` when you pass no `--session`. Reusing the id of an active session is a conflict, and a
supplied `parent_session_id` must name a session that already exists and is still active.

### Resolve

A command that needs a session resolves one in this order.

1. An explicit `--session <id>`.
2. `DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, but only when the value names an active
   session.
3. The single active session in `docko/sessions/`.

An environment id that matches no active session is ignored rather than fatal, so a runtime that
exports an id docko never saw still resolves through the single-active rule. With no active session
the command fails with `NO_ACTIVE_SESSION`; with more than one and no usable id it fails with
`AMBIGUOUS_SESSION`, whose payload carries the candidates and a copy-pastable retry.

### End

`docko session end` is the normal shutdown path. It releases every claim the session owns with
reason `session-end`, ends any session whose `parent_session_id` or `delegated_from_session_id`
names it, stamps `ended_at`, and moves the manifest to `docko/sessions/ended/`. It never deletes a
manifest.

An ended manifest is still readable by a lookup of that specific id. Only the retention sweep
removes it.

### Prune

`docko session prune` runs the session half of stale recovery on demand and reclaims ended manifests
past the retention window. `--max-age-ms` overrides the workspace session stale window for that run,
`--retention-ms` overrides the manifest retention window, and `--dry-run` reports both sets without
writing. Prune judges each session on its own quiet time and does not cascade to delegated children.

## Claim lifecycle

A claim is the record that one session owns one resource. There is at most one claim per resource.

### Claim

```text
free -> claimed
```

The session must exist and be active, and the resource must be free after stale recovery has run in
the same pass. On success the resource becomes `claimed` and the claim records the owner, the
runtime (explicit, or inherited from the owner session), `claimed_at`, `updated_at`, and
`heartbeat_at` at the current time, the resolved `stale_after_ms`, and `release_reason: null`. Any
existing delegations are cleared.

> **Note:** `branch` and `task` are claim metadata. docko records them and never runs
> `git checkout`, and a claim reserves a slot rather than a branch, a pull request, or a file.

### Heartbeat

```text
claimed -> claimed
```

`docko heartbeat` is owner-only. It refreshes `claim.updated_at`, `claim.heartbeat_at`, and the
owner's session `updated_at`.

An authorized file write inside a claimed slot refreshes the same fields, so work in progress never
goes stale while it is happening. That refresh is throttled, and the throttle scales with the
claim's own stale window, so even a short window is refreshed well before it expires.

```text
throttle = min(30000, max(1000, floor(claim.stale_after_ms / 4)))
```

Between refreshes the registry is left untouched.

### Release

```text
claimed -> free
```

Release is owner-only unless you pass `--force`. The resource is reset to `status: "free"`,
`claim: null`, and `delegations: []`, and the released claim is recorded as `last_claim` with its
reason. The command returns a snapshot of the previous claimed state.

The reason is `manual` by default, `force-release` when `--force` is used without an explicit
reason, and whatever `--reason <text>` says when you supply one.

> **Warning:** `--force` takes a slot from a live session and clears its delegations. Use it for
> deliberate recovery, not as a retry.

## Ownership and delegation

Every claimed resource has exactly one owner session. Only the owner can heartbeat, delegate, or
release normally, and `--force` release is the only built-in non-owner recovery path.

Delegation is explicit per resource. It records `child_session_id`, `granted_by_session_id`,
`granted_at`, and a `scope` of `read` or `write`.

- The granting session must actively own the resource, and the child session must exist and be
  active.
- Delegation never changes `owner_session_id`.
- Granting to the same child again updates the existing record instead of adding a duplicate.
- `read` is informational in the core contract and authorizes no file write.
- File-write authorization accepts the owner session or a child delegated with `scope: "write"`.

Child authority lives only as long as the parent claim. It ends the moment the owner releases, the
janitor recovers the claim, or session-end cleanup runs.

## Stale recovery

Stale recovery runs before every registry-backed read and write, inside the registry lock. It
releases quiet claims first and ends quiet sessions second, so a claim recovered in a pass no longer
protects the session that abandoned it.

### Claim thresholds

The janitor always compares against the claim's own `stale_after_ms`, which is resolved when the
claim is taken.

| Resource type | Resolved stale window |
| --- | --- |
| `slot` | `--stale-after-ms`, else `workspace.config.janitor.slot_stale_after_ms`, else `3600000` |
| `shared-env` | `600000` |
| Custom safe id | `1800000` |

### Freshness

Freshness comes from the latest activity relevant to the resource, in this order.

1. The newest `updated_at` across the owner session and every delegated child session whose manifest
   is still active.
2. `claim.heartbeat_at`.
3. `claim.updated_at`.
4. `claim.claimed_at`.

Active delegated child activity keeps a parent-owned claim fresh. An ended or missing manifest
counts as no activity, and an unparseable timestamp counts as stale.

### Result

A stale claim is snapshotted with `release_reason: "stale-recovery"`, and the live entry is reset to
`status: "free"`, `claim: null`, and `delegations: []`. The resource keeps `last_claim` with reason
`stale-recovery`, which is what lets a later write by the lapsed owner be answered `claim-expired`
instead of a bare `slot-not-claimed`. `docko status` reports the snapshots under
`janitor.released_claims`, and the debug log records a `stale-recovery` entry.

### Stale sessions

The same pass ends active sessions that stopped reporting activity, using the session's `updated_at`
against `workspace.config.janitor.session_stale_after_ms`, otherwise `28800000`.

- Only sessions without `ended_at` are considered, and an unparseable timestamp counts as stale.
- A session that still owns or is delegated a claim that survived the pass is never ended.
- Ending a stale session marks and relocates the manifest exactly as `docko session end` does.
- One pass ends at most 100 sessions. When more remain, `janitor.ended_sessions_truncated` is `true`
  and the next pass continues.
- One pass also deletes at most 200 ended manifests older than `604800000` ms, reported as
  `janitor.deleted_manifests`.
- `docko status` reports the ended manifests under `janitor.ended_sessions`, and the debug log
  records a `stale-session-recovery` entry.

## File-write authorization

The write check is deliberately narrow: it answers for paths inside managed slot directories and
takes no position on anything else. Non-slot resources are outside file-path authorization.

| Reason | Outcome | Condition |
| --- | --- | --- |
| `path-not-managed` | allowed | The path is outside every managed slot. |
| `owner` | allowed | The acting session owns the claim. |
| `delegated` | allowed | The acting session holds a `write` delegation on the claim. |
| `slot-not-claimed` | denied | The slot is free, or its directory name is not a valid resource id. |
| `claim-expired` | denied | The janitor released this session's claim on the slot. |
| `unrelated-session` | denied | Another session owns the claim. |

The vocabulary is closed and the core exports it as `AUTHORIZATION_REASONS`.

The result carries enough context to explain itself without a second call: `session_id`,
`resource_id`, `owner_session_id`, `owner_task`, `owner_branch`, `owner_session_active`,
`expired_at`, `claim_stale_after_ms`, `previous_owner_session_id`, `application_id`, `slot_path`,
`invalid_slot_dir`, and `session_known`.

An unregistered or ended session is answered, not rejected. It is evaluated as a session that owns
nothing, so a write inside `slots/` is denied with its natural reason and `session_known: false`.
Rejecting it instead let a fail-open adapter allow the write.

The cost of a check depends on where the path is.

- A path outside the `slots/` tree is answered from an unlocked registry read: no registry lock, no
  session read, and no registry or session write.
- A path anywhere under `slots/` takes the locked path, whether or not a resource exists for it yet,
  because slot discovery runs there.
- An allowed write by the owner or a delegated child refreshes the claim heartbeat, throttled by the
  formula in [Claim lifecycle](#claim-lifecycle).

## Status and mirror semantics

`docko status` returns a status payload, not the raw registry file. The payload carries
`schema_version`, `workspace`, `applications`, the filtered `resources`, `ignored_slot_dirs`, and a
`janitor` block with `released_claims`, `ended_sessions`, `ended_sessions_truncated`, and
`deleted_manifests`.

Reads do not rewrite state. `status`, `session list`, and `logs` leave `registry.json` and
`registry.md` byte-identical unless the janitor changed something in that pass.

`docko/registry.md` is regenerated whenever `registry.json` changes, and on demand by
`docko render`. It is a human summary, so rendering is best effort: a failed mirror write is logged
and never fails the command.

## Logs

Debug logs are best effort and never block a protocol operation. Entries are newline-delimited JSON,
files rotate by UTC day, and retention keeps the three most recent UTC days.

`docko logs` reads recent entries newest first and clamps its window to the retained days.
Retention is enforced once per process rather than on every append.

## Concurrency and atomic writes

Registry-backed operations serialize on `docko/.registry.lock/`, a lock directory created with an
atomic `mkdir`.

- The holder writes `owner.json` inside the lock directory and reads it back. Only the process whose
  stamp survived holds the lock, so a directory removed between the `mkdir` and the stamp does not
  hand two processes the same lock.
- A waiter polls with jittered backoff, 10 ms up to 100 ms, for up to 10 seconds before failing with
  `REGISTRY_LOCK_TIMEOUT`.
- The holder re-stamps `owner.json` every 10 seconds and moves the lock directory's mtime with it,
  so a living holder stays fresh however long its operation runs.
- A lock older than 30 seconds counts as abandoned and may be broken. Staleness is judged by age
  alone, from the older of `acquired_at` and the directory mtime; a timestamp more than a second in
  the future counts as the oldest possible time. The recorded `pid` is diagnostic and is never
  probed for liveness.
- Breaking a lock renames it to `docko/.registry.lock.stale-<random>` and deletes that, so only the
  process that won the rename breaks it.
- The holder re-checks its stamp immediately before persisting. A lock broken underneath it fails
  the operation with `REGISTRY_LOCK_LOST` and writes nothing. Retrying the command is the fix.
- The holder releases the lock only while it still owns it.
- A locked operation on a root with no `docko/` directory fails with `WORKSPACE_NOT_INITIALIZED`
  rather than a raw filesystem error.

Every registry and manifest write is atomic: content goes to a sibling temp file and is renamed over
the target. A rename that fails with `EPERM`, `EBUSY`, `EACCES`, or `ENOTEMPTY`, typical of Windows
file scanners and concurrent readers, is retried with backoff, and exhausting the budget raises
`ATOMIC_WRITE_FAILED`. Temp artifacts left behind by interrupted processes are swept once per
process across `docko/`, `docko/sessions/`, and `docko/sessions/ended/`.

## Runtime-neutral command surface

Every runtime reaches the protocol through the same commands. This is the stable surface; see the
[CLI reference](cli-reference.md) for defaults, payloads, and per-command notes.

```text
docko init --root <path> [--mode auto|workspace|repo] [--slot <id>]... [--slot-stale-after-ms <n>] [--session-stale-after-ms <n>]
docko app ensure --root <path> --id <application-id> [--name <text>] [--description <text>] [--keyword <term>]... [--source <path>] [--slots <n>] [--slot-base <id>] [--slot <id>]...
docko slot acquire --root <path> [--session <id>] [--application <id>] [--prefer <slot-id>] [--branch <name>] [--task <text>] [--runtime <name>] [--stale-after-ms <n>] [--clone-when-busy] [--clone-from <path-or-slot>] [--clone-slot <id>] [--brief]
docko slot duplicate --root <path> --from <path-or-slot> --to <slot-id> [--application <id>]
docko status --root <path> [--resource <type>] [--id <id>] [--application <id>] [--claimed] [--brief]
docko logs --root <path> [--days <n>] [--limit <n>]
docko claim --root <path> [--session <id>] --resource <type> --id <id> [--branch <name>] [--task <text>] [--runtime <name>] [--stale-after-ms <n>]
docko heartbeat --root <path> [--session <id>] --resource <type> --id <id>
docko release --root <path> [--session <id>] --resource <type> --id <id> [--reason <text>] [--force] [--brief]
docko delegate --root <path> [--session <id>] --child-session <id> --resource <type> --id <id> [--scope read|write]
docko render --root <path>
docko resource ensure --root <path> --resource <type> --id <id> [--path <path>] [--auto-acquire | --no-auto-acquire]
docko session start --root <path> [--session <id>] [--runtime <name>] [--actor-mode interactive|delegated|automation] [--parent-session <id>] [--delegated-from-session <id>]
docko session end --root <path> [--session <id>]
docko session current --root <path> [--session <id>] [--id-only]
docko session list --root <path> [--limit <n>] [--brief]
docko session prune --root <path> [--max-age-ms <n>] [--retention-ms <n>] [--dry-run] [--brief]
```

`--brief` is an output projection supported by `status`, `slot acquire`, `release`, `session list`,
and `session prune`. It changes no registry, session, claim, delegation, or stale-recovery
semantics.

Runtime adapters add commands under their own namespace and may automate these flows. They must
preserve the same claim, ownership, and stale-recovery semantics.

## Related

- [State files](state-files.md): the on-disk shapes and every field.
- [CLI reference](cli-reference.md): every command, option, and payload note.
- [Errors](errors.md): error codes, exit codes, and authorization reasons.
- [Architecture](architecture.md): how the implementation is split across modules.
- [Adapter specification](adapter-spec.md): the contract a runtime adapter must satisfy.
- [Concepts](concepts.md): the vocabulary this page uses normatively.
