# Repository structure

This page maps the `docko` repository itself. For the directory layout `docko` creates inside a
managed workspace root, read [State files](state-files.md).

## Repository layout

Everything below the repository root, with the surface each directory owns.

```text
docko/
|-- .agents/
|   `-- skills/                     Repo-local skills for repo navigation, protocol, and adapter work
|-- .claude-plugin/
|   `-- marketplace.json            Makes this repo a Claude Code plugin marketplace
|-- .github/                        CI, security scanning, issue and PR templates, ownership
|-- .husky/                         Commit and pre-commit hooks
|-- bin/
|   `-- docko.js                    Published CLI entry point
|-- docs/                           Public documentation, see docs/INDEX.md
|-- examples/                       Copy-pastable examples for adopters
|-- packages/
|   |-- core/                       Protocol semantics, registry and session persistence
|   |-- cli/                        JSON CLI over DockoService
|   `-- adapters/
|       `-- claude-code/
|           |-- plugin/             Distributable Claude Code plugin bundle
|           `-- templates/          CLAUDE.md and AGENTS.md snippets for adopter projects
|-- schemas/                        Canonical JSON Schema for registry.json and session manifests
|-- scripts/                        Build, test, and publish orchestration
|-- tests/                          Unit, service, e2e, CLI, and adapter tests
|-- AGENTS.md                       Repo operating rules for Codex and other agents
|-- CLAUDE.md                       Repo operating rules for Claude Code
|-- CONTRIBUTING.md                 Contribution policy and pull request flow
|-- SECURITY.md                     Vulnerability reporting and the security-boundary scope note
`-- CHANGELOG.md                    Published release history
```

## What each surface owns

| Directory | Owns |
| --- | --- |
| `packages/core` | Protocol semantics: claims, delegation, stale recovery, session resolution, authorization, and registry persistence. |
| `packages/cli` | The public command surface: argument parsing, command routing, JSON output, and interactive onboarding. |
| `packages/adapters/claude-code` | The Claude Code adapter: the plugin bundle, the hook launcher, the installer, and settings generation. |
| `schemas/` | Canonical JSON Schema for `registry.json` and session manifests. |
| `docs/` | Product documentation: guides, concepts, and reference pages. |
| `examples/` | Copy-pastable workspace and settings examples that match shipped behavior. |
| `tests/` | Unit, service, end-to-end, CLI, and adapter coverage for every surface above. |
| `scripts/` | Build, test, and publish orchestration used by the `package.json` scripts. |
| `.agents/skills/` | Repo-local skills for navigating this repository. |
| `.github/` | CI workflows, security scanning, and issue and pull request templates. |

Keeping the layout split this way keeps the public contract inspectable: `packages/core` states what
the protocol means, `schemas/` states what the persisted documents look like, `packages/cli` states
how a script invokes it, and `packages/adapters/*` state how one runtime participates without owning
the protocol.

Each surface has its own tests: `packages/core`, `packages/cli`, and `packages/adapters/claude-code`
each ship a `dist/` build, and `tests/` covers all three plus the distributable plugin bundle. Read
[Tests](tests.md) for the suite-to-surface mapping.

## Repository versus managed workspace

This repository is the source code for `docko`. A managed workspace root that `docko init` creates
has a different layout: a `slots/` directory plus a `docko/` directory holding the registry, session
manifests, and locks. Read [State files](state-files.md) for that tree in full.

Keep the distinction in mind when you read the docs: this page and [Architecture](architecture.md)
explain how `docko` itself is implemented; the reference pages under `docs/` explain the state a
managed workspace holds at runtime.

## Related

- [State files](state-files.md)
- [Architecture](architecture.md)
- [Development](development.md)
