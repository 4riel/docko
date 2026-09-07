# Delegate a slot to a teammate

Delegation gives a second session write access to a slot you already own. Use it when a separately
launched agent needs to work inside your slot without taking the claim from you.

## Before you begin

This guide assumes an owner session already holds a claim. See
[Quickstart](quickstart.md#step-3-claim-a-slot) or [Application slot pools](applications.md) if you
have not claimed a slot yet. Examples use `--root ./workspace` and explicit `--session` values so
the owner and teammate roles stay clear; a Claude Code session usually omits both.

## Which teammates need delegation

Not every teammate needs an explicit delegation:

- Subagents started with the Agent tool share the parent's session id. They inherit the parent's
  claim automatically and need no `docko delegate` call.
- A separately launched `claude` process, or any other runtime session started on its own, gets its
  own session id. It is not covered by the parent's claim and needs delegation before it can write.

See [Use docko with Claude Code](claude-code.md) for how the Claude Code adapter automates the
first case.

## Delegate a slot

Start the child session, then delegate the claimed resource to it from the owner session.

```bash
docko session start --root ./workspace --runtime shell --session teammate --actor-mode delegated --parent-session owner --delegated-from-session owner
```

```bash
docko delegate --root ./workspace --session owner --child-session teammate --resource slot --id backend.main_1
```

```json
{
  "resource_type": "slot",
  "resource_id": "backend.main_1",
  "status": "claimed",
  "claim": { "owner_session_id": "owner" },
  "delegations": [
    {
      "child_session_id": "teammate",
      "granted_by_session_id": "owner",
      "granted_at": "2026-09-07T07:15:52.840Z",
      "scope": "write"
    }
  ]
}
```

Verify it landed with `docko status --root ./workspace --brief`: the resource's `delegation_count`
reflects the new entry. Granting delegation to the same child again updates that record instead of
creating a duplicate.

## Read-scoped delegation

`--scope` defaults to `write`. Pass `--scope read` to record informational access without
authorizing writes:

```bash
docko delegate --root ./workspace --session owner --child-session teammate --resource slot --id backend.main_1 --scope read
```

A read-scoped child can inspect `docko status` and the slot's files through its own tooling, but a
file write from that session into the slot is still denied. Only the owner or a session delegated
with `--scope write` may write.

## When delegated access ends

Delegated write access is only as durable as the parent's claim. It ends immediately when:

- the owner releases the claim: `release` resets the resource to `status: "free"` and clears every
  delegation on it.
- stale recovery clears the claim because the owner session went quiet.
- the owner's session ends: `session end` releases its claims, which clears their delegations too.

Delegation never changes `owner_session_id`. A delegated child never becomes the owner, and ending
the child session on its own does not affect the parent's claim.

Ending the parent session also ends every delegated child session whose `parent_session_id` or
`delegated_from_session_id` names it, moving each child manifest to `docko/sessions/ended/` the same
way `session end` does for the parent itself. That cascade ends the child's session; it does not
touch a resource the child claimed directly under its own name.

## Delegation in Claude Code

The Claude Code adapter automates the Agent-tool case. When Claude starts a subagent, its
`SubagentStart` hook registers a delegated child session under the parent and copies the parent's
existing delegations to it, so the subagent's own session id is authorized wherever the parent's is.
See [what the hooks do](claude-code.md#what-the-hooks-do) for the full hook table.

## Troubleshooting

One symptom is specific to delegation.

### A delegated write is still denied

Check these in order:

1. Confirm the delegation exists: `docko status --root ./workspace --brief` and look at the
   resource's `delegation_count`, or the full record via
   `docko status --root ./workspace --resource slot --id <slot-id>`.
2. Confirm the scope is `write`, not `read`.
3. Confirm the owner's claim is still active. A stale-recovered or released claim clears every
   delegation on it, so the child's write is denied as `slot-not-claimed`, not `unrelated-session`.
   Only the lapsed owner itself sees `claim-expired`.
4. Confirm the writing session is the exact `child_session_id` that was delegated to, not a
   different session id from the same runtime.

See [Errors](errors.md#authorization-reasons) for the full authorization reason table.

## Next steps

- [Application slot pools](applications.md): scope delegation to one application's slots.
- [Use docko with Claude Code](claude-code.md): the hook-driven owner and teammate flow.
- [CLI reference](cli-reference.md): every `delegate` and `session start` option.

## Related

- [Concepts](concepts.md)
- [Protocol](protocol.md)
- [Troubleshooting](troubleshooting.md)
