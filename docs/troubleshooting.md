# Troubleshooting

This page covers the error codes and operator problems exercised by the CLI and end-to-end tests.

## Session Resolution

### `NO_ACTIVE_SESSION`

You tried to run a session-aware command without `--session`, `DOCKO_SESSION_ID`, or any active resolvable session.

Fix:

```text
docko session start --root ./workspace --runtime shell --session leader
```

Then retry the command with `--session leader`.

### `AMBIGUOUS_SESSION`

Multiple active sessions exist and docko refuses to guess.

The error payload carries everything needed to recover:

- `suggested_command`: the command you just ran, re-rendered with `--session` filled in. Run it.
- `newest_session_id` and `active_sessions`: the ten most recently updated sessions, newest first.
- `active_session_count`: how many are active in total.

Fix:

```text
docko session list --root ./workspace --brief --limit 5
docko claim --root ./workspace --session leader --resource slot --id main
```

Under Claude Code you should rarely see this: the SessionStart hook exports `DOCKO_SESSION_ID`, and the CLI also falls back to `CLAUDE_CODE_SESSION_ID`. If it keeps happening, run `docko adapter claude-code doctor` to check whether the hook launcher is installed and current.

Do not end the listed sessions unless you are intentionally cleaning up workspace state. `AMBIGUOUS_SESSION` means docko needs an explicit session choice; it does not mean those sessions are stale. Never invent a session id to get past it: the write hook checks the runtime's own session, so a made-up id claims a slot that then blocks your own writes with `unrelated-session`.

### `SESSION_NOT_FOUND`

The session you referenced does not exist anymore, or a delegated startup named a missing parent session.

Common causes:

- the session file was removed
- the child session was never created
- `session start --actor-mode delegated` named a missing parent
- a Claude hook is carrying a stale `DOCKO_SESSION_ID`

### `session list` Keeps Growing

Sessions are only marked ended by `session end`, so crashed or abandoned runtimes used to stay active forever.
The janitor now ends sessions that stay quiet past `workspace.config.janitor.session_stale_after_ms` (default 8 hours) on every registry mutation.

To clear an existing backlog now:

```text
docko session prune --root ./workspace --dry-run
docko session prune --root ./workspace
```

Notes:

- start with `--dry-run`; it reports the same set without writing anything
- `--max-age-ms <n>` prunes more aggressively for one run, for example `--max-age-ms 3600000` for an hour
- sessions that still own or are delegated a live claim are never ended, so an active teammate is safe

### Ended sessions and `docko/sessions/ended/`

Ending a session moves its manifest to `docko/sessions/ended/` so the hot path only reads live sessions. `docko session prune --retention-ms <n>` deletes ended manifests older than the window (default 7 days) and reports `deleted_manifests`.

### `SESSION_ID_CONFLICT`

You tried to start a new session with an ID that is already active.

Fix:

- choose a different session ID
- or end the old session first

## Claim And Release Problems

### `RESOURCE_ALREADY_CLAIMED`

Another live session owns the resource.

Check first:

```text
docko status --root ./workspace --resource slot --id main
```

Then either:

- choose another slot
- wait for the owner to release it
- or use an explicit operator recovery release if that is intentional

```text
docko release --root ./workspace --session operator --resource slot --id main --force
```

### `NO_FREE_SLOT`

Every managed slot is currently claimed, and docko was not allowed to create a fresh clone.

Fix:

```text
docko slot acquire --root ./workspace --session leader --clone-when-busy --branch feat/task --task "start work"
```

Or re-run `docko slot acquire --prompt` and answer the clone confirmation interactively.

### `RESOURCE_OWNED_BY_OTHER_SESSION`

You attempted a normal release as a non-owner.

Fix:

- release it as the owner
- or use `--force` only for explicit recovery

### `RESOURCE_NOT_FOUND`

The requested resource ID is not registered.

Common causes:

- the slot directory does not exist
- you misspelled the slot ID
- you forgot to register a non-slot resource with `resource ensure`

### `RESOURCE_MUTATION_DENIED`

You tried to change the `path` of a claimed non-slot resource.

Fix:

- release the resource first
- then run `resource ensure` again with the new path

## Input And Path Errors

### `INVALID_ID`

The resource ID is unsafe. Path traversal and spaces are rejected.

Use simple IDs such as `main`, `app-alpha`, or `staging`.

### `ROOT_PARENT_NOT_FOUND`

The parent folder of `--root` does not exist yet.

Fix the path and retry.

### `ROOT_NOT_DIRECTORY`

The `--root` path points to a file instead of a directory.

Choose a directory path and retry.

### `ROOT_INSIDE_SLOT`

A scaffolding command — `docko init` or `docko adapter claude-code install` — was pointed at a directory inside another workspace's managed `slots/` tree. It refuses rather than scaffolding a second registry, or a second Claude Code install, inside a slot.

This fires whether or not `--root` was passed: a bare `docko init` run from inside a slot is the same mistake.

The message names the absolute workspace root and the command to run instead; the payload also reports `provided_root` and `workspace_root`.

```text
docko init --root "/abs/path/to/workspace"
docko adapter claude-code install --root "/abs/path/to/workspace"
```

Every other command resolves up instead of failing: `docko status --root .` from inside a slot works and reports the owning workspace as `resolved_root`.

### `ROOT_NOT_WORKSPACE`

`docko adapter claude-code install` was pointed at a directory that has no registry of its own but sits inside another workspace. Installing there would scatter `.claude-plugin/` and `.claude/` assets outside the workspace that owns them, so it refuses instead of silently installing into the ancestor.

Exit code 1. The payload reports `provided_root` and `workspace_root`.

```text
docko adapter claude-code install --root "/abs/path/to/workspace"
```

`docko init` allows this case: a nested workspace outside `slots/` is legitimate, and init scaffolds one at the directory you named.

### `SOURCE_NOT_FOUND`

The source path for `init --clone-source`, `slot duplicate --from`, or `slot acquire --clone-from` was not found.

Check the path and retry.

### `SOURCE_EMPTY`

The source folder exists but is empty, so it cannot seed a managed slot.

Choose a non-empty repo or clone.

### `INIT_CANCELLED`

Guided init was cancelled during confirmation.

This is not a partial success. Re-run `docko init` and confirm the root when ready.

## Registry And Hook Issues

### `CORRUPTED_REGISTRY`

`docko/registry.json` is unreadable or violates the schema.

Practical recovery:

1. Restore `docko/registry.json` from a known-good state.
2. Re-run a normal read or render command.

```text
docko render --root ./workspace
```

### Claude `pre-tool-use` denies a delegated teammate

Check these conditions:

- the parent still owns the slot
- the child session still exists
- the delegation scope is `write`, not `read`
- the target path is actually inside the delegated slot

If the parent released the claim, child access should fail. That is expected.

### Claude hook payloads with no file path

Docko does not raise a dedicated `MALFORMED_HOOK_PAYLOAD` error here. The tested behavior is a successful authorization response with `allow: true` and `reason: "no-file-path"`.

## Stale Or Stuck Claims

`status`, `claim`, `heartbeat`, `release`, `delegate`, and file-write authorization all run the same stale-recovery path.

Operator pattern:

```text
docko status --root ./workspace --resource slot --id main
```

If the claim is stale, the response can include the automatic release in `janitor.released_claims`. If the owner is still live and you need to recover intentionally, use `release --force`.

`docko status --brief` also reports `summary.stale_candidates`: claims that have been quiet for more than half their stale window, with the owner's `last_heartbeat_at`. Refresh yours with `docko heartbeat` before it lapses.

## Workspace And Root Problems

### `WORKSPACE_NOT_INITIALIZED`

You ran a command against a directory with no `docko/registry.json`, and no ancestor has one either.

```text
docko init --root "/abs/path/to/workspace"
```

Exit code 1. Previously this surfaced as a raw `ENOENT` naming an internal lock path.

### `--root .` from inside a slot

For read and write commands this is no longer an error. docko walks up from the given root to the workspace that owns `docko/registry.json` and reports the result as `resolved_root`.

The scaffolding commands (`init` and `adapter claude-code install`) never walk up, because resolving up would silently write into a workspace the caller did not name. From inside a slot they fail with `ROOT_INSIDE_SLOT`; `install` from a non-workspace directory inside a workspace fails with `ROOT_NOT_WORKSPACE`. Both messages name the absolute workspace root and the command to run instead.

## Concurrency And Filesystem

### `REGISTRY_LOCK_TIMEOUT`

Another docko process held `docko/.registry.lock/` for longer than the wait budget. The error details carry `lock_dir`, `waited_ms`, the lock `owner` (pid, hostname, start time), and `next_steps`.

What to check:

1. Is another docko command, hook, or poller running? Concurrent hooks on a busy workspace are the usual cause; retry with a short backoff instead of a fixed interval.
2. How old is the lock? Staleness is judged purely by age: a lock older than 30 seconds is treated as abandoned and broken automatically by the next caller. The recorded `pid` is diagnostic only — docko never probes it for liveness, so a live process that holds the lock for more than 30 seconds can have it broken, and a dead owner's lock is not broken any faster than an old live one.
3. If the lock somehow survives, deleting `docko/.registry.lock/` is safe when no docko process is running. A `docko/.registry.lock.stale-*` directory is a lock docko quarantined while breaking it; it is deleted immediately and is only left behind by a process killed mid-break, after which the temp sweeper reclaims it.

Pollers that call `docko status` on a timer should back off after repeated timeouts rather than retrying at the same rate.

### `ATOMIC_WRITE_FAILED` and `EPERM: operation not permitted, rename`

On Windows, `rename` fails with `EPERM`/`EACCES`/`EBUSY` whenever the destination file is open in another process without share-delete — typically a real-time antivirus scanner, or another docko process reading the same manifest. docko retries these renames with backoff and only raises `ATOMIC_WRITE_FAILED` (exit 2) when the retry budget is exhausted; the error names the file and the attempt count.

If you see it repeatedly, exclude the workspace's `docko/` directory from real-time antivirus scanning.

A failure to write the generated `docko/registry.md` mirror never fails the command; it is best-effort and logged.

### Leftover `.docko-tmp-*` entries

Atomic writes stage content in a sibling temp file. A process killed mid-write (for example a hook that hit its timeout) can leave one behind. They are safe to delete, and docko sweeps stale ones during normal operation.

## Facts That Look Like Bugs

- **`branch` is claim metadata.** docko records the branch on a claim and never runs `git checkout`. If the slot's working tree is on another branch, that is git state, not docko state.
- **Claims are slot-scoped.** A claim reserves one slot for one session. It does not reserve a branch, a PR, or individual files, and two sessions cannot share one slot.
- **`--brief` is the compact JSON form**, not a different command. Every payload is JSON on stdout; errors are JSON on stderr with a non-zero exit code.
- **The janitor only touches registry state.** Reclaiming a stale claim never modifies files inside a slot.
