# Quickstart

The command examples below are shell-neutral unless a block says otherwise.

`docko-workspace@alpha` is intended for real trial use while the protocol and adapter surface continue to settle. Verify the workflow in a disposable workspace first if you plan to adopt it for team-critical coordination.

Public package: [`docko-workspace`](https://www.npmjs.com/package/docko-workspace)
Source repository: [`4riel/docko`](https://github.com/4riel/docko)
Current install tag: `docko-workspace@alpha`
CLI command: `docko`

## Fastest Path

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace
docko status --root ./workspace
docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

For agent loops, add `--brief` to `status`, `slot acquire`, and `session list` to return compact next-action JSON instead of the full protocol payload.

If you prefer zero-install usage instead:

```text
npx --yes --package docko-workspace@alpha docko init --root ./workspace
npx --yes --package docko-workspace@alpha docko status --root ./workspace
npx --yes --package docko-workspace@alpha docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

If you are running from a source checkout:

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

Run those commands from the `docko` checkout. The `--root` flag points at the workspace you want to manage.

If you already have a built checkout locally, the shortest path is:

```text
node ./bin/docko.js init --root ./workspace
node ./bin/docko.js status --root ./workspace
```

`node ./bin/docko.js` is the supported source-checkout launcher after `pnpm build`.

## 1. Start With `init`

The intended onboarding path is:

```text
npm install --global docko-workspace@alpha
docko init --root ./workspace
```

In a normal interactive terminal, `init` uses the guided onboarding flow by default. `--prompt` only exists to force that flow in non-interactive contexts such as tests.

If you prefer to run a built local checkout as a package, this also works:

```text
npx --yes --package file:/absolute/path/to/docko-workspace docko init --root ./workspace
```

Interactive `init`:

- explains the docko model before doing anything
- asks whether to set up Claude Code, Codex, or both
- auto-detects `CLAUDE.md` and `AGENTS.md` before asking where they live
- asks before injecting docko-managed guidance into those files
- asks where the primary repository lives, with examples based on the current terminal folder
- confirms the source folder before creating managed clones
- defaults to one managed clone named after the source folder, then names multiple fresh clones as `<source-folder>_1`, `<source-folder>_2`, `<source-folder>_3`, and so on when you ask for more
- switches to import mode when you pass `--existing`, then asks for the existing clone folders as a comma-separated list
- prints a human summary by default; add `--json` if you want machine-readable output

If you want the same setup non-interactively:

```text
docko init --root ./workspace --claude --codex --inject-claude --inject-codex
```

## 2. What `init` Creates

`init` bootstraps the workspace:

- empty roots resolve to `workspace` mode and create `slots/` plus `slots/main/`
- repo-like roots resolve to `repo` mode and create the same minimal scaffold
- every run bootstraps `docko/registry.json`, `docko/registry.md`, `docko/sessions/`, and `docko/logs/`
- `--slot <id>` is repeatable if you want named starter slots instead of the default `main`
- `--slot-stale-after-ms <n>` stores the workspace default at `workspace.config.janitor.slot_stale_after_ms`
- `--clone-source <path>` with `--clone-slot <id>` duplicates one explicit repo or clone into one managed slot during init

Check the result:

```text
docko status --root ./workspace
docko slot acquire --root ./workspace --session leader --branch feat/task --task "start work"
```

`slot acquire` is the quickest way to start real work after onboarding. It claims the first free managed slot. If none are free, it can ask whether to duplicate an existing slot, or you can opt into that programmatically with `--clone-when-busy`. Use explicit `--application <id>` when the workspace has multiple app pools, and add `--brief` when an agent only needs the selected slot and availability summary.

The starter layout looks like this:

```text
workspace/
|-- slots/
|   `-- main/
`-- docko/
```

Put your warm clones or long-lived working directories under `slots/`. Add docs or planning folders at the root only if your workflow uses them.

`status` runs the same stale-recovery path used by writes. If it releases anything automatically, the JSON payload reports that under `janitor.released_claims`.

## 3. Optional Runtime Onboarding

Core workspace setup does not require a runtime adapter. Runtime onboarding is optional.

### Claude Code

Claude Code is the only implemented runtime adapter today.

The all-in-one path is:

```text
docko init --root ./workspace --claude
```

If you also want `AGENTS.md` guidance prepared in the same run:

```text
docko init --root ./workspace --claude --codex
```

The Claude install writes:

- `.claude-plugin/docko/`
- `.claude/commands/dock-*.md`
- `.claude/skills/workspace-orchestration/SKILL.md`
- `.claude/snippets/CLAUDE.docko.md`
- `.claude/snippets/AGENTS.docko.md`
- `.claude/settings.docko.json`
- `.claude/settings.local.json`

Use this if you want to install or re-run only the Claude adapter step:

```text
docko adapter claude-code install --root ./workspace --write-settings-local
```

### Codex

Codex support in this repository is guidance-based, not adapter-based.

`docko init --root ./workspace --codex` prepares `AGENTS.md` onboarding. In interactive mode it asks before injecting the managed guidance. The resulting rules tell the model to run `docko status --brief`, use `docko slot acquire --brief` before writing, answer explicitly if docko offers to create a fresh managed clone because every slot is busy, do code work inside that slot, treat root-level coordination files as outside Docko's write enforcement, retry `AMBIGUOUS_SESSION` with an explicit session instead of ending sessions, and release the slot when done.

There is no Codex hook layer here. Unlike the Claude adapter, there is no write-enforcement integration.

## 4. Manual Power-User Flow

If you want full control, the explicit commands are:

```text
docko session start --root ./workspace --runtime claude-code --session manual-session
docko slot acquire --root ./workspace --session manual-session --branch feat/session-protocol --task "protocol draft"
docko release --root ./workspace --session manual-session --resource slot --id <claimed-slot>
docko slot duplicate --root ./workspace --from main --to main-copy
```

Use `docko --help` for the full command list.
