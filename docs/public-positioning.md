# Public Positioning

## Executive Summary

`docko` is a local-first workspace and session protocol for AI coding agents. It gives teams one stable workspace root, persistent writable slots under `slots/`, and inspectable on-disk state for sessions and claims.

The protocol is runtime-agnostic. The current implementation is not. Today it ships a CLI, the protocol core, and a first-class Claude Code adapter. Codex support is `AGENTS.md` guidance, not a runtime adapter.

Public naming should stay consistent:

- product name: `docko`
- npm package: [`docko-workspace`](https://www.npmjs.com/package/docko-workspace)
- source repository: [`4riel/docko`](https://github.com/4riel/docko)
- installed command: `docko`

## What Problem It Solves

Many agent-heavy workflows do not need another branch helper. They need a simple operating model for:

- where shared context lives
- which slot an agent is allowed to write to
- how session identity is recorded
- how delegated teammate authority is inherited
- how stale sessions are recovered cleanly

`docko` standardizes that without forcing teams to invent their own lock files, slot notes, or ad hoc hook scripts.

## Who It Is For

- teams with one workspace root for coordination and code slots
- users who prefer persistent warm clones to ephemeral worktrees
- teams running multiple agents against the same local machine
- Claude Code users who want hook-backed slot enforcement
- adopters who want a small local-first protocol instead of runtime-specific glue everywhere

## When To Use It

Use `docko` when:

- the workspace root is your operational home
- persistent per-slot local state is useful
- you want readable on-disk registry and session state
- delegated teammate authority should be explicit
- local setup is expensive enough that warm slots are worth keeping

## When Not To Use It

Do not use `docko` by default if:

- git worktrees already fit the workflow cleanly
- the repo is light enough that fresh checkouts are cheap
- you do not need a shared workspace hub
- extra disk usage for full clones is not justified

## Support Boundaries

Public messaging should stay precise:

- Claude Code is the only implemented runtime adapter today.
- Codex is supported through `AGENTS.md` guidance, not hooks.
- The protocol is reusable across runtimes, but the repository does not yet ship equal adapter coverage across runtimes.

## How It Differs From Worktree-First Tools

Worktree-first tools optimize for branch fan-out with shared git object storage.

`docko` optimizes for:

- a stable workspace root
- persistent full directories as operating slots
- coordination artifacts living beside code when needed
- canonical machine-readable registry state
- explicit delegated authority
- optional runtime adapters layered on top

This is a workflow tradeoff, not a claim that worktrees are wrong.

## Why It Fits Claude Code Especially Well

Claude Code already has hook and teammate concepts. `docko` makes those concepts operational:

- a leader session claims a slot once
- the registry records the ownership
- teammates inherit that authority through recorded delegation
- `PreToolUse` can block writes outside the claimed slot
- `SessionEnd` can release claims on cleanup

That is why Claude Code is the current first-class adapter target.

## Community Value

`docko` is useful in public because it contributes a reusable protocol and a narrow reference implementation:

- the protocol stays small and inspectable
- the Claude adapter proves the model end to end
- the docs stay honest about where support is strong and where it is still guidance-only
