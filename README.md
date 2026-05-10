# docko

> Workspace-first slot coordination for AI coding agents.

[![npm alpha](https://img.shields.io/npm/v/docko-workspace/alpha?label=npm%20alpha)](https://www.npmjs.com/package/docko-workspace)
[![source repo](https://img.shields.io/badge/source-4riel%2Fdocko-24292f)](https://github.com/4riel/docko)

## What is docko?

`docko` is a local-first protocol that coordinates writable "slots" across one persistent workspace. It answers "who owns this folder right now?" for multi-agent work — so two agents never stomp on the same branch, and stale claims clean themselves up.

It ships a protocol core, a CLI, and a first-class **Claude Code adapter**. Once installed, the adapter drives docko for you through hooks — you do not need to run docko commands by hand.

## Install

```sh
npm install --global docko-workspace@alpha
```

Prefer zero-install? Replace `docko` with `npx --yes --package docko-workspace@alpha docko` in every example below.

## Quickstart (Claude Code)

```sh
docko init --root . --claude
```

That is it. The adapter installs hooks into `.claude/` and wires `CLAUDE.md` guidance. From there:

- **SessionStart** opens a docko session automatically.
- **PreToolUse** blocks `Edit` / `Write` into slots the session does not own.
- **SessionEnd** releases claims for you.

You work in Claude Code normally. Docko commands run in the background.

> Want both Claude Code and Codex guidance in one run? Use `docko init --root . --claude --codex`.

## Quickstart (Codex & other `AGENTS.md` runtimes)

```sh
docko init --root . --codex
```

This injects `AGENTS.md` guidance that tells the model to run `docko status`, `docko slot acquire`, and release slots when done. Codex support is **guidance-based, not adapter-based** — there are no hooks enforcing writes, so the model has to follow the rules in `AGENTS.md`.

After init, you work in Codex normally. The agent calls docko for you based on the injected instructions.

## Quickstart (manual / scripts)

For scripting, CI, or runtimes without any adapter:

```sh
docko init --root ./workspace
docko status --root ./workspace
docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

Run `docko --help` for the full command list, or see [docs/cli-reference.md](docs/cli-reference.md).

## How it works

```
workspace/
|-- CLAUDE.md          <- managed guidance for agents
|-- AGENTS.md
|-- slots/             <- writable clones live here
|   |-- backend/main_1/
|   |-- frontend/main_1/
|   `-- main/
`-- docko/
    |-- registry.json  <- canonical state (machine)
    |-- registry.md    <- mirror (humans)
    |-- sessions/
    `-- logs/
```

- One workspace root stays open all day.
- Code work happens inside `slots/*` — persistent, with warm caches and running servers.
- `docko/registry.json` is the single source of truth for ownership.
- Runtime adapters enforce it. The protocol itself is runtime-agnostic.

## Why docko?

Use it when you want:

- persistent slots instead of disposable checkouts
- long-running local servers tied to stable directories
- warm dependencies and build artifacts kept hot
- explicit, inspectable ownership for multi-agent work
- application-specific slot pools (e.g. `backend`, `frontend`) with their own warm clones

Use [git worktrees](docs/why-not-just-worktrees.md) instead when your environment is light, branch-centric, and recreating local state is cheap.

## Limits

- Uses more disk than worktrees.
- The lock protocol is an operational control, not a security boundary.
- Only Claude Code has a shipped runtime adapter today — Codex support is guidance-based.
- Alpha: verify the workflow in your own workspace before relying on it for team-critical coordination.

## Docs

- [Quickstart](docs/quickstart.md)
- [Claude Code integration](docs/claude-code.md)
- [CLI reference](docs/cli-reference.md)
- [Protocol spec](docs/protocol.md)
- [FAQ](docs/faq.md)
- [Why not just worktrees?](docs/why-not-just-worktrees.md)
- [Full documentation index](docs/INDEX.md)

## License

[MIT](LICENSE)
