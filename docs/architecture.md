# Architecture

`docko` splits protocol semantics, the public CLI, and runtime integration into separate packages so
each stays inspectable on its own. This page explains how those packages divide the work and how one
registry-backed operation flows through them.

## Package boundaries

`packages/core` owns protocol semantics: claim state transitions, session manifest fields, stale
evaluation, delegation lifetime, registry and mirror persistence, and slot-path authorization. Nothing
outside `packages/core` may redefine these. `packages/cli` owns command names, flags, JSON payload
shaping, environment fallback for session resolution, and interactive onboarding, but it does not
decide who owns a claim or when a delegation is valid. `packages/adapters/*` own runtime hook
integration, settings installation, and runtime-specific metadata; an adapter must not convert
delegated authority into ownership, persist parallel lock state, or bypass core validation.

See [Protocol](protocol.md) for the semantics each boundary protects.

## Persistence surfaces

- `docko/registry.json`: workspace metadata, applications, resources, claims, and delegations.
- `docko/sessions/*.json` and `docko/sessions/ended/*.json`: per-session manifests.
- `docko/logs/*.jsonl`: best-effort debug events.
- `docko/registry.md`: a generated mirror of the registry. It is never authoritative.

This split keeps the registry compact and focused on current resource state, lets session freshness
update independently of the whole registry, and lets stale recovery evaluate live session manifests
without a second source of truth. Read [State files](state-files.md) for every field.

## Module map

| Module | File | Role |
| --- | --- | --- |
| `DockoService` | `service.ts` | Orchestration layer wiring the narrower services together. |
| `RegistryScribe` | `registry-scribe.ts` | Registry persistence, slot discovery, and `registry.md` generation. |
| `SessionSherpa` | `session-sherpa.ts` | Session manifest lifecycle. |
| `StaleJanitor` | `stale-janitor.ts` | Pure in-memory stale-claim evaluation. |
| `LockBouncer` | `lock-bouncer.ts` | Ownership and file-write authorization checks. |
| `MutationGate` | `mutation-gate.ts` | Filesystem lock serialization. |
| `ResourceCatalog` | `resource-catalog.ts` | Resource onboarding and default stale policy. |
| `MirrorSmith` | `mirror-smith.ts` | Human-readable `registry.md` rendering. |
| `LogScribe` | `log-scribe.ts` | Best-effort debug-event logging. |
| n/a | `fs-utils.ts` | Atomic writes, directory creation, and JSON parsing helpers. |
| n/a | `errors.ts` | The `DockoError` class and error codes. |
| n/a | `paths.ts` | Path calculation for the registry, sessions, logs, and locks. |
| n/a | `types.ts` | Every TypeScript interface for the protocol. |
| n/a | `constants.ts` | The schema version constant. |

`MutationGate` serializes every registry-backed operation through a lock directory at
`docko/.registry.lock/`. Even `status` uses this path, so stale cleanup and slot discovery converge on
one consistent view before any response is built. The one exception is a write-authorization check for
a path outside every managed slot, which is answered from an unlocked registry read because no fresh
claim state can change that answer.

`StaleJanitor` is pure in-memory logic: it never reads files directly. It computes whether a claim is
stale, prefers active session and delegated-child activity over claim timestamps, and clears stale
claims and delegations before the registry is written back.

`SessionSherpa` owns session manifest files as a surface separate from the registry. It enforces
active session ID uniqueness, lists active manifests from the hot directory only, migrates ended
manifests into `sessions/ended/` lazily, and deletes ended manifests past the retention window.

## Operation flow

Operations such as `status`, `claim`, `release`, `delegate`, `heartbeat`, and `render` follow the same
path:

1. Acquire the mutation lock.
2. Load or initialize the registry, and snapshot its comparable serialization.
3. Re-discover slot resources from `slots/`, including application-scoped nested slots.
4. Load active session manifests, relocating legacy ended ones out of the hot directory.
5. Run stale cleanup in memory, ending at most 100 stale sessions in one pass.
6. Execute the operation-specific logic.
7. Write the registry and mirror only when the document differs from the snapshot.
8. Release the lock, if this process still holds it.

Step 7 is what keeps a read-only command read-only: `status`, `session list`, and `logs` write
nothing unless the janitor changed something.

## Failure model

- If a session exits normally, `session end` releases its owned claims.
- If a session crashes, its claims remain until stale recovery clears them, and the session itself
  ends once it stays quiet past the session stale window.
- If a registry file is unreadable, the core fails fast with `CORRUPTED_REGISTRY`.
- If a log write fails, the operation still succeeds. Logging is best-effort.
- If concurrent mutation happens, the lock gate serializes the operations or times out cleanly.

## Related

- [Protocol](protocol.md)
- [State files](state-files.md)
- [Repository structure](repo-structure.md)
