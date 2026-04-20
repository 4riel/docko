# Architecture

## Intent

The architecture keeps the protocol small and explicit:

- `packages/core` owns semantics and persistence rules
- `packages/cli` owns argument parsing and command output
- `packages/adapters/*` own runtime-specific installation and automation
- `schemas/` document the canonical on-disk shapes

Nothing outside `packages/core` is allowed to redefine claim ownership, delegation lifetime, stale cleanup, or session resolution semantics.

## Persistence Boundaries

The core persists three distinct surfaces:

- `docko/registry.json`: workspace metadata, applications, resources, claims, delegations
- `docko/sessions/*.json`: session manifests
- `docko/logs/*.jsonl`: best-effort debug events

The generated mirror, `docko/registry.md`, is derived output from the registry and is never authoritative.

This split matters:

- the registry remains compact and focused on current resource state
- session freshness can be updated independently without rewriting the whole registry
- stale recovery can evaluate live session manifests without inventing a second registry truth

## Module Boundaries

### `DockoService`

`DockoService` is the orchestration layer.
It wires the narrower services together for:

- workspace initialization
- session start, end, current, and list
- resource ensure, claim, heartbeat, release, and delegate
- status reads
- mirror rendering
- stale cleanup integration
- file-write authorization

It coordinates operations, but it does not absorb the lower-level responsibilities of persistence, locking, rendering, or authorization.

### `RegistryScribe`

`RegistryScribe` owns the canonical registry document.

Responsibilities:

- create a default registry when one does not exist
- load and clone registry state
- write `registry.json` atomically
- regenerate `registry.md` on every write
- store and update workspace application descriptors
- discover legacy flat slots from `workspace/slots/`
- discover application-aware slots from `workspace/slots/<application-id>/`
- remove deleted free slots while preserving claimed missing slots
- filter status views and upsert resource records

### `SessionSherpa`

`SessionSherpa` owns session manifest files.

Responsibilities:

- create session manifests
- enforce active session ID uniqueness
- load specific sessions
- refresh `updated_at`
- mark sessions ended
- list active and inactive manifests on disk
- resolve session identity from explicit, environment, or single-active sources

Session state is intentionally not merged into the registry.

### `LockBouncer`

`LockBouncer` owns authorization and ownership checks.

Responsibilities:

- reject claims on already-claimed resources
- reject owner-only actions by unrelated sessions
- allow explicit `--force` recovery for release
- authorize file writes only for managed slot paths
- distinguish owner, delegated child, unrelated session, free slot, and non-managed path cases

It does not discover resources, clean stale claims, or persist anything.

### `StaleJanitor`

`StaleJanitor` owns stale-claim evaluation.

Responsibilities:

- compute whether a claim is stale
- prefer active session manifest activity over claim timestamps
- include delegated child session activity in freshness checks
- snapshot stale resources for reporting and logging
- clear stale claims and delegations in memory before the registry is written back

The janitor is pure in-memory logic. It does not read files directly.

### `MutationGate`

`MutationGate` serializes registry-backed operations with a lock directory at `docko/.registry.lock`.

Responsibilities:

- ensure reads and writes that depend on fresh registry state pass through one serialized path
- prevent concurrent claims from producing double ownership
- time out instead of waiting forever when the lock cannot be acquired

The design choice here is deliberate: even `status` uses the same mutation path so stale cleanup and slot discovery converge on one consistent view.

### `ResourceCatalog`

`ResourceCatalog` owns resource introduction and default stale policy.

Responsibilities:

- discover slot resources indirectly through `RegistryScribe`
- create non-slot resources on `resource ensure`
- prevent path mutation for claimed non-slot resources
- compute default stale timeouts by resource type

It defines resource onboarding rules, not claim ownership rules.

### `MirrorSmith`

`MirrorSmith` renders `registry.md`.

Responsibilities:

- summarize applications, slots, and other resources for humans
- surface claim owner, branch, task, updated time, and delegation counts
- keep generated notes aligned with the current default stale policy

It does not introduce any state not already present in the registry.

### `LogScribe`

`LogScribe` owns debug-event storage.

Responsibilities:

- append newline-delimited JSON events
- rotate by UTC day
- prune retained files to the configured retention window
- list recent entries newest-first

Logging is best-effort by design. Failed log writes must not block protocol operations.

## Operation Flow

### Registry-Backed Read Or Write

Operations such as `status`, `claim`, `release`, `delegate`, `heartbeat`, `render`, and write-authorization follow the same high-level path:

1. Acquire the mutation lock.
2. Load or initialize the registry.
3. Re-discover slot resources from `workspace/slots/`, including application-aware nested slots when applications are configured.
4. Load current session manifests.
5. Run stale cleanup in memory.
6. Execute the operation-specific logic.
7. Write the updated registry and generated mirror.
8. Release the lock.

This is the main architectural constraint that keeps stale cleanup, slot discovery, and human-readable rendering synchronized.

### Session-Heavy Operation

Session creation and resolution still route through `DockoService`, but the durable source of session truth remains `SessionSherpa`.
The service may require an active parent before starting a delegated session, then later use delegation records in the registry to grant resource-specific authority.

## Contract Boundaries

### Core

Core is allowed to define:

- claim state transitions
- session manifest fields
- stale evaluation
- delegation lifetime
- registry and mirror persistence rules
- slot-path authorization logic

### CLI

CLI is allowed to define:

- command names and flags
- JSON payload shaping
- environment fallback for session resolution
- interactive onboarding and installer workflows
- application-aware helpers such as keyword matching from task text, as long as they still resolve to normal core claims

CLI is not allowed to change who owns a claim or when a delegation is valid.

### Adapters

Adapters are allowed to define:

- runtime hook integration
- settings installation
- runtime-specific metadata fields
- convenience wrappers that call the core protocol

Adapters are not allowed to:

- silently convert delegated child authority into ownership
- persist parallel lock state outside the protocol
- redefine stale cleanup semantics
- bypass core session or claim validation

## Runtime-Agnostic Design Choices

Several choices are intentionally runtime-neutral:

- session manifests use `runtime` and open-ended `metadata` instead of adapter-specific fields in the contract
- claims record `runtime`, `branch`, and `task` as optional metadata rather than required semantics
- file-write authorization is based on registry ownership and delegations, not runtime-specific process ancestry
- stale cleanup works from timestamps and explicit session manifests, not adapter heartbeats alone

## Failure Model

The architecture assumes local failures happen and optimizes for cheap recovery:

- if a session exits normally, `session end` releases owned claims
- if a session crashes, claims remain until stale recovery clears them
- if a registry file is unreadable, the core fails fast with `CORRUPTED_REGISTRY`
- if logging fails, the operation still succeeds
- if concurrent mutation happens, the lock gate forces serialization or times out cleanly

## Why The Split Matters

The core, CLI, adapter, and schema split is not style-only.
It keeps the public contract inspectable:

- core tells you what the protocol means
- schemas tell you what the persisted documents look like
- CLI tells you how users and scripts invoke it
- adapters tell a specific runtime how to participate without owning the protocol

That is the boundary that keeps `docko` small, local-first, and predictable.
