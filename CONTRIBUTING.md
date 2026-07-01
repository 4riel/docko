# Contributing to docko

Thanks for your interest in `docko-workspace`. This is the quick-start guide.
For the full setup, read order, and change expectations, see
[`docs/contributing.md`](docs/contributing.md) and the documentation map in
[`docs/INDEX.md`](docs/INDEX.md).

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- Node 22 or newer
- pnpm 10 or newer (enable via `corepack enable`)

The recommended Node version is pinned in `.node-version` (and `.nvmrc`).

## Local Setup

Run from the repository root:

```
corepack enable
pnpm install
pnpm build
pnpm check
pnpm test
```

These commands are shell-neutral and work in PowerShell, `cmd.exe`, and POSIX
shells.

- `pnpm build` builds all packages.
- `pnpm check` runs the build plus TypeScript checks across every package.
- `pnpm test` and `pnpm test:coverage` both rebuild first.

Tests run against the built `dist/` output, not the TypeScript source, so always
build before testing. They run sequentially to avoid CLI child-process
contention.

## Ownership Boundaries

Keep changes inside the narrowest owning surface:

- `packages/core` owns all protocol semantics: claims, delegation, stale
  recovery, session resolution, authorization, and registry persistence.
  Nothing else may redefine these.
- `packages/cli` owns argument parsing, command routing, JSON output, and
  interactive onboarding. It must not change who owns a claim or when a
  delegation is valid.
- `packages/adapters/*` own runtime-specific hooks, templates, and settings.
  They stay thin and must not bypass core validation, persist parallel lock
  state, or redefine stale semantics.
- `schemas/` are canonical. When registry or session shapes change, update
  schemas, core, docs, and tests together.

Treat `docko/registry.json` as canonical and `docko/registry.md` as generated
output. When CLI behavior changes, update `docs/cli-reference.md` and any
affected README, examples, or adapter docs in the same change. Do not document
flags, outputs, or flows that are not implemented.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Format your subject as `type(scope): summary`, for example:

```
feat(cli): add --id-only flag to session current
fix(core): preserve claimed slots missing from disk
docs: clarify stale recovery in protocol.md
```

## Pull Request Flow

1. Branch from `main`.
2. Make your change inside the narrowest owning surface.
3. Verify locally: `pnpm check` and `pnpm test` must pass.
4. Update docs, schemas, and tests together when registry, session, or CLI
   shapes change.
5. Open a pull request against `main` and fill out the PR template.
6. Continuous integration must pass before a PR can be merged.

## Reporting Issues

Use the issue templates for bug reports and feature requests. For security
vulnerabilities, follow [SECURITY.md](SECURITY.md) and report privately rather
than opening a public issue.
