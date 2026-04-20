# Claude Code Integration

`docko`'s only implemented runtime adapter today is the Claude Code adapter in `packages/adapters/claude-code`.

Public package: [`docko-workspace`](https://www.npmjs.com/package/docko-workspace)
Source repository: [`4riel/docko`](https://github.com/4riel/docko)
Current install tag: `docko-workspace@alpha`
CLI command: `docko`

Install the CLI first if it is not already available:

```bash
npm install --global docko-workspace@alpha
```

For a Claude-focused workspace bootstrap, use:

```bash
docko init --root . --claude
```

If you also want `AGENTS.md` guidance for Codex or other instruction-driven agents, add `--codex`. That does not install a Codex adapter. It only prepares repo guidance alongside the Claude setup.

In an interactive terminal, `init` uses the guided flow automatically. It tries to auto-detect `CLAUDE.md` and `AGENTS.md`, asks before injecting docko guidance, validates the workspace root you typed, and can walk you through original-repo cloning plus existing-clone import.

That bootstraps the workspace state and installs Claude-facing assets in one step, using shell-neutral Node hook commands that work across PowerShell, `cmd.exe`, macOS, and Linux shells.

## What `--claude` Installs

The Claude install step writes three things:

- a repo-local bundle under `.claude-plugin/docko/`
- project-visible Claude assets under `.claude/`
- mergeable snippets for `CLAUDE.md` and `AGENTS.md`

That scaffolds:

- `.claude-plugin/docko/plugin.json`
- `.claude-plugin/docko/hooks/hooks.json`
- `.claude-plugin/docko/scripts/docko-claude-hook.mjs`
- `.claude/commands/dock-*.md`
- `.claude/skills/workspace-orchestration/SKILL.md`
- `.claude/snippets/CLAUDE.docko.md`
- `.claude/snippets/AGENTS.docko.md`
- `.claude/settings.docko.json`
- `.claude/settings.local.json`

Those file paths are not just examples. They come from the current installer templates and generated output verified by `tests/claude-code-adapter.test.mjs`.

## Add The Repo Rules

Merge the contents of `.claude/snippets/CLAUDE.docko.md` into `CLAUDE.md`.

Mirror the same operating rules into `AGENTS.md` using `.claude/snippets/AGENTS.docko.md`.

If you use the interactive `init` flow, docko can inject both files for you after asking for confirmation.

Those snippets are intentionally short. They give Claude a minimal command-first recipe, tell it to start with `docko status --root . --brief`, prefer `docko slot acquire` for writable work, and tell it to stop if the CLI is unavailable instead of improvising from `docko/registry.json`.

## Use It

After setup:

1. Open Claude Code from the workspace root.
2. Prompt at the task level.
3. Let Claude claim or reuse the correct slot.
4. Only intervene when `docko` reports a real ownership conflict.

That is the intended experience. The user should not have to micromanage slot bookkeeping during routine work.

The fast-path behavior Claude should follow is:

1. Run `/dock-status` or `docko status --root . --brief`.
2. Use `docko slot acquire --root . --branch <branch> --task "<task>" --brief` when you want docko to choose the first free slot for you.
3. If every slot is busy and docko asks whether to create a fresh managed clone, answer explicitly.
4. Use `/dock-claim` or `docko claim --root . --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot you want.
5. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko's hook checks.
6. Release it with `/dock-release <slot>` or `docko release --root . --resource slot --id <slot>`.

If a command reports `AMBIGUOUS_SESSION`, Claude should run `docko session list --root . --brief`, retry with the correct explicit `--session <id>`, and not end sessions unless the user asked for cleanup.

If `docko` is not runnable, Claude should check `DOCKO_BIN` and otherwise stop and tell the user the CLI is unavailable. It should not silently fall back to browsing `docko/registry.json` and editing a free-looking slot.

## Explicit Power-User Path

If you want to install only the adapter layer, keep using the explicit command:

```bash
docko adapter claude-code install --root . --write-settings-local
```

Useful options:

- `--dest .claude-plugin/docko` to control the plugin destination
- `--force` to replace managed files
- omit `--write-settings-local` if you want to merge `.claude/settings.docko.json` manually

`--write-settings-local` matters on Windows because the installer emits shell-neutral Node hook commands into `.claude/settings.local.json`, so PowerShell users do not need bash wrappers or `%VAR%` interpolation.

## Hook Setup

The recommended settings fragment is:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \".claude-plugin/docko/scripts/docko-claude-hook.mjs\" session-start",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \".claude-plugin/docko/scripts/docko-claude-hook.mjs\" session-end",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \".claude-plugin/docko/scripts/docko-claude-hook.mjs\" pre-tool-use",
            "timeout": 10
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \".claude-plugin/docko/scripts/docko-claude-hook.mjs\" subagent-start",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

`docko adapter claude-code settings` prints the same fragment as JSON. The command strings are intentionally the same across Bash, PowerShell, and `cmd.exe`.

## Team Workflow

The important team path is:

1. Leader session starts.
2. Leader claims a slot.
3. Leader delegates or spawns a teammate.
4. `SubagentStart` registers the teammate session.
5. `docko` copies inherited authority from parent to child.
6. `PreToolUse` allows the teammate to write inside the parent-owned slot.

That makes Claude Code Agent Teams a first-class `docko` workflow.

The adapter tests cover the important parts of that claim:

- the generated hook commands are shell-neutral
- install writes the expected repo-local assets
- settings merging is idempotent
- `PreToolUse` authorizes writes inside a claimed slot
- `SubagentStart` is part of the installed hook surface

## Codex Contrast

Codex should be documented differently.

OpenAI's Codex docs currently say Codex supports:

- `AGENTS.md` instruction files
- project and personal skills
- explicit subagent workflows
- hooks, but only as an experimental feature and with Windows support temporarily disabled

This repo does not currently ship a Docko Codex adapter package, Codex templates, or Codex adapter tests. So the accurate guidance is:

- Claude Code is the only first-class Docko adapter today.
- Codex can still use Docko through `AGENTS.md`, repo skills, and manual `docko` CLI calls.
- Do not describe Codex as having the same installed enforcement path as Claude Code.
- Do not recommend Codex hooks as the default Docko path, especially on Windows.

## Notes

- The Node hook launcher assumes `docko` is on `PATH`. For local testing, set `DOCKO_BIN` to an absolute executable path.
- If you do not want automatic settings merging, install without `--write-settings-local` and merge `.claude/settings.docko.json` manually.
- The repo-local `.claude-plugin/docko/` bundle is intentionally plain. It avoids hiding protocol logic behind opaque Claude-only behavior.
