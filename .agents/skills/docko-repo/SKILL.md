---
name: docko-repo
description: Repository onboarding and working conventions for the docko monorepo. Use when an agent needs to understand the repo layout, choose the right docs or commands, plan a change, or verify work without crossing the core, cli, adapters, docs, and tests boundaries.
---

# docko Repo

## Read first

- `AGENTS.md`
- `README.md`
- `docs/INDEX.md`
- `docs/repo-structure.md`
- `docs/contributing.md`
- For Codex-specific wording, verify against official OpenAI docs before editing repo guidance.

## Navigate by surface

- `packages/core`: protocol semantics, registry and session state, claims, delegation, authorization
- `packages/cli`: public command surface and JSON output shaping
- `packages/adapters/claude-code`: only implemented runtime adapter today
- `schemas/`: canonical JSON Schema
- `tests/`: unit, e2e, and adapter coverage
- `examples/`: copy-pastable runtime and workspace examples that should match the shipped behavior

## Work pattern

- Start from docs, then confirm behavior in source.
- Keep changes inside the narrowest owning package or doc surface.
- Treat `registry.json` as canonical and `registry.md` as generated.
- If the task becomes protocol-heavy, read `docs/protocol.md`, `docs/architecture.md`, `docs/cli-reference.md`, and use `docko-protocol`.
- If the task becomes adapter-heavy, read `docs/adapter-spec.md`, `docs/claude-code.md`, and use `docko-adapters`.
- If the task becomes documentation-heavy, read `docs/docs-sync.md` and use `docko-docs`.
- Keep Claude adapter docs grounded in `packages/adapters/claude-code/src/index.ts`, `packages/adapters/claude-code/templates/`, and `tests/claude-code-adapter.test.mjs`.
- Keep Codex guidance grounded in official OpenAI docs and describe it as manual guidance unless this repo gains a real Codex adapter package.

## Verify

- `pnpm build`
- `pnpm check`
- `pnpm test`
- Call out missing tooling or unrun verification explicitly.
