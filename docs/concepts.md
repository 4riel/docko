# Concepts

`docko` coordinates writable resources inside one workspace root. This page defines every term
the rest of the docs use. Each section links to the reference page that makes the term precise.

## Workspace root

The workspace root is the managed directory that owns `docko/` and `slots/`. It is your operational
home: one stable path that stays the same across sessions, holding coordination state and every
managed slot.

`docko init` creates the workspace root's `docko/` and `slots/` directories. Everything docko writes
stays inside those two directories; anything else at the root belongs to your own workflow. See
[State files](state-files.md#workspace-layout) for the full tree.

## Slot

A slot is a writable directory under `slots/<slot-id>`, or `slots/<application-id>/<slot-name>` when
it belongs to an application. docko discovers slots from the filesystem: create a directory under
`slots/`, and docko represents it as a claimable `slot` resource on the next registry-backed
operation.

A slot claim is the unit of write access. You claim a slot, work inside it, and release it when
you are done. See [resource model](protocol.md#resource-model) for slot discovery rules.

## Application

An application registers a named group of slots, such as `backend` or `frontend`, with
`docko app ensure`. It groups those slots under one id and carries keywords that docko matches
against the task and branch text of a claim, so it can infer the right application on its own. See
[Application slot pools](applications.md) for the full workflow.

## Resource

A resource is anything the protocol can claim. `slot` is the built-in, filesystem-discovered kind.
`shared-env` and other custom resource types are registered explicitly with `docko resource ensure`
and are not tied to a directory. See [resource model](protocol.md#resource-model).

## Session

A session is a runtime execution identity, stored as its own manifest under `docko/sessions/`.
Sessions are not embedded in the registry: the registry references them by id from claims and
delegations. A session stays active until it ends. See
[session lifecycle](protocol.md#session-lifecycle) and the session manifest fields in
[State files](state-files.md).

## Claim

A claim is the record that one session owns one resource. Claims are exclusive: a claimed resource
has exactly one owner session. Only the owner can heartbeat, delegate, or release it normally. See
[claim lifecycle](protocol.md#claim-lifecycle).

## Delegation

Delegation is a resource-scoped grant of write or read authority from the owner session to a child
session. It does not transfer ownership: the owner session never changes, and child authority ends
the moment the owner's claim ends. See [Delegate a slot to a teammate](delegation.md) for the
workflow and [ownership and delegation](protocol.md#ownership-and-delegation) for the rules.

## Stale recovery

Stale recovery is the janitor pass that frees claims, and ends sessions, whose owner-side activity
has gone quiet for too long. It runs before every registry-backed read and write, evaluating
freshness from active session manifests first and falling back to claim timestamps. See
[stale recovery](protocol.md#stale-recovery) for the thresholds and freshness order.

## Write authorization

File-write authorization is the slot-path check that adapters use to allow or deny a write. It
governs only paths inside managed slot directories: an owner or a write-scoped delegate is allowed,
and every other write into a claimed slot is denied. See
[file-write authorization](protocol.md#file-write-authorization) and
[Errors](errors.md#authorization-reasons) for the full reason table.

## Registry and mirror

`docko/registry.json` is the canonical machine-readable state of the workspace, its applications,
its resources, and the claims and delegations on them. `docko/registry.md` is a generated
human-readable mirror of the same state. Treat the registry as authoritative and the mirror as
read-only output: never edit it by hand. See [State files](state-files.md) for both shapes.

## Runtime adapter

A runtime adapter connects an agent runtime to the core protocol: it starts sessions, requests
write authorization, and automates delegation. An adapter may not redefine ownership, stale
recovery, or delegation lifetime; those stay in the core. Claude Code is the only implemented
runtime adapter today. See [Adapter specification](adapter-spec.md).

## Related

- [Application slot pools](applications.md)
- [Delegate a slot to a teammate](delegation.md)
- [Persistent slots compared with git worktrees](why-not-just-worktrees.md)
- [Protocol](protocol.md)
- [State files](state-files.md)
