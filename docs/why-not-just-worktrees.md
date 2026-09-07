# Persistent slots compared with git worktrees

`docko` and git worktrees both let you work on more than one branch at once. They optimize for
different things. This page helps you pick.

## What each one optimizes for

Git worktrees optimize for cheap, disposable branch checkouts that share one git object store. You
create one, use it, and remove it. There is no shared workspace root, no persistent per-worktree
state, and no built-in session or ownership model. Ownership of a worktree is whoever is looking at
the terminal.

`docko` optimizes for a stable workspace root with persistent writable slots. A slot is a full
directory under `slots/` that stays in place across sessions, so caches, local config, and
long-running processes stay attached to one path. The registry records who owns each slot and when
a delegated teammate may write into it, so ownership is a fact on disk, not a convention.

```bash
docko slot acquire --root ./workspace --branch feat/checkout --task "add checkout flow" --brief
```

That command claims the next free slot instead of creating a new directory, so the same slot's
caches and local state carry over between sessions.

## Choose worktrees when

- You mainly need fast, cheap parallel branch checkouts.
- You do not need a shared workspace root or explicit session ownership.
- Local setup is light and easy to recreate from a fresh checkout.
- Long-lived per-slot state, such as warm caches or a running dev server, is not important.

## Choose docko when

- Local servers, ports, or IDE state are tied to a stable directory that should not move.
- Per-slot environment files or local configuration differ between slots.
- Framework caches or native build artifacts are expensive to rebuild from scratch.
- More than one agent session works against the same workspace root and needs explicit, inspectable
  ownership of each writable directory.

## The tradeoff

Worktrees win on disk efficiency: one shared git object store, thin per-branch checkouts, and fast
fan-out. `docko` slots are full directories, so they cost more disk and more time to create.

Persistent slots win on operational stability: the path stays stable across sessions, caches stay
warm, local state survives a restart, and the workspace root becomes a shared coordination surface
with an inspectable [registry](state-files.md) instead of ad hoc naming conventions.

Neither model is wrong. `docko` is a fit for the persistent-slot workflow, not a replacement for
worktrees in general.

## Related

- [Concepts](concepts.md)
- [Migrate an existing workflow](migration-guide.md)
- [Application slot pools](applications.md)
