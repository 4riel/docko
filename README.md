# docko

**One workspace. Many agents. Zero write collisions.**

`docko` is a local-first workspace and session protocol for AI coding agents. It gives every
agent session its own writable slot under one persistent workspace root — and makes ownership
explicit, inspectable, and self-healing.

[![CI](https://github.com/4riel/docko/actions/workflows/ci.yml/badge.svg)](https://github.com/4riel/docko/actions/workflows/ci.yml)
[![npm alpha](https://img.shields.io/npm/v/docko-workspace/alpha?label=npm%20alpha)](https://www.npmjs.com/package/docko-workspace)
[![node >=22](https://img.shields.io/node/v/docko-workspace/alpha)](https://nodejs.org)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](docs/claude-code.md)

## The problem

Point two agents at the same repository and they will eventually edit the same files, fight
over the same dev server, and leave you guessing which checkout is safe to touch. Git
worktrees isolate code, but they don't tell you *who owns what right now* — and they throw
away the warm state (running servers, caches, build output) you wanted to keep.

docko answers the ownership question with state on disk, not hope.

## What docko does

- **Persistent slots.** Each slot under `slots/` is a writable clone that keeps dev servers,
  caches, and build state warm across sessions.
- **Explicit claims.** A slot has exactly one owner session at a time. Claims record the
  session, branch, and task — nothing is implicit.
- **Delegation.** A parent session can hand slot authority to subagents or teammates,
  explicitly and per-resource.
- **Stale recovery.** Heartbeats keep claims alive; abandoned ones expire automatically, so a
  crashed agent can't hold a slot hostage.
- **Inspectable state.** `docko/registry.json` is canonical. `docko/registry.md` is a generated
  mirror you can actually read:

  | Application | Slot | Status | Branch | Task | Updated | Owner |
  |---|---|---|---|---|---|---|
  | | backend | FREE | | | | |
  | | main | CLAIMED | feat/demo | demo | 2026-09-21 15:34 | ses_ce01cc6b… |

## What docko does not do

- **No git operations.** `branch` on a claim is recorded metadata. docko never runs
  `git checkout`, never merges, never touches your history.
- **No network.** Everything is local JSON on disk. There is no server, no account, no sync.
- **Not a security boundary.** The filesystem lock coordinates honest agents; it does not
  sandbox malicious ones.
- **Not a worktree replacement for light work.** If your environment is branch-centric and
  recreating local state is cheap, [git worktrees](docs/why-not-just-worktrees.md) are the
  simpler tool.

## 60 seconds

```bash
npm install --global docko-workspace@alpha   # Node >= 22
docko init                                  # creates slots/ and docko/ in your workspace
docko session start --session my-session
docko slot acquire --session my-session --branch feat/x --task "describe the work" --brief
docko status --brief                        # who owns what, right now
```

Prefer zero-install? `npx --yes --package docko-workspace@alpha docko status --root ./workspace`

## Claude Code plugin

The shipped runtime adapter. Four hooks (`SessionStart`, `SessionEnd`, `PreToolUse`,
`SubagentStart`), five `/dock-*` commands, and a `workspace-orchestration` skill. The
`PreToolUse` hook blocks `Write`/`Edit` inside slots your session doesn't own — and the deny
message names the exact command that fixes it.

```text
/plugin marketplace add 4riel/docko
/plugin install docko@docko
```

[Use docko with Claude Code](docs/claude-code.md) ·
[Install into a project instead](docs/claude-code.md#install-into-a-project-instead) ·
[Codex and other AGENTS.md runtimes](docs/agents-md-runtimes.md)

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

Every registry-backed operation takes a filesystem lock, re-discovers slots, runs stale
cleanup, executes, and releases — one small, explicit state machine.

## When to use docko

- You want persistent slots instead of disposable checkouts
- Local servers and warm caches stay tied to one directory
- More than one agent works against the same workspace root
- You want explicit, inspectable ownership state on disk

## Limits

- Claude Code is the only implemented runtime adapter today. Codex and other `AGENTS.md`
  runtimes get guidance, not hook enforcement.
- Slots use more disk than git worktrees.
- This is an alpha package. Verify the workflow in your own workspace before relying on it
  for team-critical coordination.

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
