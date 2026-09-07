# Use docko with Claude Code

Claude Code is the only implemented runtime adapter. Its hooks register the session, deny writes
into slots the session has not claimed, and pass claims down to delegated teammates.

## Install the plugin

The docko repository is also a Claude Code plugin marketplace. Run both commands inside Claude
Code:

```text
/plugin marketplace add 4riel/docko
/plugin install docko@docko
```

That installs the plugin bundle: the four hooks, the five `/dock-*` commands, and the
`workspace-orchestration` skill. Nothing is written into your project.

Install the CLI globally so the hooks resolve it without a download:

```bash
npm install --global docko-workspace@alpha
```

Then create the workspace root once:

```bash
docko init --root ./workspace
```

The hook launcher runs `docko` from `PATH`. When `docko` is missing it falls back to
`npx --yes --package docko-workspace@alpha docko`, which is slow on a cold cache. `DOCKO_BIN`
overrides both, and accepts a multi-token value such as `node "C:\path\to\docko.js"` on Windows.

> **Note:** The hooks exit silently in any directory without a `docko/registry.json`, so the plugin
> can stay enabled across every project.

## Install into a project instead

A repo-local install copies the same launcher, commands, and skill into the project and registers
the hooks in `.claude/settings.local.json`. Choose it when the hook settings belong in version
control, or when everyone on the project must get docko without installing a plugin.

```bash
docko init --root ./workspace --claude
```

That writes the launcher bundle, the five slash commands, the skill, the snippets, and the
settings:

```text
.claude-plugin/docko/plugin.json
.claude-plugin/docko/hooks/hooks.json
.claude-plugin/docko/scripts/docko-claude-hook.mjs
.claude/commands/dock-claim.md, dock-doctor.md, dock-heartbeat.md, dock-release.md, dock-status.md
.claude/skills/workspace-orchestration/SKILL.md
.claude/snippets/CLAUDE.docko.md
.claude/snippets/AGENTS.docko.md
.claude/settings.docko.json
.claude/settings.local.json
```

Three of those are generated machine state and are rewritten on every install:
`.claude-plugin/docko/plugin.json`, `.claude-plugin/docko/hooks/hooks.json`, and
`.claude/settings.docko.json`. The hook launcher is refreshed whenever its
`// docko-launcher-version:` header differs from the shipped one. Commands, the skill, and the
snippets are yours to edit and are preserved unless you pass `--force`. A file whose content does
not move is reported under `unchanged_files` rather than `written_files`.

Merge `.claude/snippets/CLAUDE.docko.md` into `CLAUDE.md` so Claude reads the workspace rules
outside a hook. The guided `init` flow offers to inject it for you.

To install the adapter into a workspace root that already exists, run
`docko adapter claude-code install` instead. It writes the same assets and takes `--dest`,
`--write-settings-local`, and `--force`. See the
[CLI reference](cli-reference.md#docko-adapter-claude-code-install).

## What the hooks do

| Event | What docko does | Timeout |
| --- | --- | --- |
| `SessionStart` | Registers the Claude session and exports its id into the session environment. | 60 |
| `SessionEnd` | Ends the docko session and releases the claims it holds. | 15 |
| `PreToolUse` | Authorizes an `Edit` or `Write` against the claim on the target slot. | 30 |
| `SubagentStart` | Registers a delegated child session and copies the parent's delegations. | 30 |

`SessionStart` registers the session under Claude Code's own session id, so later hooks address it
explicitly instead of relying on single-active-session resolution. It injects the session id, the
workspace root, and the acquire, claim, and release commands as context. When Claude Code provides
`$CLAUDE_ENV_FILE`, the launcher appends `DOCKO_SESSION_ID`, `DOCKO_RUNTIME`, and `DOCKO_ROOT` to
it, so a bare `docko` call from a Bash tool call resolves the right session. Only keys matching
`^[A-Z][A-Z0-9_]*$` with single-line values are written. On hosts without an env file, the CLI
falls back to `CLAUDE_CODE_SESSION_ID`, which Claude Code exports into every tool call.

`SessionEnd` ends the session named in the hook payload and releases every claim it holds. It emits
no hook output.

`PreToolUse` is the only event with a matcher, and the matcher is `Edit|Write`. The launcher passes
Claude's session id as `--session`; if that call fails it retries once with the CLI's own session
resolution. A denied write is returned as `permissionDecision: "deny"` with a reason the agent can
act on. An allowed write emits nothing: docko vetoes unauthorized slot writes and never widens your
normal permission flow. A payload carrying no file path is allowed with the reason `no-file-path`.

`SubagentStart` starts a delegated child session, copies the parent's delegations onto it, and
exports `DOCKO_SESSION_ID`, `DOCKO_PARENT_SESSION_ID`, and `DOCKO_RUNTIME`. Subagents started with
the Agent tool share the parent session id and need no delegation. A separately launched `claude`
process needs an explicit one. See [Delegate a slot to a teammate](delegation.md).

The plugin bundle registers each hook against `${CLAUDE_PLUGIN_ROOT}`. The repo-local install
writes an absolute launcher path into `.claude/settings.local.json` and `$CLAUDE_PROJECT_DIR` into
the committed `.claude/settings.docko.json`, so hooks resolve from any working directory and any
shell. `docko adapter claude-code settings` prints the same fragment, and a copy of it is in
[Claude Code hook settings](../examples/claude-code-settings.json).

When the launcher or the CLI fails, the launcher writes a warning to stderr and exits 0. Hooks are
an operational control, not a security boundary.

## The dock commands

Five slash commands ship with both install paths. Each one passes
`--session "$DOCKO_SESSION_ID"`, and none passes `--root`: docko walks up from the current
directory to the workspace root, so they work from inside a slot.

| Command | What it runs | When to use it |
| --- | --- | --- |
| `/dock-status` | `docko status --brief` | Before claiming anything, to read free and claimed slots. |
| `/dock-claim <slot> <branch> <task...>` | `docko claim --resource slot --id <slot>` | When you already know the exact slot. |
| `/dock-heartbeat <slot>` | `docko heartbeat --resource slot --id <slot>` | When `summary.stale_candidates` lists your claim. |
| `/dock-release <slot>` | `docko release --resource slot --id <slot>` | When work in the slot is finished. |
| `/dock-doctor` | `docko adapter claude-code doctor` | When hooks misbehave in a repo-local install. |

## How Claude should use docko

1. Run `/dock-status` once. Do not inspect slot directories one by one.
2. Let docko pick the slot with
   `docko slot acquire --session "$DOCKO_SESSION_ID" --branch <branch> --task "<task>" --brief`.
   Selection is round-robin, starting after the last slot claimed for that application.
3. Add `--application <id>` in a workspace with more than one
   [application slot pool](applications.md), and `--prefer <slot-id>` when one slot is the right
   one.
4. Use `/dock-claim` only when you already know the exact slot.
5. Do the work inside the claimed slot. Files outside `slots/` are never denied.
6. Release with `/dock-release <slot>`.

Never invent a session id. `PreToolUse` checks the runtime's own session, so a made-up id claims a
slot that then blocks the session's own writes. Take the id from `$DOCKO_SESSION_ID` or from
`docko session list --brief`.

On `AMBIGUOUS_SESSION`, run the `suggested_command` from the error payload, or retry with an
explicit `--session <session-id>`. Do not end existing sessions unless the user asked for cleanup.
Every other code is listed in [Errors](errors.md).

If `docko` is not runnable, check `DOCKO_BIN`, then stop and tell the user. Do not fall back to
reading `docko/registry.json` and editing a free-looking slot.

## When a write is denied

Every deny names the slot, the reason, and one command that fixes it.

| Reason | What happened | Recovery command it prints |
| --- | --- | --- |
| `slot-not-claimed` | The slot is free, and the message names its previous owner when docko knows it. | `docko slot acquire --prefer <slot-id> --branch <branch> --task "<task>" --brief` |
| `claim-expired` | Your own claim lapsed, with the expiry time and the length of the quiet window. | `docko claim --resource slot --id <slot-id> --branch <branch> --task "<task>"` |
| `unrelated-session` | Another session owns the slot, with its task, branch, and whether it is still active. | `docko release --resource slot --id <slot-id> --force` |

Two more cases render their own message. A write into a `slots/` directory whose name is not a
valid docko id is denied with the directory name and the instruction to rename it. Such a directory
is never registered as a slot, so no claim can ever cover it.

When the acting session is not registered with docko, the write is evaluated as a session that owns
nothing, and the message appends a `docko session start --session <session-id> --runtime
claude-code` line. That case means the `SessionStart` hook did not run.

> **Warning:** `--force` takes a live claim from another session. Use it only when the user asked
> for a takeover, and prefer asking the owner session to release or delegate the slot.

## Diagnose a broken install

`/dock-doctor` runs `docko adapter claude-code doctor` against a repo-local install:

```bash
docko adapter claude-code doctor --root ./workspace
```

The report covers five things:

- `launcher`: whether the installed hook launcher exists and matches the shipped version.
- `plugin_manifest`: whether the generated `plugin.json` version matches the installed docko.
- `settings_files`: docko hook registrations in `.claude/settings.json` and
  `.claude/settings.local.json`, including duplicates and entries pointing at a missing launcher.
- `docko_binary`: whether `docko` resolves from `PATH` or `DOCKO_BIN`, or falls back to `npx`.
- `session`: the session id this shell exports.

`ok` is `true` when `issues` is empty. Version drift on the launcher or the manifest is repaired by
re-running `docko adapter claude-code install`, not by `--fix`.

Add `--fix` when the report lists fixable issues:

```bash
docko adapter claude-code doctor --root ./workspace --fix
```

`--fix` removes hook entries pointing at a launcher that is missing or out of date, and collapses
duplicate registrations down to the first healthy one per event and matcher. Two registrations for
one event with different matchers are two deliberate hooks, and both survive. Entries the plugin
owns, which point at `${CLAUDE_PLUGIN_ROOT}`, are never touched. The diagnosis then re-runs, so
`issues` and `ok` describe the state after the fix.

## Next steps

- [Delegate a slot to a teammate](delegation.md): give a separately launched agent write access.
- [Application slot pools](applications.md): give backend and frontend their own slots.
- [CLI reference](cli-reference.md): every command and option the hooks and slash commands wrap.
- [Troubleshooting](troubleshooting.md): symptom-first fixes for denied writes and session errors.

## Related

- [Concepts](concepts.md): workspace root, slot, session, claim, delegation.
- [Adapter specification](adapter-spec.md): the contract this adapter implements.
- [Codex and other AGENTS.md runtimes](agents-md-runtimes.md): guidance-based setup without hooks.
- [Claude Code hook settings](../examples/claude-code-settings.json): the repo-local fragment.
