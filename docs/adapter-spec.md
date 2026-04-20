# Adapter Specification

## Purpose

Adapters connect specific runtimes to the protocol without changing the protocol itself.

## Implemented Today

Only Claude Code is a first-class adapter in this repository today.

That implementation lives in `packages/adapters/claude-code` and currently ships:

- repo-local installer assets under `.claude-plugin/docko/`
- Claude command files under `.claude/commands/`
- a Claude skill under `.claude/skills/workspace-orchestration/`
- mergeable snippets for `CLAUDE.md` and `AGENTS.md`
- generated Claude settings fragments and merged local settings
- adapter coverage in `tests/claude-code-adapter.test.mjs`

The Claude adapter maps four Claude hook events into the public CLI:

- `SessionStart`
- `SessionEnd`
- `PreToolUse`
- `SubagentStart`

## Guidance-Only Runtimes

The sections below describe design constraints for possible future adapters. They are not shipped implementations unless a matching package, templates, docs, and tests exist.

### Codex

Codex guidance in this repo is currently manual and docs-driven, not adapter-driven.

What is true today:

- OpenAI documents `AGENTS.md`, project skills, and explicit subagent workflows for Codex.
- OpenAI also documents hooks for Codex, but marks them experimental and currently disabled on Windows.
- `docko` does not currently ship `packages/adapters/codex`, Codex installer templates, or Codex adapter tests.

So the supported Docko story for Codex today is:

- use `AGENTS.md` and repo skills to teach the workflow
- use the public `docko` CLI manually from Codex
- do not document Codex as equivalent to the shipped Claude adapter

### Other runtimes

Aider, Cursor, OpenCode, and generic shell/CI notes are planning constraints only until they have real adapter packages and coverage.

Examples of valid future adapter behavior:

- create or discover runtime session identity
- invoke `session start` and `session end` or a runtime-equivalent wrapper
- expose the current session ID to the runtime
- optionally run pre-write authorization checks
- optionally register child sessions for delegated work

## Promotion Rule

Do not present a runtime as first-class support until all of the following exist:

- an adapter package under `packages/adapters/*`
- installer assets or templates when the runtime needs them
- runtime-specific docs
- tests that verify the runtime-to-protocol mapping

## Adapter Boundary Rules

- adapters may enrich metadata
- adapters may not change ownership semantics
- adapters may not invent unrecorded delegation
- adapters should fail clearly on malformed runtime payloads
