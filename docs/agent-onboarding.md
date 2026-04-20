# Agent Onboarding

This guide is for people and agents working on the `docko` repository itself.

## Start Here

Read in this order:

1. `README.md`
2. `AGENTS.md`
3. `docs/INDEX.md`
4. `docs/contributing.md`
5. The skill and task-specific references for the surface you are touching

Task map:

- Repo orientation: `docs/repo-structure.md`, `.agents/skills/docko-repo/SKILL.md`
- Protocol or schema work: `docs/protocol.md`, `docs/architecture.md`, `docs/tests.md`, `.agents/skills/docko-protocol/SKILL.md`
- CLI behavior: `packages/cli/src/index.ts`, `tests/cli.unit.test.mjs`, `tests/docko.e2e.test.mjs`, `docs/cli-reference.md`
- Claude adapter work: `docs/claude-code.md`, `docs/adapter-spec.md`, `packages/adapters/claude-code/*`
- Docs and copy: `docs/docs-sync.md`, `docs/public-copy.md`, `docs/public-positioning.md`, `.agents/skills/docko-docs/SKILL.md`

## What Exists Today

- `packages/core` implements the protocol engine.
- `packages/cli` is the public CLI contract.
- `packages/adapters/claude-code` is the only implemented runtime adapter package.
- Codex support in this repo is repo guidance plus skills, not a first-class adapter package.

## Human Contributor Path

Use this when you are working directly from a local checkout:

```text
corepack enable
pnpm install
pnpm build
pnpm test
```

Then:

1. Confirm the owning surface before editing.
2. Read the matching docs and tests.
3. Make the smallest correct change.
4. Re-verify the changed behavior or doc contract before finishing.

## Manual Leader Workflow

Use this when you want explicit docko session control without Claude hooks:

```text
docko session start --root ./workspace --runtime shell --session leader
docko status --root ./workspace
docko slot acquire --root ./workspace --session leader --branch feat/task --task "work item"
```

Practical rules:

- Start from the workspace root.
- Inspect first, then claim.
- Do code work inside the claimed slot. Root-level files outside managed slots remain outside Docko's write enforcement.
- Release the slot or end the session when done.

```text
docko release --root ./workspace --session leader --resource slot --id <claimed-slot>
docko session end --root ./workspace --session leader
```

## Manual Delegated Teammate Workflow

Use this when the runtime does not create child sessions for you:

1. The leader starts and claims a slot.
2. The child session is created.
3. The leader delegates that slot to the child.

```text
docko session start --root ./workspace --runtime shell --session teammate --actor-mode delegated --parent-session leader --delegated-from-session leader
docko delegate --root ./workspace --session leader --child-session teammate --resource slot --id <claimed-slot>
```

Delegated teammate rules:

- A delegated teammate is not the owner of the slot claim.
- A read-scoped delegation does not authorize file writes.
- Parent release invalidates child write access immediately.
- If the parent session or claim is gone, stop and re-check `docko status`.

## Claude Code Team Workflow

Claude is the only runtime with a first-class adapter in this repo today.

Recommended setup:

```text
docko init --root ./workspace --claude --codex
```

In the Claude hook flow:

- `SessionStart` creates the leader session.
- `SubagentStart` creates delegated teammate sessions.
- `PreToolUse` enforces write access against the current slot claim.
- `SessionEnd` releases the leader claims.

Humans usually should not invoke the Claude hook commands manually unless they are debugging the adapter.

## Repo-Specific Notes

- Keep changes inside the narrowest owning surface.
- Protocol docs and schemas are the source of truth.
- Keep command examples shell-neutral by default.
- When editing AGENTS or OpenAI-specific guidance, verify against official OpenAI docs.
