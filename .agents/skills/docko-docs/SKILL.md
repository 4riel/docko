---
name: docko-docs
description: Documentation and docs-sync guidance for the docko repository. Use when editing README, docs, examples, snippets, onboarding guides, or public positioning so the written guidance stays aligned with the implemented protocol and adapters.
---

# docko Docs

## Read first

- `docs/docs-sync.md`
- `docs/INDEX.md`
- `README.md`
- The specific guide or example you are changing

## Writing rules

- Treat protocol docs and schemas as the source of truth.
- Do not create a second truth system for command behavior or runtime semantics.
- Distinguish clearly between implemented behavior, recommended usage, and roadmap material.
- Confirm commands, file paths, and runtime claims in source, templates, or tests before documenting them.
- Keep examples short, copy-pastable, and clearly marked when they assume POSIX shell behavior.
- Update indexes and contributor-facing docs when adding new guides.
- Label runtime examples clearly as one of: shipped Claude asset, manual Codex guidance, or future/planned adapter guidance.
- Do not present non-Claude runtimes as first-class implementations unless matching packages, templates, and tests exist.

## Verify

- Re-read every changed doc against the implementation.
- Run `pnpm build` or `pnpm test` when the documentation depends on command behavior that changed.
- Call out any unverified command examples or environment-specific assumptions.
