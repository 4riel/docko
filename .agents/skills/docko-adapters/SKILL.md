---
name: docko-adapters
description: Runtime adapter guidance for the docko repository. Use when working on runtime-specific packages, template installers, hook flows, snippet assets, runtime documentation, or when extending support beyond the current Claude Code adapter.
---

# docko Adapters

## Read first

- `docs/adapter-spec.md`
- `docs/claude-code.md`
- `packages/adapters/claude-code/src/index.ts`
- `packages/adapters/claude-code/templates/`
- `tests/claude-code-adapter.test.mjs`
- For Codex-specific wording, verify `AGENTS.md`, skills, subagents, and hooks claims against official OpenAI docs.

## Reference model

- Treat the Claude adapter as the reference implementation for installer structure, template layout, and runtime-to-protocol mapping.
- Be explicit about what is implemented versus what is only documented or planned.
- Claude Code is the only first-class Docko adapter today.
- Codex guidance is currently manual and docs-driven. Do not imply a shipped Codex adapter unless this repo gains a package, templates, and tests for it.
- OpenAI currently documents Codex hooks as experimental and temporarily disabled on Windows. Do not present Codex hooks as the default Docko path.

## Change rules

- Keep adapters thin and avoid changing ownership semantics in adapter code.
- Put runtime-specific templates, snippets, and helper assets beside the adapter that owns them.
- Update templates, examples, docs, and tests together.
- If runtime-specific commands are added to the CLI, document them in `docs/cli-reference.md`.
- For Codex or OpenAI-specific guidance, verify against official OpenAI docs before writing instructions.
- For future runtimes, keep design notes clearly labeled as future or guidance-only until implementation exists.

## Verify

- `pnpm build`
- `pnpm check`
- `pnpm test`
- Focus on `tests/claude-code-adapter.test.mjs` plus any new adapter coverage when verification needs to be selective.
