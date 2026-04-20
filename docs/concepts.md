# Concepts

## Workspace Hub

The workspace hub is the managed root that contains:

- `slots/` for writable slot directories
- `docko/` for protocol state
- any optional planning or coordination material the workflow keeps at the root

## Slot

A slot is a managed writable directory under `slots/<slot-id>`.
Slots are discovered from the filesystem and represented in the registry as `resource_type: "slot"`.

## Resource

A resource is anything the protocol can claim.

The built-in categories are:

- `slot`
- `shared-env`
- custom safe-ID resource types

Slots are discovered automatically.
Non-slot resources are registered explicitly with `docko resource ensure`.

## Session

A session is a runtime execution identity stored as its own manifest under `docko/sessions/`.
A session is active while `ended_at` is `null`.

Important distinction:

- sessions are not embedded inside `docko/registry.json`
- the registry references sessions by ID from claims and delegations

## Claim

A claim is the record that says one session currently owns one resource.
Claims are exclusive: a claimed resource has exactly one owner session.

## Delegation

Delegation is a resource-scoped grant from the owner session to a child session.
Delegation does not transfer ownership.

The protocol records:

- which child received authority
- which parent granted it
- when it was granted
- whether the scope is `read` or `write`

## Registry

`docko/registry.json` is the canonical machine-readable state for:

- workspace metadata
- resources
- active claims
- resource-scoped delegations

It is not the source of truth for session manifests.

## Mirror

`docko/registry.md` is a generated human-readable summary of the registry.
It exists for quick inspection and should never be edited or treated as canonical state.

## Stale Recovery

Stale recovery is the janitor pass that frees claims whose owner-side activity is no longer fresh enough.
The core evaluates freshness from active session manifests first, then falls back to claim timestamps.

## File-Write Authorization

File-write authorization is a slot-path check used by adapters and integrations.
It only governs writes inside managed slot directories.
It does not generalize into a broader filesystem sandbox.

## Adapter

An adapter connects a runtime to the core protocol.

Adapters may:

- start sessions
- pass runtime metadata
- automate delegation flows
- ask the core whether a file write is allowed

Adapters may not redefine ownership, stale cleanup, or delegation lifetime.

## Runtime Guidance

Runtime-specific operating instructions belong in runtime-specific docs and snippets.
The core concepts stay portable even when one adapter currently has the deepest integration.
