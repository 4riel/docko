# Repo Structure

```text
docko/
|-- AGENTS.md
|-- CLAUDE.md
|-- .agents/
|   `-- skills/
|-- docs/
|-- packages/
|   |-- core/
|   |-- cli/
|   `-- adapters/
|       `-- claude-code/
|-- schemas/
|-- tests/
|-- examples/
|-- bin/
|-- package.json
`-- pnpm-workspace.yaml
```

## Boundary Map

- `AGENTS.md`: repo-root operating rules for Codex and other agents working in this repository
- `CLAUDE.md`: repo-root operating rules for Claude Code working in this repository
- `.agents/skills/`: repo-local skills for repo navigation, protocol work, adapters, and docs sync
- `docs/`: product framing, protocol reference, architecture, CLI reference, adapter docs, and contributor guidance
- `packages/core/`: runtime-agnostic protocol semantics, registry persistence, session manifests, stale cleanup, delegation, authorization, and mirror/log services
- `packages/cli/`: thin command-line wrapper over `DockoService`, plus onboarding and installer flows
- `packages/adapters/claude-code/`: Claude-specific hook/install integration; the reference adapter today
- `schemas/`: canonical JSON Schemas for `registry.json` and session manifests
- `tests/`: unit coverage for core modules plus end-to-end CLI and adapter behavior
- `examples/`: example layouts and integration material
- `bin/`: published entrypoint wrapper

## Why The Layout Is Split This Way

The repository keeps contract, implementation, and integration surfaces separate on purpose:

- protocol semantics live in `packages/core`, not in runtime adapters
- the public CLI stays thin so command behavior mirrors the service layer instead of inventing extra state
- schemas live outside the implementation packages because they are public contract documents
- docs live outside source packages so public guidance can be reviewed alongside the protocol contract

## Managed Workspace Versus Repository

This repository is the source code for `docko`.
A managed `docko` workspace created by the CLI has a different layout:

```text
workspace/
|-- slots/
`-- docko/
    |-- registry.json
    |-- registry.md
    |-- .registry.lock/
    |-- sessions/
    `-- logs/
```

That distinction matters when reading the docs:

- repo structure explains how `docko` itself is implemented
- protocol docs explain the state layout inside a managed workspace

## Ownership Expectations By Surface

- edit `packages/core` when claim semantics, stale cleanup, session persistence, or authorization rules change
- edit `packages/cli` when flags, command dispatch, onboarding, or output shaping change
- edit `packages/adapters/*` when runtime hook behavior or installed assets change
- edit `schemas/` and the protocol docs whenever the persisted shapes or documented contract change
- edit `tests/` alongside the owning surface whenever behavior changes

Keeping those boundaries clean is part of the project's design, not just repo organization.
