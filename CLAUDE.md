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
packages/adapters/claude-code/  Claude Code runtime adapter: templates, hooks, installer
schemas/             Canonical JSON Schema for registry.json and session.json
tests/               Unit, service, e2e, CLI, and adapter tests (Node test runner)
docs/                Public documentation (21 files, see docs/INDEX.md)
bin/                 Entry point (docko.js)
scripts/             Build, test, and publish orchestration
.agents/skills/      Repo-local skills for Codex and agent runtimes
examples/            Copy-pastable examples for adopters
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

The only implemented runtime adapter. Installed via `docko init --claude` or `docko adapter claude-code install`.

Writes:
- `.claude-plugin/docko/` (plugin manifest, hooks, scripts)
- `.claude/commands/dock-*.md` (4 commands)
- `.claude/skills/workspace-orchestration/SKILL.md`
- `.claude/snippets/CLAUDE.docko.md` and `AGENTS.docko.md`
- `.claude/settings.docko.json` and `.claude/settings.local.json`

Four hooks: SessionStart, SessionEnd, PreToolUse (Edit|Write), SubagentStart.

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
