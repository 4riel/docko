# docko

## What This Is

`docko` is a local-first workspace and session protocol for AI coding agents. It coordinates writable slots, session ownership, delegation, and stale recovery for multi-agent work inside one persistent workspace root.

- Published as [`docko-workspace@alpha`](https://www.npmjs.com/package/docko-workspace) on npm
- CLI command: `docko`
- Node >= 22, pnpm 10+, ES modules throughout

## Repo Structure

```
packages/core/       Protocol semantics, registry/session persistence, claims, delegation, stale cleanup
packages/cli/        JSON CLI over DockoService (single index.ts with all commands)
packages/adapters/claude-code/  Claude Code runtime adapter: plugin bundle, templates, hooks, installer
schemas/             Canonical JSON Schema for registry.json and session.json
tests/               Unit, service, e2e, CLI, and adapter tests (Node test runner)
docs/                Public documentation (21 files, see docs/INDEX.md)
bin/                 Entry point (docko.js)
scripts/             Build, test, and publish orchestration
.agents/skills/      Repo-local skills for Codex and agent runtimes
examples/            Copy-pastable examples for adopters
.github/             CI, security scanning, issue/PR templates, ownership
.husky/              Commit and pre-commit hooks
CHANGELOG.md          Published release history
CONTRIBUTING.md       Repository-wide contribution policy
SECURITY.md           Vulnerability reporting and support policy
```

## Ownership Boundaries

- `packages/core` owns all protocol semantics: claims, delegation, stale recovery, session resolution, authorization, registry persistence. Nothing else may redefine these.
- `packages/cli` owns argument parsing, command routing, JSON output, and interactive onboarding. It must not change who owns a claim or when a delegation is valid.
- `packages/adapters/*` own runtime-specific hooks, templates, and settings. They must not bypass core validation, persist parallel lock state, or redefine stale semantics.
- `schemas/` are canonical. When registry or session shapes change, update schemas, core, docs, and tests together.

## Build And Verify

```bash
corepack enable
pnpm install
pnpm build          # builds all packages via scripts/build-workspace.mjs
pnpm check          # build + TypeScript check all packages
pnpm test           # build + sequential node tests (--test-concurrency=1)
pnpm test:coverage  # build + c8 coverage from dist/ outputs
```

Tests run against built `dist/` output, not source. Always build before testing.

## Key Patterns

### TypeScript

- Target ES2022, module NodeNext, strict mode
- Path aliases: `@docko/core`, `@docko/cli`, `@docko/adapter-claude-code`
- Each package has its own `tsconfig.json` extending `tsconfig.base.json`

### CLI

- Custom `--option value` parser (no external CLI library)
- Repeatable options via `--keyword value` collected as arrays
- Environment fallbacks: `DOCKO_ROOT`, `DOCKO_SESSION_ID`, `DOCKO_RUNTIME`, `DOCKO_BIN`
- Success JSON on stdout, error JSON on stderr with non-zero exit
- Exceptions: `init` in TTY prints human-readable; `session current --id-only` prints plain text

### Protocol

- `docko/registry.json` is canonical machine state
- `docko/registry.md` is generated mirror (never manually edited, never authoritative)
- `docko/sessions/*.json` are per-session manifests (not inlined in registry)
- `docko/.registry.lock/` is a directory-based filesystem lock (mkdir atomic)
- All registry-backed operations acquire the lock, re-discover slots, run stale cleanup, then execute

### Persistence

- Atomic writes via write-to-temp-then-rename
- Slot discovery runs on every registry mutation path
- Free slots deleted from disk are dropped; claimed missing slots are preserved
- Stale recovery runs before every read/write operation

### Core Module Map

| Module | Role |
|---|---|
| `service.ts` | Orchestration layer wiring all services |
| `registry-scribe.ts` | Registry persistence, slot discovery, registry.md generation |
| `session-sherpa.ts` | Session manifest lifecycle |
| `stale-janitor.ts` | Pure in-memory stale evaluation |
| `lock-bouncer.ts` | Ownership and authorization checks |
| `mutation-gate.ts` | Filesystem lock serialization |
| `resource-catalog.ts` | Resource onboarding and defaults |
| `mirror-smith.ts` | Human-readable registry.md rendering |
| `log-scribe.ts` | Debug event logging (best-effort) |
| `fs-utils.ts` | File I/O helpers |
| `errors.ts` | DockoError class and error codes |
| `paths.ts` | Path calculation |
| `types.ts` | All TypeScript interfaces |

## Testing

- `tests/core.unit.test.mjs` - errors, fs helpers, session resolution, lock ownership, mutation-gate timeout
- `tests/core.services.test.mjs` - service orchestration, registry validation, stale recovery, resource-catalog defaults
- `tests/docko.e2e.test.mjs` - end-to-end CLI flows: init, claims, release, delegation, stale recovery, authorization
- `tests/cli.unit.test.mjs` - CLI parser, interactive init, prompt flows, payload fallbacks
- `tests/claude-code-adapter.test.mjs` - adapter settings, installer, settings merge, hook command execution
- `tests/claude-plugin.test.mjs` - distributable plugin bundle: manifests, marketplace, hooks shape, launcher protocol guards
- `tests/helpers/cli-test-helpers.mjs` - shared workspace and child-process helpers

Tests run sequentially to avoid CLI child-process contention. Coverage is gathered from built `dist/` outputs.

## Working Rules

- Keep the protocol small. Prefer explicit state transitions over convenience magic.
- Keep adapters thin. Runtime behavior in `packages/adapters/*`, not `packages/core`.
- Treat `registry.json` as authoritative and `registry.md` as generated output.
- When registry or session shapes change, update schemas, docs, and tests together.
- When CLI commands or behavior change, update `docs/cli-reference.md` and affected README/examples/adapter docs.
- Keep implemented behavior separate from roadmap material in docs and templates.
- Do not present Codex or non-Claude runtime support as first-class unless matching packages, templates, and tests exist.
- Keep command examples shell-neutral and copy-pastable.
- Do not document flags, outputs, or flows that are not implemented.

## Claude Code Adapter

The only implemented runtime adapter. Two install paths sharing the same assets:

1. **Claude Code plugin (distributable)**: `packages/adapters/claude-code/plugin/` is a committed, installable plugin bundle (`.claude-plugin/plugin.json`, `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` commands, `commands/`, `skills/`, `scripts/`). The repo-root `.claude-plugin/marketplace.json` makes this repo a plugin marketplace (`/plugin marketplace add 4riel/docko`, `/plugin install docko@docko`). The plugin dir is the canonical source for the hook launcher, dock-* commands, and the workspace-orchestration skill.
2. **Repo-local install**: `docko init --claude` or `docko adapter claude-code install` copies from the plugin bundle into the target project (`.claude-plugin/docko/`, `.claude/commands/`, `.claude/skills/`) plus snippets from `templates/project/` and generated settings (`.claude/settings.docko.json`, `.claude/settings.local.json`).

Four hooks: SessionStart, SessionEnd, PreToolUse (Edit|Write), SubagentStart. The hook launcher (`plugin/scripts/docko-claude-hook.mjs`) translates CLI JSON into the Claude Code hook protocol (`hookSpecificOutput`, `permissionDecision`), no-ops outside docko workspaces, passes Claude's `session_id` as `--session`, falls back to `npx docko-workspace@alpha` when `docko` is not on PATH, and fails open on errors.

The plugin manifest version must match the package versions — `scripts/bump-version.mjs` bumps it and `tests/claude-plugin.test.mjs` enforces it.

## Publishing

- Package name: `docko-workspace`, tag: `alpha`
- Publish from `.publish/npm/` staging directory
- Verification: `pnpm release:verify`
- Dry run: `pnpm publish:alpha:dry-run`

## Documentation

Read `docs/INDEX.md` for the full map. Key references:
- `docs/protocol.md` - full protocol spec
- `docs/architecture.md` - module boundaries and operation flow
- `docs/cli-reference.md` - all CLI commands and options
- `docs/claude-code.md` - Claude Code adapter details
- `docs/adapter-spec.md` - runtime adapter contract
- `docs/contributing.md` - setup and change expectations
- `docs/tests.md` - test plan and coverage inventory

<!-- docko:begin:claude -->
## docko Workspace Rules

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Start at the workspace root. `docko` walks up to it on its own, so commands also work from inside a slot.
2. Run `/dock-status` or `docko status --brief` once. Read the `summary` block: free/claimed counts, `my_claims`, `stale_candidates`.
3. Pass `--session "$DOCKO_SESSION_ID"` on every claim, heartbeat, and release. The SessionStart hook exports it.
4. Prefer `docko slot acquire --session "$DOCKO_SESSION_ID" --branch <branch> --task "<task>" --brief` when you want docko to choose the slot. Selection is round-robin, starting after the last slot claimed for that application.
5. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
6. Example:
   `docko slot acquire --session "$DOCKO_SESSION_ID" --application backend --branch <branch> --task "update backend auth" --brief`
7. Add `--prefer <slot-id>` when one specific slot is the right one. docko takes it when free and rotates normally when it is not.
8. If every slot is busy and docko asks whether it should create a fresh managed clone, answer explicitly.
9. Use `/dock-claim <slot> <branch> <task>` or `docko claim --session "$DOCKO_SESSION_ID" --resource slot --id <slot> --branch <branch> --task "<task>"` only when you already know the exact slot.
10. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko.
11. Release it with `/dock-release <slot>` or:
    `docko release --session "$DOCKO_SESSION_ID" --resource slot --id <slot>`

Rules:

- Work from the root. Edit code in `slots/*`, not at the root.
- Never invent a session id. The write hook checks the runtime's own session, so a made-up id claims a slot that then blocks your own writes. Use `$DOCKO_SESSION_ID`, or an id from `docko session list --brief`.
- `branch` is claim metadata. docko records it and never runs `git checkout`.
- Claims are slot-scoped. They do not reserve a branch, a PR, or individual files.
- Read the `applications` section from `docko status --brief` when the workspace has multiple app pools.
- If a parent session already owns the slot, reuse that authority. Do not open a second claim for the same slot.
- Subagents started with the Agent tool share the parent's session id and inherit its claim. A separately launched `claude` process needs `docko delegate`.
- If docko reports `AMBIGUOUS_SESSION`, run the `suggested_command` from the error payload; do not end existing sessions unless the user asked for cleanup.
- If a write is blocked, read the deny message: it names the slot, the reason, and the command that fixes it.
- If every slot is busy and the user already approved the fallback, re-run `docko slot acquire` with `--clone-when-busy`.
- If `docko` is not runnable, check `DOCKO_BIN`. If it still fails, stop and tell the user. `/dock-doctor` reports launcher, hook, and binary problems.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback. Use `docko status --brief --claimed`. Only read the registry when the user asked to debug docko itself.
<!-- docko:end:claude -->
