# Development

Set up the repository, verify a change, and know which surface owns what. Read this before you open
a pull request.

## Prerequisites

- Node 22 or newer, pinned in `.node-version`.
- pnpm 10 or newer, enabled through `corepack enable`.

## Set up the repo

Run these from the repository root:

```bash
corepack enable
pnpm install
```

## Verify a change

```bash
pnpm build
pnpm check
pnpm test
pnpm test:coverage
```

- `pnpm build` builds every package with `scripts/build-workspace.mjs`.
- `pnpm check` builds, then runs the TypeScript check for every package.
- `pnpm test` and `pnpm test:coverage` both rebuild first, then run the Node test runner
  sequentially (`--test-concurrency=1`) to avoid CLI child-process contention.
- Tests run against built `dist/` output, not the TypeScript source. Always build before you test.
- `pnpm test:coverage` gathers coverage from built output. See [Tests](tests.md) for what coverage
  measures.

> **Note:** `pnpm release:verify` runs the full check plus the publish staging and manifest checks.
> `pnpm publish:alpha:dry-run` adds a dry-run `npm publish`. Use these before a release, not for a
> routine change.

## Ownership boundaries

| Surface | Owns | Must not |
| --- | --- | --- |
| `packages/core` | Claims, delegation, stale recovery, session resolution, authorization, and registry persistence. | Let any other surface redefine these semantics. |
| `packages/cli` | Argument parsing, command routing, JSON output, and interactive onboarding. | Change who owns a claim or when a delegation is valid. |
| `packages/adapters/*` | Runtime-specific hooks, templates, and settings. | Bypass core validation, persist parallel lock state, or redefine stale semantics. |
| `schemas/` | Canonical shapes for `registry.json` and session manifests. | Drift from `packages/core/src/types.ts`. |
| `docs/` | Product documentation: guides, concepts, and reference pages. | Restate a protocol rule instead of linking `docs/protocol.md`. |
| `tests/` | Unit, service, end-to-end, CLI, and adapter coverage. | Skip a suite update when the surface it covers changes behavior. |

## Read order before editing

1. `README.md`
2. `AGENTS.md` or `CLAUDE.md`, the repo instructions for your runtime.
3. `docs/INDEX.md`
4. `docs/repo-structure.md`
5. The skill and docs for the surface you are changing.

## Documentation rules

- `docs/protocol.md` and `schemas/` are authoritative for state shapes and semantics. A guide or
  reference page links to them rather than restating a rule.
- Command examples stay shell-neutral: no `&&` chains, no `$(...)`, no `export VAR=`, no `%VAR%`.
- Do not document a flag, field, or recovery flow that does not exist in
  `packages/cli/src/index.ts` or `packages/core/src`.
- When a CLI command or its output changes, update `docs/cli-reference.md` and every affected guide
  in the same change.
- When a registry or session shape changes, update `schemas/`, `packages/core/src/types.ts`, docs,
  and tests together.
- Keep implemented behavior separate from roadmap material. Track future work in GitHub milestones,
  not in a docs page.

## Working in parallel

Splitting a change by role keeps each edit inside its owning surface, even when two or more
sessions work the same task at once. A repo-wide change often splits across four roles, each backed
by a skill in `.agents/skills/`:

- Repo cartographer (`docko-repo`): maps ownership boundaries and the verification surface for a
  task.
- Protocol steward (`docko-protocol`): owns registry, session, claim, delegation, schema, and CLI
  contract work.
- Adapter builder (`docko-adapters`): owns runtime adapter code, templates, and runtime docs.
- Docs maintainer (`docko-docs`): owns README, docs, and examples.

Split a documentation refresh across the cartographer and the docs maintainer. Split a protocol
change across the steward and the docs maintainer, with the cartographer confirming the edit stayed
inside its owning surface. Verify every split with the commands in
[Verify a change](#verify-a-change) before you call the work done.

## Related

- [Contributing](../CONTRIBUTING.md)
- [Repository structure](repo-structure.md)
- [Architecture](architecture.md)
- [Tests](tests.md)
