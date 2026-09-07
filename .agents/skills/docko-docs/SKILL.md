---
name: docko-docs
description: Documentation guidance for the docko repository. Use when editing README, docs, examples, snippets, or onboarding guides so the written guidance stays aligned with the implemented protocol and adapters.
---

# docko Docs

Rules for editing docko's documentation set. Use it before changing any prose surface in this repo.

## Read first

- `docs/development.md`
- `docs/INDEX.md`
- `README.md`
- The specific guide or example you are changing

## Writing rules

- Treat protocol docs and schemas as the source of truth.
- Do not create a second truth system for command behavior or runtime semantics.
- Distinguish clearly between implemented behavior, recommended usage, and roadmap material.
- Confirm commands, file paths, and runtime claims in source, templates, or tests before documenting them.
- Keep examples short, copy-pastable, and shell-neutral.
- Update indexes and contributor-facing docs when adding new guides.
- Label runtime examples clearly as one of: shipped Claude Code asset or manual Codex guidance.
- Do not present non-Claude runtimes as implemented runtime adapters unless matching packages, templates, and tests exist.

## Verify

- Re-read every changed doc against the implementation.
- Run `pnpm build` or `pnpm test` when the documentation depends on command behavior that changed.
- Call out any unverified command examples or environment-specific assumptions.
