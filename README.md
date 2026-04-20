# docko

> Workspace-first slot coordination for AI coding agents.

[![npm alpha](https://img.shields.io/npm/v/docko-workspace/alpha?label=npm%20alpha)](https://www.npmjs.com/package/docko-workspace)
[![source repo](https://img.shields.io/badge/source-4riel%2Fdocko-24292f)](https://github.com/4riel/docko)

`docko` is a local-first workspace and session protocol for teams that keep one stable root and a set of persistent writable slots under `slots/`.

Public package: [`docko-workspace`](https://www.npmjs.com/package/docko-workspace)
Source repository: [`4riel/docko`](https://github.com/4riel/docko)
Current install tag: `docko-workspace@alpha`
CLI command: `docko`

`docko-workspace@alpha` is intended for real trial use while the protocol and adapter surface continue to settle. Verify the workflow in your own workspace before relying on it for team-critical coordination, and treat non-Claude runtimes as guidance-only unless this repo ships a real adapter for them.

The current implementation ships:

- a protocol core and CLI
- a first-class Claude Code adapter
- `AGENTS.md` guidance for Codex and similar agent runtimes

It is not a claim that every runtime is supported equally. Today, Claude Code is the only implemented runtime adapter.

## Why

`docko` is for the workflow where:

- one workspace root stays open all day
- writable repos live in persistent slots under `slots/`
- some slots keep warm caches, local config, or long-running servers
- multiple agents need an inspectable answer to "who owns this slot right now?"
- one workspace may manage multiple applications such as `backend` and `frontend`, each with its own slot pool

It is not an argument against git worktrees. Worktrees are often the simpler answer. `docko` exists for the case where persistent full directories are operationally easier.

## What It Is

Think of `docko` as a small operating layer for agent work in a workspace with persistent slots.

```text
workspace/
|-- README.md
|-- CLAUDE.md
|-- AGENTS.md
|-- slots/
|   |-- backend/
|   |   |-- main_1/
|   |   `-- main_2/
|   |-- frontend/
|   |   |-- main_1/
|   |   `-- main_2/
|   `-- main/
`-- docko/
    |-- registry.json
    |-- registry.md
    |-- sessions/
    `-- logs/
```

- The workspace root is the operational home.
- Code work happens inside `slots/*`.
- `docko/registry.json` is the canonical machine-readable state.
- `docko/registry.md` is the generated mirror for humans.
- Runtime adapters can add ergonomics and enforcement, but the protocol stays runtime-agnostic.

## Quick Way To Use

The recommended first run is:

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace
docko status --root ./workspace
docko app ensure --root ./workspace --id backend --source ../backend --slots 2 --keyword backend --keyword api
docko app ensure --root ./workspace --id frontend --source ../frontend --slots 2 --keyword frontend --keyword web
docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

If you want Claude Code and Codex guidance in the same setup on the first run:

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace --claude --codex
docko status --root ./workspace
docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

If you prefer zero-install usage instead:

```text
npx --yes --package docko-workspace@alpha docko init --root ./workspace
npx --yes --package docko-workspace@alpha docko status --root ./workspace
npx --yes --package docko-workspace@alpha docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

If you are running from source:

```text
git clone https://github.com/4riel/docko.git
cd docko
corepack enable
pnpm install
pnpm build
node ./bin/docko.js init --root ./workspace
node ./bin/docko.js status --root ./workspace
node ./bin/docko.js slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

The supported source-checkout entrypoint is `node ./bin/docko.js` after `pnpm build`.

The package name is [`docko-workspace`](https://www.npmjs.com/package/docko-workspace). The source repository is [`4riel/docko`](https://github.com/4riel/docko). The current public install target is `docko-workspace@alpha`. The command stays `docko`. The `--root` path is the workspace you want `docko` to manage.
When applications are configured, `docko slot acquire` can take `--application <id>` explicitly or infer the right application from task keywords such as `backend` or `frontend`. For AI-agent loops, prefer explicit `--application <id>` and add `--brief` to `status`, `slot acquire`, or `session list` when you only need compact next-action context.

## More Details

### When It Fits

`docko` is useful when you want:

- persistent slots instead of disposable checkouts
- long-running local servers tied to stable directories
- warm dependencies, build artifacts, and framework caches
- one root where coordination docs can live beside the code
- explicit, inspectable slot ownership for multi-agent work
- application-specific slot pools with separate warm clones and keyword hints

Use worktrees instead when:

- your environment is light and branch-centric
- cheap parallel checkouts are the main goal
- you do not need a workspace hub
- recreating local state is inexpensive

### Quickstart

The simplest onboarding path is:

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace
```

In a normal interactive terminal, `init` uses the guided onboarding flow by default. `--prompt` exists to force that flow outside a normal TTY, mainly for tests and scripted demos.

Interactive `init`:

- explains the workspace model before doing anything
- asks whether to set up Claude Code, Codex, or both
- auto-detects `CLAUDE.md` and `AGENTS.md` first, then asks where they live only if it cannot find them
- asks before injecting docko-managed guidance into those files
- asks where the primary repository lives, with examples based on the current terminal folder
- confirms the source folder before creating managed clones from it
- assumes one managed clone by default, names it after the source folder, then names multiple fresh clones as `<source-folder>_1`, `<source-folder>_2`, `<source-folder>_3`, and so on when you ask for more
- switches to import mode when you pass `--existing`, then asks for the existing clone folders as a comma-separated list
- prints a human summary by default; add `--json` if you want the final payload for scripts or tests

If you want one explicit non-interactive setup command:

```text
docko init --root ./workspace --claude --codex --inject-claude --inject-codex --slot-stale-after-ms 14400000
```

`init` bootstraps the workspace:

- empty roots resolve to `workspace` mode and create `slots/` plus `slots/main/`
- repo-like roots resolve to `repo` mode and create the same minimal scaffold
- every run bootstraps `docko/registry.json`, `docko/registry.md`, `docko/sessions/`, and `docko/logs/`
- `--slot <id>` is repeatable when you want named starter slots instead of the default `main`
- `--slot-stale-after-ms <n>` stores the workspace default at `workspace.config.janitor.slot_stale_after_ms`
- `--clone-source <path>` plus `--clone-slot <id>` duplicates one explicit repo or clone into one managed slot during init
- `docko app ensure --id <app> --source <path> --slots <n> --keyword <term>` adds an application-aware slot pool and seeds `slots/<app>/*`

For scripts, `init` returns both display-oriented and absolute root paths: `workspace_root` may be relative to the current terminal folder, while `workspace_root_absolute` is always the resolved absolute workspace path.

Check the result:

```text
docko status --root ./workspace
docko app ensure --root ./workspace --id backend --source ../backend --slots 2 --keyword backend --keyword api
docko slot acquire --root ./workspace --session manual-session --application backend --branch feat/my-feature --task "implement backend billing"
docko slot acquire --root ./workspace --session manual-session --branch feat/my-feature --task "implement billing"
```

`status` runs the same stale-recovery path used by writes. If it releases anything automatically, the JSON payload reports that under `janitor.released_claims`.

`slot acquire` is the operational shortcut for everyday work. It claims the first free managed slot and, when every slot is already busy, it can prompt to duplicate an existing managed slot or do that automatically with `--clone-when-busy`. When the workspace has configured applications, it can also pick the right slot pool from `--application` or from task keywords. When it creates a clone, the JSON payload reports the new slot plus `size_bytes` and `size_mb`. Add `--brief` when an agent only needs the chosen slot, session, availability, and clone summary.

Power users can still drive the protocol explicitly:

```text
docko session start --root ./workspace --runtime claude-code --session manual-session
docko slot acquire --root ./workspace --session manual-session --branch feat/my-feature --task "implement billing"
docko release --root ./workspace --session manual-session --resource slot --id <claimed-slot>
docko slot duplicate --root ./workspace --from main --to main-copy
```

Run `docko --help` for the full command list.

### Support Today

### Claude Code

Claude Code is the only implemented runtime adapter today.

The fast path is:

```text
docko init --root . --claude --codex
```

That bootstraps the workspace, installs Claude adapter assets, and prepares `CLAUDE.md` plus `AGENTS.md` guidance in one run. In interactive mode, `init` asks before injecting the managed snippets.

If you want to install or re-run only the Claude adapter layer:

```text
docko adapter claude-code install --root . --write-settings-local
```

That writes:

- `.claude-plugin/docko/`
- `.claude/commands/dock-*.md`
- `.claude/skills/workspace-orchestration/SKILL.md`
- `.claude/snippets/CLAUDE.docko.md`
- `.claude/snippets/AGENTS.docko.md`
- `.claude/settings.docko.json`
- `.claude/settings.local.json`

The adapter installs four Claude hooks:

| Hook | What it does |
|---|---|
| `SessionStart` | Creates a Docko session and sets `DOCKO_SESSION_ID` |
| `SessionEnd` | Releases claims owned by that session |
| `PreToolUse` | Blocks `Edit` and `Write` into slots the session does not own |
| `SubagentStart` | Registers the child session and inherits parent slot authority |

If the CLI is not on `PATH`, set `DOCKO_BIN` in `.claude/settings.local.json`.

See [Claude Code Integration](docs/claude-code.md) for the full adapter behavior.

### Codex And Other `AGENTS.md` Runtimes

Codex support today is guidance-based, not adapter-based.

`docko` can inject or provide `AGENTS.md` instructions that tell the model to:

1. run `docko status --root . --brief`
2. use `docko slot acquire --root . --session <id> --branch <branch> --task "<task>" --brief` to claim a writable slot
3. answer explicitly if docko asks whether it should create a fresh managed clone because all current slots are busy
4. do code work inside that claimed slot and treat root-level coordination files as outside Docko's write enforcement
5. release it when done

If a command reports `AMBIGUOUS_SESSION`, retry with an explicit `--session <id>` from `docko session list --root . --brief`. Do not end sessions unless you are intentionally cleaning up workspace state.

There is no Codex hook layer in this repository, and there is no write-enforcement equivalent to the Claude adapter. The model has to follow the `AGENTS.md` rules.

If the CLI is unavailable, the injected guidance tells the model to try `DOCKO_BIN` and otherwise stop. It should not replace the CLI with manual `docko/registry.json` inspection.

### Limits

- it uses more disk than worktrees
- the lock protocol is an operational control, not a hard security boundary
- it works best when teams keep repo instructions and coordination docs tidy
- only Claude Code has a shipped runtime adapter today

## Read Next

- [Quickstart](docs/quickstart.md)
- [Public Positioning](docs/public-positioning.md)
- [FAQ](docs/faq.md)
- [Claude Code Integration](docs/claude-code.md)
- [Protocol Spec](docs/protocol.md)
- [Why Not Just Worktrees?](docs/why-not-just-worktrees.md)
- [Documentation Index](docs/INDEX.md)
