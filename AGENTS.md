# docko Repo Instructions

## Mission

- Keep `docko` a small, local-first, workspace-centric protocol and reference implementation for AI coding agents.
- Preserve the split between `packages/core`, `packages/cli`, `packages/adapters/*`, `schemas/`, `docs/`, and `tests/`.
- Prefer explicit ownership, explicit state transitions, and thin runtime adapters over convenience magic.

## Start Here

1. Read `README.md` for the product framing and the public workflow.
2. Read `docs/INDEX.md` for the documentation map.
3. Read the task-specific sources before editing:
   - Protocol, schemas, and CLI contract: `docs/protocol.md`, `docs/architecture.md`, `docs/cli-reference.md`, `docs/tests.md`
   - Runtime adapters: `docs/adapter-spec.md`, `docs/claude-code.md`
   - Documentation and examples: `docs/docs-sync.md`, `docs/public-copy.md`, `docs/public-positioning.md`

## Repo Map

```
packages/core/                  Protocol semantics, persistence, claims, delegation, authorization, stale cleanup
  src/service.ts                Orchestration layer wiring all services
  src/registry-scribe.ts        Registry.json persistence, slot discovery, registry.md generation
  src/session-sherpa.ts         Session manifest lifecycle (docko/sessions/*.json)
  src/stale-janitor.ts          Pure in-memory stale-claim evaluation
  src/lock-bouncer.ts           Ownership and authorization checks
  src/mutation-gate.ts          Filesystem lock serialization (docko/.registry.lock/)
  src/resource-catalog.ts       Resource onboarding and default stale policy
  src/mirror-smith.ts           Human-readable registry.md rendering
  src/log-scribe.ts             Debug event logging (docko/logs/*.jsonl)
  src/fs-utils.ts               Atomic writes, directory creation, JSON parsing
  src/errors.ts                 DockoError class and error codes
  src/types.ts                  All TypeScript interfaces
  src/paths.ts                  Path calculation for registry, sessions, logs, locks
  src/constants.ts              Schema version constant

packages/cli/                   Thin JSON CLI over DockoService
  src/index.ts                  All commands: init, app ensure, slot acquire/duplicate, status,
                                logs, claim, heartbeat, release, delegate, resource ensure,
                                render, session start/current/end/list,
                                adapter claude-code session-start/session-end/pre-tool-use/subagent-start

packages/adapters/claude-code/  Claude Code runtime adapter (only implemented adapter)
  src/index.ts                  Installer, settings generator, template copier
  templates/plugin/             Plugin manifest, hook launcher script, hooks.json
  templates/project/            Claude commands, skills, snippets for adopter workspaces

schemas/                        Canonical JSON Schema for registry.json and session.json
tests/                          Unit, service, e2e, CLI, and adapter tests (Node test runner)
docs/                           Public documentation (21 files)
bin/docko.js                    CLI entry point
scripts/                        Build, test, and publish orchestration
.agents/skills/                 Repo-local skills for Codex and agent runtimes
examples/                       Copy-pastable examples for adopters
```

## Ownership Boundaries

- `packages/core` owns all protocol semantics: claims, delegation, stale recovery, session resolution, authorization, registry persistence. Nothing else may redefine these.
- `packages/cli` owns argument parsing, command routing, JSON output shaping, and interactive onboarding. It must not change who owns a claim or when a delegation is valid.
- `packages/adapters/*` own runtime-specific hooks, templates, and settings. They must not bypass core validation, persist parallel lock state, or redefine stale semantics.
- `schemas/` define canonical on-disk shapes. When registry or session shapes change, update schemas, core, docs, and tests together.

## Working Rules

- Keep changes inside the narrowest owning surface.
- Keep protocol semantics runtime-agnostic. Adapters may enrich metadata, but they may not change claim or delegation rules.
- Treat `registry.json` as authoritative and `registry.md` as generated output.
- When registry or session shapes change, update schemas, docs, and tests together.
- When CLI commands or behavior change, update `docs/cli-reference.md` and any affected README, examples, or adapter docs.
- When editing docs or templates, keep implemented behavior separate from roadmap material.
- Do not present Codex or non-Claude runtime support as first-class implementation unless matching packages, templates, and tests exist.
- Keep command examples shell-neutral and copy-pastable across PowerShell, cmd.exe, and POSIX shells.
- Do not document flags, outputs, or recovery flows that are not implemented.

## Technical Context

- Node >= 22, pnpm 10+, ES modules (`"type": "module"`)
- TypeScript 6.0+, target ES2022, module NodeNext, strict mode
- No external CLI library; custom `--option value` parser with repeatable flags
- Environment fallbacks: `DOCKO_ROOT`, `DOCKO_SESSION_ID`, `DOCKO_RUNTIME`, `DOCKO_BIN`
- CLI output: success JSON on stdout, error JSON on stderr with non-zero exit
- Tests run against built `dist/` output, not source files
- Sequential test execution (`--test-concurrency=1`) to avoid CLI child-process contention

## Verification

```bash
pnpm install
pnpm build
pnpm check
pnpm test
pnpm test:coverage
```

Tests rely on built `dist/` output. If `pnpm` is unavailable in the environment, call that out explicitly.

Selective verification by area:
- Core protocol: `tests/core.unit.test.mjs`, `tests/core.services.test.mjs`
- CLI: `tests/cli.unit.test.mjs`
- E2E flows: `tests/docko.e2e.test.mjs`
- Claude adapter: `tests/claude-code-adapter.test.mjs`

## Repo Skills

- Use `docko-repo` for repo navigation, commands, and ownership boundaries.
- Use `docko-protocol` for core, schemas, registry/session semantics, and CLI contract work.
- Use `docko-adapters` for runtime adapters, templates, hook flows, and integration docs.
- Use `docko-docs` for README, docs, examples, and sync work.

Skills live in `.agents/skills/` with `SKILL.md` definitions and optional `agents/openai.yaml` for Codex.

## Protocol Quick Reference

### Key Concepts

- **Workspace**: one stable root with `slots/` and `docko/` directories
- **Slots**: writable directories under `slots/` (flat like `slots/main/` or app-scoped like `slots/backend/main_1/`)
- **Registry**: `docko/registry.json` tracks workspace metadata, applications, resources, claims, delegations
- **Sessions**: `docko/sessions/*.json` track per-session identity and freshness
- **Claims**: explicit ownership of a resource by exactly one session
- **Delegation**: explicit per-resource authority granted from owner to child session (scope: read or write)
- **Stale recovery**: runs before every registry-backed operation; clears claims older than their threshold

### Operation Flow

Every registry-backed operation (status, claim, release, delegate, heartbeat, render, authorization):
1. Acquire filesystem lock (`docko/.registry.lock/`)
2. Load or initialize registry
3. Re-discover slot resources from `slots/`
4. Load session manifests
5. Run stale cleanup in memory
6. Execute operation logic
7. Write updated registry and regenerate `registry.md`
8. Release lock

### Error Codes

Exit codes: 0 (success), 1 (usage/input), 2 (ownership conflict), 3 (ambiguous session), 4 (missing session), 5 (corrupted registry).

Key error codes: `USAGE_ERROR`, `INVALID_ID`, `NO_ACTIVE_SESSION`, `AMBIGUOUS_SESSION`, `SESSION_NOT_FOUND`, `SESSION_ID_CONFLICT`, `RESOURCE_NOT_FOUND`, `RESOURCE_NOT_CLAIMED`, `RESOURCE_ALREADY_CLAIMED`, `RESOURCE_OWNED_BY_OTHER_SESSION`, `CORRUPTED_REGISTRY`.

## Codex And OpenAI Guidance

- For Codex, `AGENTS.md`, skills, or OpenAI integration guidance, verify against official OpenAI documentation.
- Prefer the OpenAI Docs MCP server when it is available.
- If browsing is required, restrict sources to `developers.openai.com` or `platform.openai.com`.
- Codex officially supports `AGENTS.md`, skills, and explicit subagent workflows.
- Codex hooks are documented by OpenAI, including Windows-specific command and managed-directory fields.
- This repo does not ship a Docko Codex adapter package, templates, or tests. Treat Codex support here as instruction-driven `docko` CLI usage, not a first-class adapter.

<!-- docko:begin:codex -->
## docko Working Default

This repo uses `docko` for writable workspace coordination.

Quick path:

1. Work from the workspace root.
2. Run `docko status --root . --brief` once.
3. Use `docko slot acquire --root . --session <session-id> --branch <branch> --task "<task>" --brief` before writing.
4. If the workspace defines applications such as `backend` or `frontend`, pass `--application <id>` explicitly.
5. Example:
   `docko slot acquire --root . --session <session-id> --application backend --branch <branch> --task "update backend auth" --brief`
6. If docko asks whether it should create a fresh managed clone because all slots are busy, answer explicitly.
7. Do code work inside that claimed slot. Root-level files outside managed slots are not blocked by Docko.
8. Release it when done:
   `docko release --root . --session <session-id> --resource slot --id <slot>`

Rules:

- Work from the root. Do code work inside `slots/*`.
- Reuse `DOCKO_SESSION_ID` when a runtime already set it. Otherwise choose a unique session ID for the run.
- Read the `applications` section from `docko status --root . --brief` when the workspace has multiple app pools.
- If docko reports `AMBIGUOUS_SESSION`, retry with an explicit `--session <id>` from `docko session list --root . --brief`; do not end existing sessions unless the user asked for cleanup.
- If every slot is busy and the user already approved the fallback, add `--clone-when-busy` to `docko slot acquire`.
- If `docko` is not on PATH, try `DOCKO_BIN`. If it still is not runnable, stop and tell the user.
- Do not inspect slots one by one or use `docko/registry.json` as a normal fallback.
- Delegated Claude teammates inherit parent slot authority when the parent already owns the slot.
- Do not assume Codex subagents inherit Docko session or slot authority automatically. Docko does not ship a Codex adapter yet.
<!-- docko:end:codex -->
