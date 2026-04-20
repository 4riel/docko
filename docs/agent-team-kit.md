# Agent Team Kit

Use this when you want parallel work on the `docko` repo with clear ownership and a truthful operator flow.

## Recommended Roles

- Repo cartographer: map the task, ownership boundaries, and verification surface with `docko-repo`.
- Protocol steward: own registry, session, claim, delegation, schema, and CLI contract work with `docko-protocol`.
- Adapter builder: own runtime adapter code, templates, and runtime-specific docs with `docko-adapters`.
- Docs maintainer: own README, docs, examples, and onboarding guides with `docko-docs`.
- Verification lead: verify changed behavior against the matching source and tests, then run the needed repo commands.

## Good Splits

- Documentation refresh: repo cartographer, docs maintainer, verification lead
- CLI contract update: protocol steward, docs maintainer, verification lead
- Adapter change: adapter builder, protocol steward if claims or delegation are affected, verification lead
- Protocol change: protocol steward, docs maintainer, verification lead

## Leader Runbook

Manual leader flow:

```text
docko session start --root ./workspace --runtime shell --session leader
docko status --root ./workspace
docko slot acquire --root ./workspace --session leader --branch feat/task --task "team task"
```

Then:

- Choose one slot and keep ownership explicit.
- Start child sessions before delegating to them.
- Delegate only the claimed resource the teammate needs.
- Release the claim or end the session when the task finishes.

## Delegated Teammate Runbook

Manual delegated flow:

```text
docko session start --root ./workspace --runtime shell --session teammate --actor-mode delegated --parent-session leader --delegated-from-session leader
docko delegate --root ./workspace --session leader --child-session teammate --resource slot --id <claimed-slot>
```

Delegated teammate rules:

- Do code work inside the delegated resource. Root-level files outside managed slots remain outside Docko's write enforcement.
- Do not assume ownership transfer. The parent still owns the claim.
- If the leader releases the slot, stop. Child write access is no longer valid.
- If delegation is `--scope read`, do not write.

## Claude Team Runbook

Claude Code uses a different operational path:

- `docko init --claude` installs the adapter assets.
- `adapter claude-code session-start` creates the leader session.
- `adapter claude-code subagent-start` creates the child session and inherits the parent authority automatically.
- `adapter claude-code pre-tool-use` enforces writes against the current slot claim.

Humans normally do not run those hook commands directly. They matter because the docs and repo instructions must stay aligned with that real runtime flow.

## Handoff Rules

- Protocol work is not done until schemas, docs, and tests agree.
- CLI work is not done until `packages/cli/src/index.ts`, `docs/cli-reference.md`, and the CLI tests agree.
- Docs work is not done until every command, file path, and runtime claim is verified in source or tests.
- Verification should name what was not run instead of implying coverage.

## Prompt Starters

- Use `docko-repo` to identify the smallest safe edit surface and the verification commands for this task.
- Use `docko-protocol` to update a claim or delegation behavior and keep the public CLI contract accurate.
- Use `docko-adapters` to update Claude runtime assets or integration docs without moving protocol semantics into the adapter.
- Use `docko-docs` to refresh operator docs and onboarding guides without inventing unsupported flows.
