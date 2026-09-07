# Tests

This page lists the test suites under `tests/`, what each one covers, and how to run the gate before
you open a pull request.

## Run the gate

```bash
pnpm build
pnpm check
pnpm test
pnpm test:coverage
```

All tests execute against built `dist/` output. `scripts/run-node-tests.mjs` runs every file under
`tests/` that matches `*.test.mjs`, retrying a failed file once before it fails the gate. Tests run
sequentially (`--test-concurrency=1`) to avoid CLI child-process contention.

> **Tip:** After `pnpm build`, run one suite directly with `node --test tests/<file>` when you only
> need a faster signal on the surface you changed.

## Suites

| File | Surface | What it covers |
| --- | --- | --- |
| `tests/core.unit.test.mjs` | `packages/core` | Errors, filesystem helpers, session resolution, lock ownership, mutation-gate timeout, clock-skew and refresh behavior, `REGISTRY_LOCK_LOST`, slot containment, ignored slot directories, the claim heartbeat throttle, and the ended-manifest touch no-op. |
| `tests/core.services.test.mjs` | `packages/core` | Registry validation, stale recovery, logs, mirror rendering, resource-catalog defaults, stale-lock quarantine under contention, and the uncapped `session prune` drain. |
| `tests/core.persistence.test.mjs` | `packages/core` | Atomic-write retries, ended-manifest relocation and retention, temp-artifact sweeping on the read path, authorization for undiscovered slot directories, and short-stale-window heartbeats. |
| `tests/cli.unit.test.mjs` | `packages/cli` | The CLI parser and interactive `init`, including repeated flags, prompt flows, payload fallbacks, and install edge cases. |
| `tests/docko.e2e.test.mjs` | `packages/cli` and `packages/core` | End-to-end CLI flows: init, claims, release, delegation, stale recovery, logs, authorization, `resource ensure` without `--path`, ignored slot directories, the hook payload session id, and the `--dest` guard. |
| `tests/claude-code-adapter.test.mjs` | `packages/adapters/claude-code` | Adapter settings, installer behavior, settings merge, doctor diagnostics, and real hook command execution. |
| `tests/claude-plugin.test.mjs` | `packages/adapters/claude-code` plugin bundle | Manifests, the marketplace entry, hook shapes and timeouts, the launcher version header, the repo's own dogfood copies, the `CLAUDE_ENV_FILE` export, per-reason deny messages, and shipped command and skill guidance. |

### Notes

`tests/helpers/cli-test-helpers.mjs` holds the shared child-process and workspace helpers every suite
above uses. It strips ambient `DOCKO_SESSION_ID`, `CLAUDE_CODE_SESSION_ID`, and `DOCKO_ROOT` so a
suite run inside an agent session cannot inherit that session.

## Coverage

- `pnpm test:coverage` gathers c8 coverage from `packages/*/dist/*.js`, so the numbers reflect the
  shipped CLI, core, and adapter surfaces, not test-only source paths.
- Package-install coverage runs from fresh temp directories outside the monorepo so npm does not
  inherit parent workspace context during tarball validation.

## What to add with a change

- Add or extend a case in the suite that owns the surface you changed.
- When a registry or session field changes, extend the core suite that covers it.
- When a CLI flag or payload shape changes, extend `tests/cli.unit.test.mjs` or
  `tests/docko.e2e.test.mjs`.
- When an adapter-installed file changes, extend `tests/claude-code-adapter.test.mjs` and
  `tests/claude-plugin.test.mjs` together. The plugin bundle and the repo-local install must stay in
  sync.
- When a new test file is added, `scripts/run-node-tests.mjs` picks it up automatically. Name it
  `<surface>.test.mjs` so it sorts next to the suite it extends.

## Related

- [Development](development.md)
- [Architecture](architecture.md)
