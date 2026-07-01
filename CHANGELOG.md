# Changelog

All notable changes to `docko-workspace` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (currently in the `0.1.0-alpha.x` prerelease line).

## [Unreleased]

### Added

- Repository hardening: CI (build/check/test on Linux + Windows), CodeQL scanning, Dependabot,
  ESLint + Prettier, commit and pre-commit hooks, a provenance-enabled release workflow, and
  community health files.

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

[Unreleased]: https://github.com/4riel/docko/compare/v0.1.0-alpha.13...HEAD
[0.1.0-alpha.13]: https://github.com/4riel/docko/releases/tag/v0.1.0-alpha.13
