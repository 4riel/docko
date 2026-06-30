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

Fix:

```text
docko session list --root ./workspace --brief
docko claim --root ./workspace --session leader --resource slot --id main
```

Do not end the listed sessions unless you are intentionally cleaning up workspace state. `AMBIGUOUS_SESSION` means docko needs an explicit session choice; it does not mean those sessions are stale.

### `SESSION_NOT_FOUND`

The session you referenced does not exist anymore, or a delegated startup named a missing parent session.

Common causes:

- the session file was removed
- the child session was never created
- `session start --actor-mode delegated` named a missing parent
- a Claude hook is carrying a stale `DOCKO_SESSION_ID`

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

You passed an explicit `--root` that resolves inside a managed `slots/` directory. docko refuses rather than fragmenting a second registry into the slot.

The error payload reports both `provided_root` and the owning `workspace_root`. Re-run against the workspace root:

```text
docko status --root ./workspace
```

Note: an *implicit* root (cwd or `DOCKO_ROOT`) inside a slot is not an error — docko walks up to the owning workspace automatically. Only an explicit `--root` inside a slot is rejected.

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
