# Adapter specification

This page documents the contract a runtime adapter must satisfy, and how the Claude Code adapter
fills it. It is generated from `packages/adapters/claude-code/src/index.ts` and the plugin bundle
under `packages/adapters/claude-code/plugin/`.

## What an adapter is

An adapter connects one runtime to the docko protocol without changing the protocol itself. It
maps a runtime's own events, such as a session starting or a file write, onto the public `docko`
CLI. [Concepts](concepts.md) defines the terms an adapter maps onto: session, claim, delegation,
and stale recovery.

Claude Code is the only implemented runtime adapter today. Codex and other `AGENTS.md`-driven
runtimes use docko as a [guidance-based runtime](agents-md-runtimes.md) instead: the model follows
written instructions, and nothing enforces them.

## The Claude Code adapter

The adapter maps four Claude Code hook events onto `docko adapter claude-code` subcommands.

| Hook event | CLI subcommand | Timeout (seconds) | What it does |
| --- | --- | --- | --- |
| `SessionStart` | `adapter claude-code session-start` | 60 | Starts a session and exports `DOCKO_SESSION_ID`, `DOCKO_RUNTIME`, and `DOCKO_ROOT`. |
| `SessionEnd` | `adapter claude-code session-end` | 15 | Ends the session and releases the claims it owns. |
| `PreToolUse` | `adapter claude-code pre-tool-use` | 30 | Authorizes a file write against the target path and returns a permission decision. |
| `SubagentStart` | `adapter claude-code subagent-start` | 30 | Starts a delegated child session and inherits the parent session's active delegations. |

`PreToolUse` is the only hook with a matcher, and the matcher is `Edit|Write`. The other three
hooks run on every event of that type.

See [Use docko with Claude Code](claude-code.md) for install steps and what each hook does from a
Claude Code user's point of view.

## Adapter responsibilities

An adapter:

- creates or discovers a runtime session identity, then calls `session start` and `session end`.
- exposes the current session ID to the runtime, so later commands do not need `--session`.
- calls the write-authorization check before a write and translates the result into the runtime's
  own permission model. The check returns an `AuthorizationResult`: `allowed`, `reason`, and the
  claim fields needed to explain a denial without a second call.
- registers a delegated child session when the runtime starts a subagent, and inherits the
  parent's active delegations.

## Adapter boundaries

An adapter must not:

- change ownership semantics. `owner_session_id` and claim lifetimes stay defined by
  [the protocol](protocol.md), never by adapter logic.
- invent a delegation the registry does not record.
- persist parallel lock state outside `docko/registry.json`.
- redefine stale recovery. Stale windows and the janitor's recovery logic live in `packages/core`
  only.

An adapter must fail open: a launcher error or a malformed runtime payload must not block the
runtime. It only skips docko's authorization for that call.

## Promotion rule

A runtime is documented as an implemented adapter only after all four of these exist:

1. An adapter package under `packages/adapters/*`.
2. Installer assets or templates, when the runtime needs them.
3. Runtime-specific docs.
4. Tests that verify the runtime-to-protocol mapping.

Claude Code has all four: `packages/adapters/claude-code`, the plugin bundle and repo-local
installer templates, [Use docko with Claude Code](claude-code.md), and
`tests/claude-code-adapter.test.mjs` plus `tests/claude-plugin.test.mjs`. No other runtime meets
this bar.

## Related

- [Use docko with Claude Code](claude-code.md)
- [Codex and other AGENTS.md runtimes](agents-md-runtimes.md)
- [Protocol](protocol.md)
- [Architecture](architecture.md)
