# Changelog

All notable changes to `docko-workspace` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (currently in the `0.1.0-alpha.x` prerelease line).

## [Unreleased]

## [0.1.0-alpha.15]

### Added

- Tracked the generated Claude Code commands, skill, snippets, settings fragment, and repo-local
  plugin bundle so this repository exercises the same integration assets it ships to adopters.

### Changed

- Reorganized repository guidance and documentation around the public `docko status`, round-robin
  `slot acquire`, busy-slot cloning, and explicit session-resolution workflow.
- Updated `actions/setup-node` to v7 and refreshed the compatible development toolchain, including
  c8 12, ESLint 10.7, Prettier 3.9.6, and typescript-eslint 8.65 while retaining TypeScript 6.0.
- Updated Codex hook documentation to match current OpenAI guidance without presenting Codex as a
  first-class Docko adapter.

### Fixed

- Scoped generated workspace directories out of linting and configured the TypeScript ESLint
  project root explicitly.
- Preserved executable permissions on the packaged CLI launcher.

## [0.1.0-alpha.14]

### Added

- Repository hardening: CI (build/check/test on Linux + Windows), CodeQL scanning, Dependabot,
  ESLint + Prettier, commit and pre-commit hooks, a provenance-enabled release workflow, and
  community health files.

### Changed

- Rewrote the README for a shorter, more didactic flow (tagline + badges, three quickstart paths,
  deep content linked into `docs/`), and documented all four Claude hooks including SubagentStart.
- Bumped CI actions (checkout, setup-node, pnpm/action-setup, codeql-action) and the TypeScript
  toolchain to 6.0 with `@types/node` 26; added `ignoreDeprecations` and an explicit `types: ["node"]`
  so the build and full test suite pass on the new compiler.
- Normalized the `LICENSE` copyright holder to the `4riel` handle used across the project.

## [0.1.0-alpha.13]

### Added

- `slot acquire` now rotates round-robin per application, tracking the last claimed slot in
  `config.scheduler.last_slot_id` so the just-released slot is picked last.

### Fixed

- Root resolution walks up to the nearest workspace that owns `docko/registry.json`, and an
  explicit `--root` inside a managed slot is refused with `ROOT_INSIDE_SLOT` instead of
  fragmenting state into the slot.
- The Claude adapter now stamps `plugin.json` with the live package version on every install
  instead of copying a hardcoded literal, and its hook launcher only opts into a shell on Windows.

[Unreleased]: https://github.com/4riel/docko/compare/v0.1.0-alpha.15...HEAD
[0.1.0-alpha.15]: https://github.com/4riel/docko/compare/v0.1.0-alpha.14...v0.1.0-alpha.15
[0.1.0-alpha.14]: https://github.com/4riel/docko/compare/v0.1.0-alpha.13...v0.1.0-alpha.14
[0.1.0-alpha.13]: https://github.com/4riel/docko/releases/tag/v0.1.0-alpha.13
