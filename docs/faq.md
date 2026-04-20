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
