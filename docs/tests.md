# Test Plan

## Full Gate

Run the same verification gate used for final integration:

```bash
pnpm build
pnpm check
pnpm test
pnpm test:coverage
```

All tests execute against built `dist/` output. The package scripts handle that automatically, but direct `node --test` runs are lower-confidence unless the relevant packages were built first.

## Current Implemented Suite

- `tests/core.unit.test.mjs`: focused unit coverage for errors, filesystem helpers, session resolution, lock ownership, and mutation-gate timeout behavior
- `tests/core.services.test.mjs`: service-layer coverage for registry validation, stale recovery, logs, mirror rendering, and resource-catalog defaults
- `tests/docko.e2e.test.mjs`: end-to-end CLI flows for init, claims, release, delegation, stale recovery, logs, and authorization
- `tests/cli.unit.test.mjs`: CLI parser and interactive-init coverage, including repeated flags, prompt flows, payload fallbacks, and install edge cases
- `tests/claude-code-adapter.test.mjs`: Claude adapter settings, installer behavior, settings merge, and real hook command execution
- `tests/helpers/cli-test-helpers.mjs`: shared child-process and workspace helpers used by the CLI, adapter, and e2e suites

Coverage is gathered from built package outputs under `packages/*/dist/*.js` so the numbers reflect the shipped CLI, core, and adapter surfaces rather than test-only source paths.
Package-install coverage runs from fresh temp directories outside the monorepo so npm does not inherit parent workspace context during tarball validation.

## Core Functional Cases

- bootstrap from an empty workspace
- one active session can claim a free slot
- `slot acquire` claims the first free slot and can duplicate a new managed slot when all current slots are busy
- many active sessions can claim different slots
- explicit `--session` resolves ambiguity correctly
- ambiguous session resolution fails with a clear error
- owner release succeeds
- unrelated non-owner release is denied
- heartbeat refreshes freshness fields

## Recovery Cases

- stale workspace claims are released after threshold
- stale shared env claims are released after threshold
- fresh session activity keeps an old slot claim alive
- session-end cleanup releases owned claims
- crash recovery leaves claims until stale recovery clears them
- `status` reports janitor-driven releases in `janitor.released_claims`
- corrupted registry fails fast with a schema error
- missing session manifest produces a missing-session error

## Delegation Cases

- delegated teammate is allowed through inherited authority
- delegated teammate outside scope is denied
- releasing the parent claim invalidates child access
- malformed delegation payload is rejected
- child session without a manifest is rejected

## Adapter Cases

- malformed Claude hook input is ignored or rejected deterministically
- generated mirror stays in sync after each state-changing command
- adapter wrappers pass the correct runtime name and session metadata

## Concurrency And Filesystem Cases

- concurrent claim attempts serialize safely
- atomic writes do not leave partial registry files
- repeated status reads remain fast with many resources
- performance-sensitive operations behave predictably on Windows, macOS, and Linux filesystems

## Suggested Test Layers

- unit tests for state transitions
- schema tests for registry and session manifests
- integration tests for CLI flows
- fixture-based adapter tests for Claude payloads
- cross-platform benchmark tests for registry reads and writes

## Docs Sync Notes

- When command flags or payload shapes change, update `docs/cli-reference.md`, `README.md`, and any affected adapter docs in the same change.
- When adapter templates move or rename files, update `examples/`, `docs/claude-code.md`, and `docs/docs-sync.md` together.
- Keep `tests/README.md` aligned with the actual file inventory so contributors can map failures back to the owning layer quickly.
