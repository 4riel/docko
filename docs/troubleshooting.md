# Troubleshooting

Symptom-first fixes for a workspace that is not behaving. Each entry states what you saw, why docko
did it, and the command that clears it. For the meaning of a specific code, see
[Errors](errors.md).

Every example uses `--root ./workspace`. Under Claude Code you can omit `--root`, because docko
walks up from the current directory to the workspace that owns `docko/registry.json`. Absolute paths
docko prints are shown here as `<workspace-root>`.

## Sessions

Every session-aware command resolves one session id before it does anything else. These entries
cover the ways that resolution fails.

### docko says there is no active session

```json
{"error": {"code": "NO_ACTIVE_SESSION", "message": "No active session found.",
           "active_session_count": 0,
           "resolution": {"explicit_session_id": null, "env_session_id": null}}}
```

Session-aware commands need a session, and none resolved. An environment id matching no active
session is ignored rather than fatal, so `env_session_id` can be set and the command still fails.
See [resolve](protocol.md#resolve) for the full order.

Start a session and pass its id:

```bash
docko session start --root ./workspace --runtime shell --session leader
docko claim --root ./workspace --session leader --resource slot --id main
```

Under Claude Code the `SessionStart` hook does this for you. If it keeps happening there, run
`/dock-doctor` and see [Use docko with Claude Code](claude-code.md).

### docko refuses to pick between my sessions

```json
{
  "error": {
    "code": "AMBIGUOUS_SESSION",
    "active_session_count": 2,
    "newest_session_id": "helper",
    "suggested_command": "docko claim --root ./workspace --resource slot --id main --session helper"
  }
}
```

Two or more sessions are active, so docko cannot tell which one is acting. It refuses rather than
guessing, because a wrong guess claims a slot for a session that never writes.

Run the `suggested_command` from the payload, or pick an id yourself:

```bash
docko session list --root ./workspace --brief --limit 5
```

Do not end the listed sessions to get past this, and never invent an id: the write hook checks the
runtime's own id. See [AMBIGUOUS_SESSION](errors.md#ambiguous_session).

### `session list` keeps growing

Sessions stay active until something ends them, so a crashed runtime leaves its manifest behind. The
janitor ends sessions that have been quiet past `workspace.config.janitor.session_stale_after_ms`
(8 hours by default) on every registry mutation, but it works under the per-pass caps in
[stale recovery](protocol.md#stale-recovery), so a long backlog takes more than one pass.

Clear a backlog on demand, checking the set first:

```bash
docko session prune --root ./workspace --dry-run --brief
docko session prune --root ./workspace --brief
```

```json
{"dry_run":true,"max_age_ms":28800000,"retention_ms":604800000,"pruned_session_count":0,"deleted_manifests":0,"pruned_sessions":[]}
```

`--max-age-ms <n>` prunes more aggressively for one run. Sessions that own or are delegated a live
claim are never ended, so an active teammate is safe.

### my session id no longer exists

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session not found or already ended.",
    "session_id": "ghost"
  }
}
```

The id you passed names no active session. Ending a session moves its manifest to
`docko/sessions/ended/`, and an ended session is never current. A stale `DOCKO_SESSION_ID` exported
by an earlier run produces the same error, as does a `SubagentStart` that named a parent that has
already ended.

Read the live ids and use one, or start a new session:

```bash
docko session list --root ./workspace --brief
docko session start --root ./workspace --runtime shell --session leader
```

## Claims and slots

A claim is one session holding one slot. These entries cover taking one, losing one, and giving one
back.

### The slot I want is already claimed

```json
{
  "error": {
    "code": "RESOURCE_ALREADY_CLAIMED",
    "resource_id": "main",
    "owner_session_id": "leader"
  }
}
```

A live session owns the claim. docko never transfers a claim on `claim`, because two sessions
writing one slot is the thing it exists to prevent.

Let docko pick a free slot instead of contending for that one:

```bash
docko slot acquire --root ./workspace --session helper --branch feat/auth --task "add auth" --brief
```

Take it over only when the owner is genuinely gone, with
`docko release --root ./workspace --session helper --resource slot --id main --force`. Ask the owner
to release it, or wait for stale recovery, before you force.

### Every slot is busy

```json
{"error": {"code": "NO_FREE_SLOT", "slot_count": 1, "busy_slot_count": 1, "pinned_slot_count": 0}}
```

Every managed slot carries a live claim, and `slot acquire` was not authorized to make a new one.
`pinned_slot_count` counts slots taken out of rotation with `resource ensure --no-auto-acquire`;
round-robin skips those, though `--prefer` still takes one when it is free.

Ask docko for a fresh managed slot, or wait for a release:

```bash
docko slot acquire --root ./workspace --session helper --clone-when-busy --branch feat/auth --task "add auth"
```

`--prompt` asks for the same confirmation interactively. See
[Application slot pools](applications.md) when the busy pool is one application's.

### A slot directory never shows up in status

A directory under `slots/` whose name is not a valid resource id is skipped by discovery. It owns no
resource, so it can never be claimed, and it is reported separately:

```json
{"ignored_slot_dirs":["slots/my slot"]}
```

Valid ids match `[\w][\w\-.]*` and must not contain `..`, so spaces, a leading dash, and path
traversal are all rejected. Writes into such a directory are denied, because answering
`path-not-managed` inside the managed tree would make it writable by anyone.

Rename the directory to a valid id, then re-run discovery:

```bash
docko status --root ./workspace --brief
```

### My claim expired while I was still working

The janitor releases a claim once it has been quiet longer than the claim's `stale_after_ms`. The
default is 1 hour for a slot, 10 minutes for `shared-env`, and 30 minutes for other resource types.
Quiet means no heartbeat: an authorized write through the Claude Code hook refreshes the claim, but
work that touches no file inside the slot does not.

A read command reports what the janitor did in the same pass:

```json
{"janitor": {"released_claims": [{"resource_id": "dup2", "claim": {"release_reason": "stale-recovery"}}]}}
```

`docko status --brief` also lists `summary.stale_candidates`: claims quiet for more than half their
window, with the owner's `last_heartbeat_at`. Refresh yours before it lapses:

```bash
docko heartbeat --root ./workspace --session leader --resource slot --id main
```

Raise the window for a long job with `--stale-after-ms <n>` on `claim` or `slot acquire`.

### Release says I do not own the slot

```json
{"error": {"code": "RESOURCE_OWNED_BY_OTHER_SESSION", "resource_id": "main",
           "owner_session_id": "leader"}}
```

Only the owner session releases a claim. A delegated child cannot, and neither can a sibling. A
release that reports `RESOURCE_NOT_CLAIMED` instead means the slot is already free.

Release as the owner:

```bash
docko release --root ./workspace --session leader --resource slot --id main
```

> **Warning:** `--force` takes a slot from a live session. Use it only when the owner is gone and
> you are deliberately recovering the slot.

## Writes denied in Claude Code

The `PreToolUse` hook denies an unauthorized `Edit` or `Write` inside a managed slot. Every deny
names the slot, the reason, and one command that clears it.

### Claude says the slot is not claimed

```text
docko blocked this write: dup2 is not claimed. Claim it first: docko slot acquire
--root <workspace-root> --session helper --prefer dup2 --branch <branch> --task "<task>" --brief
```

The slot exists and is free. docko denies the write rather than claiming the slot for you, so
ownership stays an explicit act.

Run the command in the deny text. It names the slot with `--prefer`, so you get the slot you were
already editing. If the text ends with a note that your session is not registered with docko, the
`SessionStart` hook did not run: start the session with the command that note gives you, then retry.

### Claude says another session owns the slot

```text
docko blocked this write: the slot main is claimed by session leader (still active). Ask that
session to release or delegate it, or run: docko release --root <workspace-root> --session helper
--resource slot --id main --force
```

The deny text reports the owner as `still active`, `no longer active`, or `liveness unknown`, plus
the owner's branch and task when the claim recorded them.

Take a different slot when the owner is live:

```bash
docko slot acquire --root ./workspace --session helper --branch feat/auth --task "add auth" --brief
```

Ask the owner to delegate the slot when you have to work in that one. See
[Delegate a slot to a teammate](delegation.md).

### Claude says my claim expired

```text
docko blocked this write: your claim on dup2 expired at 2026-09-07T07:19:26.602Z (no heartbeat for
2s). Re-claim it: docko claim --root <workspace-root> --session helper --resource slot --id dup2
--branch feat/x --task "short lived"
```

The janitor released your own claim, and the slot is free again. docko replays your branch and task
into the re-claim command, so the recovery is one paste.

Re-claim it, then keep the claim warm with a longer window if the work is slow:

```bash
docko claim --root ./workspace --session helper --resource slot --id dup2 --branch feat/x --task "short lived" --stale-after-ms 7200000
```

A different directory in the deny text means the slot directory name is not a valid resource id.
Rename the directory; no claim can ever cover it.

### A delegated teammate is denied

A child session writing inside a slot the parent owns is denied with `unrelated-session` when the
delegation does not cover it. Three things cause that:

- the delegation scope is `read`, which authorizes no writes
- the child session id in the hook payload is not the one the delegation names
- the parent's claim ended, so the delegation went with it

Read the delegation record on the slot:

```bash
docko status --root ./workspace --resource slot --id main
```

```json
{"delegations": [{"child_session_id": "child", "granted_by_session_id": "leader", "scope": "read"}]}
```

`summary.my_claims` lists a read-scoped slot alongside owned ones, so a slot appearing there is not
proof that writes are authorized. Confirm `scope` is `write`.

### The hook allowed a write it never checked

Two allowed reasons mean docko took no position on the write.

- `path-not-managed`: the path is outside every managed slot. docko answers only for paths inside
  `slots/`, so root-level files are never blocked.
- `no-file-path`: the hook payload carried no file path, so there was nothing to authorize.

```json
{"allow": true, "reason": "no-file-path"}
```

Neither is an error, and neither has a dedicated error code. If you expected a deny, confirm the
path is really inside a managed slot with `docko status --root ./workspace --brief`.

## Workspace and paths

docko resolves the workspace root by walking up from `--root`, with two commands that refuse to do
so. These are the errors that produces.

### init or install refuses the directory I chose

`docko init` and `docko adapter claude-code install` never resolve up. Pointed inside another
workspace's `slots/` tree they fail with `ROOT_INSIDE_SLOT`, and `install` pointed at a
non-workspace directory inside a workspace fails with `ROOT_NOT_WORKSPACE`. Both would otherwise
scatter a second registry, or a second Claude Code install, into a tree another workspace manages.

Both messages name the absolute workspace root and the command to run instead. The payload repeats
it as `workspace_root`:

```bash
docko adapter claude-code install --root ./workspace
```

`docko init` allows the `ROOT_NOT_WORKSPACE` case: a nested workspace outside `slots/` is
legitimate, and init scaffolds one where you named it. See
[ROOT_INSIDE_SLOT](errors.md#root_inside_slot).

### docko says the workspace is not initialized

```json
{
  "error": {
    "code": "WORKSPACE_NOT_INITIALIZED",
    "message": "No docko workspace at <workspace-root>. Run: docko init --root \"<workspace-root>\"",
    "docko_dir": "<workspace-root>\\docko"
  }
}
```

Neither the directory you named nor any ancestor holds `docko/registry.json`. docko walked up and
found nothing.

Create the workspace:

```bash
docko init --root ./workspace
```

### I ran a command from inside a slot

For every command except the two scaffolding ones this works. docko walks up from `--root` to the
workspace that owns `docko/registry.json` and reports what it found as `resolved_root`:

```bash
docko status --root ./workspace --brief
```

```json
{"resolved_root": "<workspace-root>", "slots": {"total": 2, "free": 1, "claimed": 1}}
```

Compare `resolved_root` with the root you passed when a command answers for a workspace you did not
expect. Edit code inside `slots/`, and run docko from the workspace root.

## Concurrency and filesystem

Registry writes serialize on a lock directory and land through an atomic rename. Both steps can
fail on a busy or scanned filesystem.

### Commands time out waiting for the registry lock

```json
{"error": {"code": "REGISTRY_LOCK_TIMEOUT", "waited_ms": 10018,
           "owner": {"pid": 99999, "hostname": "demo-host", "acquired_at": "2026-09-07T07:17:55.419Z"}}}
```

Another process held `docko/.registry.lock/` for the whole wait budget. Concurrent hooks on a busy
workspace are the common cause.

Retry once, then delete `docko/.registry.lock/` only when no docko process is running:

```bash
docko status --root ./workspace --brief
```

See [REGISTRY_LOCK_TIMEOUT](errors.md#registry_lock_timeout) for the stale window and the
back-off rule for pollers.

### A command reports that it lost the registry lock

Another process broke this command's lock before it wrote, which a suspended machine or a paused
debugger both cause. Nothing was written.

Retry the command:

```bash
docko status --root ./workspace --brief
```

See [REGISTRY_LOCK_LOST](errors.md#registry_lock_lost) for why the registry is untouched.

### Writes fail with `EPERM` on Windows

```json
{
  "error": {
    "code": "ATOMIC_WRITE_FAILED",
    "message": "Failed to replace <workspace-root>\\docko\\registry.json after 6 attempts (EPERM). Another process or a file scanner may be holding it open.",
    "attempts": 6,
    "cause_code": "EPERM"
  }
}
```

Another process holds the destination file open, so the atomic rename cannot replace it. A
real-time antivirus scanner is the usual holder, and a read-only attribute produces the same code.

Exclude the workspace's `docko/` directory from real-time scanning, and clear read-only attributes
on `docko/registry.json`. See [ATOMIC_WRITE_FAILED](errors.md#atomic_write_failed) for the retry
behavior. A failed write of the generated `docko/registry.md` never fails a command.

### Stray `.tmp` files under `docko/`

Every atomic write stages content in a sibling `<name>.<hex>.tmp` file. A process stopped mid-write,
such as a hook that hit its timeout, leaves one behind.

They are safe to delete. Once per command, on the first registry read or write, docko sweeps `.tmp`
files, `.docko-tmp-*` directories, and `.registry.lock.stale-*` directories older than five minutes
from `docko/`, `docko/sessions/`, and `docko/sessions/ended/`.

```bash
docko status --root ./workspace --brief
```

## Behavior that looks like a bug

Each of these is intended behavior that reads like a defect the first time you hit it.

- **`branch` is claim metadata.** docko records the branch on a claim and never runs `git checkout`.
  A slot's working tree sitting on another branch is git state, not docko state.
- **Claims are slot-scoped.** A claim reserves one slot for one session. It does not reserve a
  branch, a pull request, or individual files, and two sessions cannot share one slot.
- **`--brief` is a projection.** It is the compact form of the same payload, not a different
  command. It is accepted on `status`, `slot acquire`, `session list`, `session prune`, and
  `release`.
- **The janitor only touches registry state.** Reclaiming a stale claim releases the claim and
  changes nothing inside the slot directory.
- **Delegation is not ownership.** A delegated child writes inside the slot while the claim lasts,
  cannot release it, and loses access the moment the owner does.

## Related

- [Errors](errors.md): every error code, its exit code, and its fix.
- [Use docko with Claude Code](claude-code.md): the hooks, the deny path, and `/dock-doctor`.
- [Delegate a slot to a teammate](delegation.md): who needs a delegation and what it grants.
- [Protocol](protocol.md): the stale-recovery and authorization rules behind these fixes.
- [CLI reference](cli-reference.md): every command and option used on this page.
