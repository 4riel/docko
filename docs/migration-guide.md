# Migration Guide

## From Ad-Hoc Slot Scripts

Replace handwritten lock files and shell conventions with the protocol's explicit state split.

Recommended migration:

1. Create or adopt one workspace root with `slots/` for writable clones.
2. Initialize `docko` so it creates `docko/registry.json`, `docko/registry.md`, `docko/sessions/`, and `docko/logs/`.
3. Move resource ownership into `docko claim`, `docko heartbeat`, `docko release`, and `docko delegate`.
4. Treat `docko/registry.json` as the canonical resource state instead of per-slot marker files.
5. Treat `docko/sessions/*.json` as the canonical session state instead of inferred process naming or terminal tabs.
6. Stop editing any human lock summary by hand; let `docko/registry.md` be generated output.

## From Manual Session Naming Conventions

If the old workflow inferred identity from shell prompts, tmux panes, or runtime-specific metadata, migrate to explicit session manifests.

Recommended migration:

1. Start sessions with `docko session start`.
2. Pass the returned session ID through the runtime environment or explicit `--session`.
3. Use `docko session current` and `docko session list` instead of guessing who is active.
4. End sessions with `docko session end` when possible and let stale recovery handle crashes.

## From Worktree-First Workflows

`docko` does not replace worktrees universally. Migrate only when you want persistent workspace slots and explicit multi-agent coordination.

Recommended migration:

1. Keep using worktrees if cheap branch checkouts are the only problem you need to solve.
2. Adopt `docko` when you want stable writable clones, warm caches, long-lived local services, or explicit slot ownership.
3. Create a small number of long-lived slots under `workspace/slots/`.
4. Move coordination material to the workspace root only when it actually helps the workflow.

## From Runtime-Specific Lock Logic

If the current workflow encodes ownership only in one runtime's hooks or prompt rules, split the concerns cleanly.

Recommended migration:

1. Move claim and release semantics into the runtime-neutral core and CLI.
2. Keep runtime hooks as adapter glue that starts sessions, requests write authorization, and automates delegation.
3. Preserve runtime-specific metadata only in session `metadata` or optional claim fields such as `runtime`, `branch`, and `task`.
4. Do not let adapter-specific rules become a second source of truth for ownership.

## Migrating Existing Resources

Map old resource concepts into the protocol deliberately:

- persistent writable clones become `slot` resources
- shared staging or dev environments become `shared-env` resources
- anything else becomes a custom resource type registered with `docko resource ensure`

If an existing resource has a meaningful path, store it in the resource record.
If it is logical rather than filesystem-backed, `path` may be `null`.

## Migrating Delegated Team Workflows

Leader/teammate workflows should migrate from implied inheritance to explicit records.

Recommended migration:

1. Start the leader as a normal session.
2. Claim the resource under the leader session.
3. Start child sessions explicitly.
4. Delegate the claimed resource to those child sessions.
5. Treat delegation as resource-scoped write authority, not ownership transfer.

This keeps the registry inspectable and makes child access disappear automatically when the parent claim ends.

## Migrating Stale-Recovery Policy

When moving from handwritten cleanup scripts, set stale policy intentionally instead of relying on habit.

Recommended migration:

1. Decide whether slot claims should use the default 1 hour timeout or a workspace-specific override.
2. Configure the slot default during `docko init --slot-stale-after-ms <n>` if needed.
3. Override per-claim stale timeouts only when a task truly needs it.
4. Let session manifests drive freshness instead of inventing a second heartbeat file.

## Common Corrections During Migration

- Do not store sessions inside `registry.json`; they belong in `docko/sessions/`.
- Do not treat `registry.md` as the source of truth.
- Do not grant child write access by parent naming convention alone; record delegation explicitly.
- Do not mutate the path of a claimed non-slot resource.
- Do not bypass the CLI by editing `registry.json` manually unless you are doing explicit recovery work and understand the consequences.
