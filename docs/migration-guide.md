# Migrate an existing workflow

This guide moves an existing coordination workflow onto `docko` without carrying its old habits
over. It covers four common starting points and how to map their concepts onto docko's.

## From ad hoc lock files

Handwritten lock files and shell conventions get replaced by docko's explicit state split.

1. Create or adopt one workspace root with `slots/` for writable clones:
   `docko init --root ./workspace`.
2. Move resource ownership into `docko claim`, `docko heartbeat`, `docko release`, and
   `docko delegate` instead of writing marker files by hand.
3. Treat `docko/registry.json` as the canonical resource state instead of per-slot marker files. See
   [state files](state-files.md) for its shape.
4. Stop editing any hand-maintained lock summary. `docko/registry.md` is generated output; it is
   never the source of truth.

## From session naming conventions

If the old workflow inferred identity from shell prompts, tmux panes, or a runtime's own process
naming, migrate to explicit session manifests.

1. Start sessions with `docko session start --root ./workspace --runtime <name>`.
2. Pass the returned `session_id` through the runtime environment (`DOCKO_SESSION_ID`) or an
   explicit `--session` on every later command.
3. Use `docko session current --root ./workspace` and `docko session list --root ./workspace`
   instead of guessing who is active from a terminal tab or a process name.
4. End sessions with `docko session end` when possible, and let
   [stale recovery](protocol.md#stale-recovery) handle crashes.

## From worktree-first workflows

`docko` does not replace worktrees for every case. Migrate only the parts of the workflow that
want persistent slots and explicit multi-agent coordination; see
[persistent slots compared with git worktrees](why-not-just-worktrees.md) if you have not decided
yet.

1. Keep using worktrees for work where cheap, disposable branch checkouts are the only requirement.
2. Adopt docko slots for the work that wants a stable path, warm caches, or an explicit owner:
   `docko slot acquire --root ./workspace --branch <branch> --task "<task>" --brief`.
3. Create a small number of long-lived slots under `slots/` rather than one slot per branch.
4. Move shared coordination material to the workspace root only when the workflow reads it from
   there.

## From runtime-specific hook logic

If the current workflow encodes ownership only inside one runtime's hooks or prompt rules, split
the concerns cleanly.

1. Move claim and release semantics into `docko`'s runtime-neutral CLI, described in
   [runtime-neutral command surface](protocol.md#runtime-neutral-command-surface).
2. Keep runtime hooks as adapter glue: starting sessions, requesting write authorization, and
   automating delegation. See [use docko with Claude Code](claude-code.md) for the reference
   implementation.
3. Preserve runtime-specific detail only in claim metadata (`--branch`, `--task`, `--runtime`) or
   session `metadata`, never as a second source of truth for ownership.

## Map old resources onto docko resources

- A persistent writable clone becomes a `slot` resource, discovered automatically from `slots/`.
- A shared staging environment or a long-lived dev service becomes a `shared-env` resource,
  registered explicitly:

  ```bash
  docko resource ensure --root ./workspace --resource shared-env --id staging
  ```

  ```json
  { "resource_type": "shared-env", "resource_id": "staging", "path": null, "status": "free" }
  ```

- Anything else becomes a custom resource type, registered the same way with a safe string id.
- An informal main-and-helper workflow becomes an owner session that claims a resource, then
  [delegates](delegation.md) it to explicitly started child sessions.

## Common corrections

- Do not store session state inside `registry.json`; it belongs in `docko/sessions/`.
- Do not treat `registry.md` as authoritative; it is generated and best-effort.
- Do not grant a teammate write access by naming convention alone. Record delegation explicitly with
  `docko delegate`.
- Do not bypass the CLI by editing `registry.json` by hand outside deliberate recovery work.
- Do not assume `branch` claim metadata checks out a branch. `docko` never runs `git checkout`.

## Next steps

- [Quickstart](quickstart.md): run the claim and release flow end to end.
- [Application slot pools](applications.md): split a workspace into per-codebase slot pools.
- [Delegate a slot to a teammate](delegation.md): the explicit delegation workflow in full.
- [CLI reference](cli-reference.md): every command this guide names.
