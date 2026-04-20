# Tests

Run the full suite:

```bash
pnpm test
```

Run the full verification gate when you need final-integration confidence:

```bash
pnpm build
pnpm check
pnpm test
pnpm test:coverage
```

All test entrypoints exercise built `dist/` output. The package scripts rebuild automatically; direct `node --test` runs should only be used when you have already built the packages you care about.

## Test Files

| File | Layer | Coverage |
|---|---|---|
| `core.unit.test.mjs` | Unit | Error handling, filesystem helpers, session resolution, lock ownership, mutation gate timeout |
| `core.services.test.mjs` | Unit | Service orchestration, registry validation, stale recovery, adapter-facing edge paths, additional mutation gate recovery |
| `docko.e2e.test.mjs` | E2E / CLI | Init, status, claim, heartbeat, release, delegation, stale recovery, concurrent claims, authorization |
| `cli.unit.test.mjs` | Unit / CLI | Help/version flows, init modes and repeatable slot flags, stdin parsing branches, render/session command edge cases |
| `claude-code-adapter.test.mjs` | Adapter | Hook settings generation, cross-platform commands, adapter install, settings merge, end-to-end hook flows |

The shared helper at `tests/helpers/cli-test-helpers.mjs` centralizes workspace setup and child-process execution so the CLI, adapter, and coverage-focused tests all exercise the built artifacts the same way.

Tests run sequentially (`--test-concurrency=1`) because the e2e tests spawn CLI child processes that contend under parallel execution.

Coverage is collected from built outputs under `packages/core/dist`, `packages/cli/dist`, and `packages/adapters/claude-code/dist`, which keeps the reported numbers tied to the shipped runtime surfaces.

See [`docs/tests.md`](../docs/tests.md) for the full test plan, case inventory, and docs-sync expectations.
