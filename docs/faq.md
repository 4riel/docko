# FAQ

## Is this anti-worktree?

No. Worktrees are often the right answer. `docko` exists for the other case: one stable workspace root plus persistent writable slots.

## Why full clone slots?

Because some local workflows are easier with stable full directories, warm caches, long-lived per-slot state, and local servers that stay attached to one path.

## Does this require Claude Code?

No. The protocol and CLI do not require Claude Code. Claude Code is simply the only implemented runtime adapter in this repository today.

## Is Codex a first-class adapter here?

No. Codex support is `AGENTS.md` guidance, not a hook-backed runtime adapter. The model can follow the protocol, but the repository does not ship Codex enforcement.

## Is the lock system a security boundary?

No. It is an operational coordination tool. It helps well-behaved runtimes avoid conflicting writes; it is not hard isolation.

## Do teammates need separate claims?

Not when delegation is recorded properly. Claude teammates can inherit authority from a leader session instead of opening a second claim for the same slot.

## What does `status` do beyond listing slots?

It also runs stale-claim recovery. If stale claims were released automatically, the JSON output reports them under `janitor.released_claims`.

## When should I use worktrees instead?

Use worktrees when the repo is light, branch fan-out is the main goal, and you do not need persistent per-slot local state or a shared workspace hub.

## Does `docko claim` check out the branch?

No. `branch` is claim metadata: docko records it so other sessions can see what a slot is being used for. It never runs `git checkout` and never inspects the slot's git state.

## Can two sessions share one slot?

No. A claim is slot-scoped and exclusive. Delegation is how a teammate gets write access to somebody else's claimed slot; there is no per-file or per-PR claim.

## Why did my claim expire while I was working?

Claims go stale after their stale window with no heartbeat. `docko status --brief` lists claims that are close to lapsing under `summary.stale_candidates`, and `docko heartbeat` refreshes one explicitly. A denied write tells you which case you hit: `claim-expired` means it lapsed, `slot-not-claimed` means it was never claimed.

## Do subagents need their own claim?

Subagents started with the Agent tool share the parent's session id, so they inherit the parent's claim and need nothing. A separately launched `claude` process has its own session id and needs `docko delegate`.

## What is `--brief`?

The compact JSON form of a payload, for agents and scripts. It is not a different command and it does not change what the command does.

## Which session id does docko use when I do not pass `--session`?

`DOCKO_SESSION_ID`, then `CLAUDE_CODE_SESSION_ID`, then the single active session. An env id that matches no active session is ignored. When more than one session is active and none of those apply, the `AMBIGUOUS_SESSION` error carries a `suggested_command` you can run as-is.
