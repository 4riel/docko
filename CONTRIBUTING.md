# Contributing to docko

This page covers the contribution policy for `docko-workspace`: how to propose, format, and land a
change. For local setup detail and the full ownership rules, read
[Development](docs/development.md) and the [documentation index](docs/INDEX.md).

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Read [Development](docs/development.md) for the read order and the ownership boundaries in full.
- Confirm the change fits inside one owning surface: `packages/core`, `packages/cli`,
  `packages/adapters/*`, `schemas/`, `docs/`, or `tests/`.
- Open an issue first for anything larger than a small fix, so the approach has agreement before you
  write code.

## Local setup

Run these from the repository root:

```bash
corepack enable
pnpm install
pnpm build
pnpm check
pnpm test
```

These commands are shell-neutral and work in PowerShell, `cmd.exe`, and POSIX shells. Tests run
against the built `dist/` output, not the TypeScript source, so always build before you test.
[Development](docs/development.md) covers what each command verifies and how to run a narrower
slice.

## Ownership boundaries

Keep a change inside the narrowest owning surface:

- `packages/core` owns all protocol semantics: claims, delegation, stale recovery, session
  resolution, authorization, and registry persistence. Nothing else may redefine these.
- `packages/cli` owns argument parsing, command routing, JSON output, and interactive onboarding. It
  must not change who owns a claim or when a delegation is valid.
- `packages/adapters/*` own runtime-specific hooks, templates, and settings. They stay thin and must
  not bypass core validation, persist parallel lock state, or redefine stale semantics.
- `schemas/` are canonical. When a registry or session shape changes, update schemas, core, docs,
  and tests together.

Treat `docko/registry.json` as canonical and `docko/registry.md` as generated output. When CLI
behavior changes, update `docs/cli-reference.md` and any affected guide in the same change. Do not
document a flag, output, or flow that is not implemented.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Format the subject
as `type(scope): summary`:

```text
feat(cli): add --id-only flag to session current
fix(core): preserve claimed slots missing from disk
docs: clarify stale recovery in protocol.md
```

## Pull request flow

1. Branch from `main`.
2. Make the change inside the narrowest owning surface.
3. Verify locally: `pnpm check` and `pnpm test` must pass.
4. Update docs, schemas, and tests together when registry, session, or CLI shapes change.
5. Open a pull request against `main` and fill out the PR template.
6. Continuous integration must pass before a maintainer merges the PR. GitHub Actions runs `ci.yml`
   and `codeql.yml` on every pull request.

The PR template's test-plan checklist mirrors the rules in this page: verification commands, the
narrowest-owning-surface rule, docs kept in sync, and no unimplemented behavior documented.

## Reporting issues

Use the issue templates for bug reports and feature requests. For a security vulnerability, follow
the [Security policy](SECURITY.md) and report it privately instead of opening a public issue.
Every issue and pull request routes to the maintainer listed in `.github/CODEOWNERS`.
