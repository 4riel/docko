---
name: docko-protocol
description: Protocol, schema, and CLI contract guidance for the docko repository. Use when changing registry or session shapes, claim and delegation behavior, stale cleanup, authorization, or the public CLI behavior that reflects those semantics.
---

# docko Protocol

## Read first

- `docs/protocol.md`
- `docs/architecture.md`
- `docs/cli-reference.md`
- `docs/tests.md`
- `schemas/registry.schema.json`
- `schemas/session.schema.json`
- `tests/core.unit.test.mjs`
- `tests/docko.e2e.test.mjs`

## Boundaries

- Keep protocol semantics in `packages/core`.
- Keep runtime-specific behavior out of `packages/core`.
- Treat schemas and protocol docs as part of the public contract.

## Change rules

- Update schemas, docs, and tests together when state shapes or semantics change.
- Keep session resolution, ownership checks, and delegation rules explicit.
- Keep `registry.json` authoritative and `registry.md` generated.
- When CLI commands or payloads change, update `docs/cli-reference.md`.
- Prefer backward-compatible changes unless the task explicitly requires a break in compatibility.
- Keep runtime-specific guidance out of protocol docs; Codex and Claude wording belongs in adapter/docs surfaces, not in the protocol contract.

## Verify

- `pnpm build`
- `pnpm check`
- `pnpm test`
- Focus on `tests/core.unit.test.mjs` and `tests/docko.e2e.test.mjs` when verification needs to be selective.
