# Claude Code Integration

`docko`'s only implemented runtime adapter today is the Claude Code adapter in `packages/adapters/claude-code`.

Public package: [`docko-workspace`](https://www.npmjs.com/package/docko-workspace)
Source repository: [`4riel/docko`](https://github.com/4riel/docko)
Current install tag: `docko-workspace@alpha`
CLI command: `docko`

There are two ways to wire Claude Code to docko. Both share the same hook launcher, commands, and skill; they differ only in where those files live.

## Install As A Claude Code Plugin (Recommended)

The repository doubles as a Claude Code plugin marketplace. Inside Claude Code run:

```
/plugin marketplace add 4riel/docko
/plugin install docko@docko
```

That installs the plugin bundle from `packages/adapters/claude-code/plugin/`: the four hooks, the `/dock-*` commands, and the `workspace-orchestration` skill. Nothing is written into your project.

Then bootstrap any workspace root once:

```bash
docko init --root .
```

Plugin behavior worth knowing:

- Hooks no-op silently in projects without a `docko/registry.json`, so the plugin can stay enabled globally.
- Hooks call the `docko` CLI. Install it globally (`npm install --global docko-workspace@alpha`) for fast hooks; if it is missing from `PATH` the launcher falls back to `npx docko-workspace@alpha`, which is slower on first run. `DOCKO_BIN` overrides both.
- `PreToolUse` denials are reported through the hook protocol (`permissionDecision: "deny"`), so unauthorized slot writes are actually blocked. Authorized writes emit nothing: docko vetoes, it never widens your normal permission flow.
- `SessionStart` registers the Claude session with docko using Claude's own session id, so later hook calls resolve the right session even with several concurrent sessions in one workspace.
- `SessionStart` also exports the session id into the session's shell environment. When Claude Code provides `$CLAUDE_ENV_FILE`, the launcher appends `DOCKO_SESSION_ID`, `DOCKO_RUNTIME`, and `DOCKO_ROOT` to it, so a bare `docko claim` from a Bash tool call resolves to the right session instead of failing with `AMBIGUOUS_SESSION`. Only keys matching `^[A-Z][A-Z0-9_]*$` with single-line values are written, and a failure there never breaks the session. The CLI also falls back to `CLAUDE_CODE_SESSION_ID`, which Claude Code exports into every tool call, so the flow still works on hosts that do not provide an env file.
- A denial names the slot, the reason, and one runnable recovery command. The three denial reasons render differently:
  - `slot-not-claimed`: the slot is free (with its previous owner when known), and the message carries a `docko slot acquire --prefer <slot>` line.
  - `claim-expired`: your own claim lapsed, with the expiry time and the quiet window, and a `docko claim` line that restores it with the same branch and task.
  - `unrelated-session`: another session owns it, with that session's task, branch, and whether it is still active, plus a `docko release --force` line for a deliberate takeover.

## Repo-Local Install (`docko init --claude`)

If you prefer everything checked into the project (no plugin system involved), install the CLI first if it is not already available:

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

`plugin.json` is generated, not copied: its `version` is stamped from the installed docko version on every install, so the bundle never drifts behind the package.

## Add The Repo Rules

Merge the contents of `.claude/snippets/CLAUDE.docko.md` into `CLAUDE.md`.

Mirror the same operating rules into `AGENTS.md` using `.claude/snippets/AGENTS.docko.md`.

If you use the interactive `init` flow, docko can inject both files for you after asking for confirmation.

Those snippets are intentionally short. They give Claude a minimal command-first recipe, tell it to start with `docko status --brief`, prefer `docko slot acquire` for writable work, and tell it to stop if the CLI is unavailable instead of improvising from `docko/registry.json`.

## Use It

After setup:

1. Open Claude Code from the workspace root.
2. Prompt at the task level.
3. Let Claude claim or reuse the correct slot.
4. Only intervene when `docko` reports a real ownership conflict.

That is the intended experience. The user should not have to micromanage slot bookkeeping during routine work.

The fast-path behavior Claude should follow is:

1. Run `/dock-status` or `docko status --brief`. docko walks up to the workspace root, so this works from inside a slot; `--root <path>` is only needed from outside the workspace.
2. Use `docko slot acquire --session "$DOCKO_SESSION_ID" --branch <branch> --task "<task>" --brief` when you want docko to choose the slot. Selection is round-robin, starting after the last slot claimed for that application.
3. Pass `--application <id>` in a multi-application workspace, and `--prefer <slot-id>` when one specific slot is the right one.
4. If every slot is busy and docko asks whether to create a fresh managed clone, answer explicitly.
5. Use `/dock-claim` or `docko claim --session "$DOCKO_SESSION_ID" --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot you want. `branch` is claim metadata; docko never runs `git checkout`.
6. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko's hook checks.
7. Release it with `/dock-release <slot>` or `docko release --session "$DOCKO_SESSION_ID" --resource slot --id <slot>`.

If a command reports `AMBIGUOUS_SESSION`, Claude should run the `suggested_command` from the error payload (the same command with `--session` filled in), or pick an id from `docko session list --brief`, and not end sessions unless the user asked for cleanup. It should never invent a session id: the write hook checks Claude's own session, so a made-up id claims a slot that then blocks its own writes.

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
        "hooks": [
          {
            "type": "command",
            "command": "node \"/abs/path/to/workspace/.claude-plugin/docko/scripts/docko-claude-hook.mjs\" session-start",
            "timeout": 60
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/abs/path/to/workspace/.claude-plugin/docko/scripts/docko-claude-hook.mjs\" session-end",
            "timeout": 15
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
            "command": "node \"/abs/path/to/workspace/.claude-plugin/docko/scripts/docko-claude-hook.mjs\" pre-tool-use",
            "timeout": 30
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/abs/path/to/workspace/.claude-plugin/docko/scripts/docko-claude-hook.mjs\" subagent-start",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Details that matter:

- The launcher path is absolute, generated from the workspace root at install time (or from `--dest`), so hooks resolve from any working directory and any shell. The distributable plugin uses `${CLAUDE_PLUGIN_ROOT}` instead.
- Only `PreToolUse` carries a matcher. `SessionStart` matches a session source and `SessionEnd`/`SubagentStart` take none, so `"*"` would be meaningless there.
- Timeouts differ per event: `SessionStart` is 60 s because it may pay for an `npx` cold start; the tool and subagent hooks get 30 s; `SessionEnd` 15 s. The plugin bundle and the repo-local install use the same numbers, and a test asserts they stay in sync.

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

Which teammates need `docko delegate`:

- **Subagents started with the Agent tool share the parent's session id.** They inherit the parent's claim automatically and need no docko call. `SubagentStart` also registers a delegated session and copies the parent's delegations, so either identity is authorized.
- **A separately launched `claude` process gets its own session id.** It is not covered by the parent's claim, and its first write into the slot is denied as `unrelated-session`. Delegate it explicitly: `docko delegate --session <owner> --child-session <child> --resource slot --id <slot>`.
- Do not work around a denial by overwriting `CLAUDE_CODE_SESSION_ID`. Claim, delegate, or release; a spoofed id only moves the problem.

The adapter tests cover the important parts of that claim:

- the generated hook commands are absolute and shell-neutral, and match the plugin bundle's matchers and timeouts
- install writes the expected repo-local assets and refreshes an outdated hook launcher
- settings merging is idempotent and never leaves a duplicate docko registration
- `PreToolUse` authorizes writes inside a claimed slot, and each denial reason renders its own recovery command
- `SessionStart` exports `DOCKO_SESSION_ID` through `$CLAUDE_ENV_FILE`
- `SubagentStart` is part of the installed hook surface

## Codex Contrast

Codex should be documented differently.

OpenAI's Codex docs currently say Codex supports:

- `AGENTS.md` instruction files
- project and personal skills
- explicit subagent workflows
- hooks, including Windows-specific command and managed-directory fields

This repo does not currently ship a Docko Codex adapter package, Codex templates, or Codex adapter tests. So the accurate guidance is:

- Claude Code is the only first-class Docko adapter today.
- Codex can still use Docko through `AGENTS.md`, repo skills, and manual `docko` CLI calls.
- Do not describe Codex as having the same installed enforcement path as Claude Code.
- Do not recommend Codex hooks as the default Docko path until this repo ships and tests a dedicated Codex adapter.

## Notes

- The Node hook launcher prefers `docko` on `PATH` and falls back to `npx docko-workspace@alpha` when it is missing. For local testing, set `DOCKO_BIN` to an absolute executable path (on Windows a multi-token value like `node "C:\path\to\docko.js"` also works).
- If you do not want automatic settings merging, install without `--write-settings-local` and merge `.claude/settings.docko.json` manually.
- The repo-local `.claude-plugin/docko/` bundle is intentionally plain. It avoids hiding protocol logic behind opaque Claude-only behavior.
- Run `docko adapter claude-code doctor` (or `/dock-doctor`) when hooks misbehave. It reports launcher version drift, duplicate or dangling hook registrations in `.claude/settings.json` and `.claude/settings.local.json`, how `docko` resolves, and the session id this shell sees. `--fix` removes registrations that point at a launcher which is missing or out of date.
- The installed launcher carries a `// docko-launcher-version:` header. `docko adapter claude-code install` refreshes it whenever it differs from the shipped version, even without `--force`, because a stale launcher silently degrades every hook.
