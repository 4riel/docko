# docko

Local-first slot coordination for AI coding agents.

[![CI](https://github.com/4riel/docko/actions/workflows/ci.yml/badge.svg)](https://github.com/4riel/docko/actions/workflows/ci.yml)
[![npm alpha](https://img.shields.io/npm/v/docko-workspace/alpha?label=npm%20alpha)](https://www.npmjs.com/package/docko-workspace)
[![node >=22](https://img.shields.io/node/v/docko-workspace/alpha)](https://nodejs.org)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![source repo](https://img.shields.io/badge/source-4riel%2Fdocko-24292f)](https://github.com/4riel/docko)

## What is docko

`docko` is a local-first workspace and session protocol for AI coding agents. It coordinates
writable slots, session ownership, delegation, and stale recovery inside one persistent workspace
root, so two agents never write into the same slot at once.

It ships three pieces: a protocol core, a CLI, and the [Claude Code adapter](docs/claude-code.md).
The protocol itself is runtime-agnostic; adapters enforce it for one runtime at a time.

## Install

```bash
npm install --global docko-workspace@alpha
```

Prefer zero-install:

```bash
npx --yes --package docko-workspace@alpha docko status --root ./workspace
```

Requires Node 22 or later.

## Get started

Pick the path that matches your runtime. Each one ends with the guide that walks you through it.

- **Claude Code plugin.** Add this repo as a marketplace, install the plugin, and let hooks drive
  docko for you. [Use docko with Claude Code](docs/claude-code.md)
- **Repo-local install.** Copy the same hooks, commands, and skill into your project instead of
  using the plugin.
  [Install into a project instead](docs/claude-code.md#install-into-a-project-instead)
- **CLI only.** Run docko by hand or from a script with the [Quickstart](docs/quickstart.md), or
  from Codex through
  [Codex and other AGENTS.md runtimes](docs/agents-md-runtimes.md).

## How it works

```text
workspace/
|-- slots/             <- writable directories agents work in
|   |-- main/
|   |-- backend/main_1/
|   `-- frontend/main_1/
`-- docko/
    |-- registry.json  <- canonical ownership state
    |-- registry.md    <- generated mirror
    |-- sessions/
    `-- logs/
```

- One workspace root stays open for the life of the work.
- Each slot under `slots/` holds a persistent, writable clone.
- `docko/registry.json` is the canonical source of ownership. `docko/registry.md` is a generated
  mirror for humans.
- A session claims a slot. Stale recovery releases claims nobody is heartbeating.
- Runtime adapters enforce ownership. The protocol itself works with any runtime.

## When to use docko

Use it when:

- you want persistent slots instead of disposable checkouts
- local servers and warm caches stay tied to one directory
- more than one agent works against the same workspace root
- you want explicit, inspectable ownership state on disk

Use [git worktrees](docs/why-not-just-worktrees.md) instead when your environment is light and
branch-centric, and recreating local state is cheap.

## Limits

- Claude Code is the only implemented runtime adapter today. Codex and other `AGENTS.md` runtimes
  get guidance, not hook enforcement.
- The registry lock is an operational control, not a security boundary.
- Slots use more disk than git worktrees.
- This is an alpha package. Verify the workflow in your own workspace before relying on it for
  team-critical coordination.

## Documentation

- [Quickstart](docs/quickstart.md)
- [Use docko with Claude Code](docs/claude-code.md)
- [CLI reference](docs/cli-reference.md)
- [Protocol](docs/protocol.md)
- [Concepts](docs/concepts.md)
- [Troubleshooting](docs/troubleshooting.md)

See the [documentation index](docs/INDEX.md) for everything else.

## License

[MIT](LICENSE)
