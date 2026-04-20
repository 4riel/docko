# Contributing

## Prerequisites

- Node 22 or newer
- pnpm 10 or newer

The repo keeps the recommended Node version in `.node-version`.

## Local Setup

Run these from the repository root:

```text
corepack enable
pnpm install
pnpm build
pnpm test
```

These commands are shell-neutral and work in PowerShell, `cmd.exe`, and POSIX shells.

## Read Order

Before editing, read:

1. `README.md`
2. `AGENTS.md`
3. `docs/INDEX.md`
4. The skill and docs for the surface you are changing

For agent-oriented work, continue with [`agent-onboarding.md`](agent-onboarding.md). For parallel role splits, use [`agent-team-kit.md`](agent-team-kit.md).

## Working Rules

- Work from the repo root.
- Keep changes inside the narrowest owning surface.
- Keep protocol semantics in `packages/core`.
- Keep the CLI contract in `packages/cli`.
- Keep runtime-specific behavior in `packages/adapters/*`.
- Treat `docko/registry.json` as canonical and `docko/registry.md` as generated output.
- When registry or session shapes change, update schemas, docs, and tests together.
- When CLI behavior changes, update `docs/cli-reference.md` and any affected onboarding or troubleshooting guides in the same change.

## Verification

Standard verification:

```text
pnpm build
pnpm check
pnpm test
pnpm test:coverage
```

Practical notes:

- `pnpm test` and `pnpm test:coverage` both rebuild first.
- Tests run sequentially to avoid CLI child-process contention.
- If you are editing CLI or operator docs, verify the text against `packages/cli/src/index.ts`, `tests/cli.unit.test.mjs`, and `tests/docko.e2e.test.mjs` before you treat the docs as done.

## Change Expectations

- Keep the protocol small.
- Prefer explicit state transitions over convenience magic.
- Keep adapters thin.
- Keep command examples copy-pastable and shell-neutral by default.
- Do not document flags, outputs, or recovery flows that are not implemented.
- Call out missing tooling or unrun verification instead of implying coverage.

## Contribution Areas

- core protocol and schemas
- CLI contract and user-facing command behavior
- Claude Code adapter assets and docs
- additional runtime adapters
- docs, onboarding, and migration examples
- conformance and performance tests
