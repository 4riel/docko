# Errors

Every code the `docko` CLI can print, its exit code, and the command that clears it. Read this page
when you have an error payload in front of you; read [Troubleshooting](troubleshooting.md) when you
have a symptom instead.

## Error output shape

A failed command writes one JSON object to stderr and exits non-zero. Nothing is written to stdout.

```json
{
  "error": {
    "code": "RESOURCE_ALREADY_CLAIMED",
    "message": "Resource is already claimed.",
    "resource_type": "slot",
    "resource_id": "main",
    "owner_session_id": "leader"
  }
}
```

`code` and `message` are always present. Every other key is detail the code carries, and the keys
differ per code. Four appear across many codes:

| Field | Type | Description |
| --- | --- | --- |
| `next_steps` | array | Ordered recovery actions, as plain strings. |
| `suggested_command` | string | The command you ran, re-rendered so it succeeds. |
| `workspace_root` | path | The absolute workspace root docko resolved. |
| `session_id` | string | The session docko acted as. |

Two surfaces render errors differently. With `--brief` the same object is printed as a single line.
Guided `docko init` prints `Init failed [<code>]: <message>` on stderr, because its whole output is
human-readable text.

## Exit codes

| Exit | Meaning |
| --- | --- |
| `0` | The command succeeded. |
| `1` | Usage error or missing resource. |
| `2` | Ownership or active-id conflict, or a failed registry write. |
| `3` | Ambiguous session. |
| `4` | Missing or unavailable session. |
| `5` | Corrupted registry. |

## Error codes

| Code | Exit | Meaning | Fix |
| --- | --- | --- | --- |
| `ADAPTER_VERSION_MISSING` | 2 | The installed Claude Code adapter package carries no version. | Reinstall `docko-workspace@alpha`. |
| `AMBIGUOUS_APPLICATION` | 1 | The `--task` and `--branch` text matches two or more applications equally. | Re-run with `--application <id>`. |
| `AMBIGUOUS_SESSION` | 3 | More than one session is active and the command named none. | Run the payload's `suggested_command`. |
| `APPLICATION_NOT_FOUND` | 1 | `--application` names an application the workspace does not have. | Register it with `docko app ensure`. |
| `APPLICATION_SLOT_CONFLICT` | 2 | The application id collides with an existing flat slot id. | Pick another application id, or rename `slots/<id>`. |
| `ATOMIC_WRITE_FAILED` | 2 | Six rename attempts failed to replace a docko file. | Release the handle on `file_path`, then retry. |
| `CLAUDE_SETTINGS_INVALID` | 2 | The existing `.claude/settings.local.json` is not valid JSON. | Repair or delete that file, then re-run the install. |
| `CORRUPTED_REGISTRY` | 5 | `docko/registry.json` does not parse or fails schema validation. | Restore the registry from a known-good copy. |
| `INIT_CANCELLED` | 1 | Guided `docko init` was answered `n` at the root confirmation. | Re-run `docko init` and confirm the root. |
| `INVALID_ID` | 1 | An id has characters outside `[\w][\w\-.]*`, or contains `..`. | Use an id such as `main` or `app-alpha`. |
| `NO_ACTIVE_SESSION` | 4 | No session was named and no session is active. | Run `docko session start --root ./workspace --runtime shell --session <id>`. |
| `NO_FREE_SLOT` | 2 | Every managed slot is claimed and cloning was not authorized. | Re-run `docko slot acquire` with `--clone-when-busy`. |
| `NO_MANAGED_SLOTS` | 1 | The workspace root, or the chosen application, owns no slot directory. | Create one with `docko slot duplicate`. |
| `PREFERRED_SLOT_NOT_FOUND` | 1 | `--prefer` names no managed slot in the selected scope. | Choose an id from `known_slot_ids` in the payload. |
| `REGISTRY_LOCK_LOST` | 2 | Another process broke this command's registry lock before it wrote. | Retry the command. |
| `REGISTRY_LOCK_TIMEOUT` | 2 | The registry lock stayed held for the whole 10 second wait budget. | Retry, then delete the lock directory when no docko process runs. |
| `RESOURCE_ALREADY_CLAIMED` | 2 | A live session already owns the resource. | Take another slot with `docko slot acquire`. |
| `RESOURCE_MUTATION_DENIED` | 2 | `docko resource ensure` tried to move a claimed resource's path. | Release the resource, then re-run `resource ensure`. |
| `RESOURCE_NOT_CLAIMED` | 1 | The resource is free, so there is nothing to release. | Confirm with `docko status --root ./workspace --brief --claimed`. |
| `RESOURCE_NOT_FOUND` | 1 | No resource with that type and id is registered. | Check the id in `docko status`, or run `docko resource ensure`. |
| `RESOURCE_OWNED_BY_OTHER_SESSION` | 2 | A session that does not own the claim tried to release it. | Release as the owner, or add `--force`. |
| `ROOT_INSIDE_SLOT` | 1 | A scaffolding command was pointed inside a managed `slots/` tree. | Re-run against the payload's `workspace_root`. |
| `ROOT_NOT_DIRECTORY` | 1 | `--root` points at a file. | Pass a directory path. |
| `ROOT_NOT_WORKSPACE` | 1 | `adapter claude-code install` was pointed at a non-workspace directory inside a workspace. | Re-run against the payload's `workspace_root`. |
| `ROOT_PARENT_NOT_FOUND` | 1 | The parent directory of `--root` does not exist. | Create the parent, or correct the path. |
| `SESSION_ID_CONFLICT` | 2 | The requested session id is already active. | Choose another id, or end the active session first. |
| `SESSION_NOT_FOUND` | 4 | The named session does not exist or has already ended. | List live ids with `docko session list --root ./workspace --brief`. |
| `SLOT_ACQUIRE_RETRY_EXHAUSTED` | 2 | Concurrent sessions took every candidate slot on each retry. | Retry, or add `--clone-when-busy`. |
| `SOURCE_EMPTY` | 1 | The clone or slot source directory contains no files. | Point `--from` or `--clone-source` at a non-empty directory. |
| `SOURCE_NOT_FOUND` | 1 | The clone or slot source path does not exist. | Correct the path. |
| `TARGET_EXISTS` | 2 | The target slot directory already exists and is not empty. | Choose another `--to` id. |
| `UNEXPECTED_ERROR` | 1 | An error docko does not classify reached the CLI boundary. | Read `message`, then open an issue. |
| `USAGE_ERROR` | 1 | An option is missing or malformed, or the command is unknown. | Run `docko <command> --help`. |
| `WORKSPACE_NOT_INITIALIZED` | 1 | Neither the root nor any ancestor holds `docko/registry.json`. | Run `docko init --root ./workspace`. |

### AMBIGUOUS_SESSION

Two or more sessions are active, so docko cannot decide which one is acting. It refuses instead of
guessing, because guessing wrong claims a slot for a session that never writes.

The payload carries the recovery. `suggested_command` is the exact command you ran with `--session`
filled in from `newest_session_id`, `active_sessions` lists the ten most recently updated sessions
newest first, `active_session_count` is the full total, `next_steps` spells out the same three
actions, and `resolution` echoes the explicit and environment ids that failed to resolve.

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

Under Claude Code this is rare: the `SessionStart` hook exports `DOCKO_SESSION_ID` and the CLI also
reads `CLAUDE_CODE_SESSION_ID`. Repeated ambiguity there means the hook is not running.

> **Warning:** Do not end the listed sessions to get past this. They are active, not stale, and
> ending one releases its claims.

### ROOT_INSIDE_SLOT

`docko init` or `docko adapter claude-code install` was pointed at a directory inside another
workspace's `slots/` tree. Scaffolding there would create a second registry, or a second Claude Code
install, inside a slot the outer workspace manages.

This fires whether or not you passed `--root`: a bare `docko init` run from inside a slot is the
same mistake. The message names the absolute workspace root and the command to run instead, and the
payload repeats it as `provided_root` and `workspace_root`.

```bash
docko init --root ./workspace
```

Every non-scaffolding command resolves up instead of failing. `docko status --root .` from inside a
slot answers for the owning workspace and reports it as `resolved_root`.

### ROOT_NOT_WORKSPACE

`docko adapter claude-code install` was pointed at a directory that holds no registry of its own but
sits inside a workspace. Installing there would scatter `.claude-plugin/` and `.claude/` assets
outside the workspace that owns them.

```bash
docko adapter claude-code install --root ./workspace
```

`docko init` allows this case. A nested workspace outside `slots/` is legitimate, so init scaffolds
one at the directory you named.

### REGISTRY_LOCK_TIMEOUT

Another process held `docko/.registry.lock/` for the full 10 second wait budget. The payload carries
`lock_dir`, `waited_ms`, the lock `owner` (`pid`, `hostname`, `acquired_at`), and `next_steps`.

A live holder re-stamps the lock every 10 seconds, and any caller treats a lock older than 30
seconds as abandoned and breaks it. So a timeout means either real contention or a holder that died
inside its own stale window.

```bash
docko status --root ./workspace --brief
```

Retry first. If the lock survives with no docko process running, delete `docko/.registry.lock/`.
Pollers that call `docko status` on a timer must back off after repeated timeouts rather than
retrying at the same rate.

### REGISTRY_LOCK_LOST

This command held the lock, ran past the 30 second stale window without its refresh timer getting a
turn, and another process broke the lock underneath it. A suspended machine and a process frozen in
a debugger both produce it.

Nothing was written. The check runs immediately before the registry write, so the registry is
exactly as it was.

```bash
docko status --root ./workspace --brief
```

Retry the command.

### ATOMIC_WRITE_FAILED

docko writes every file to a sibling temp file and renames it into place. The rename failed six
times with `EPERM`, `EBUSY`, `EACCES`, or `ENOTEMPTY`, which on Windows means another process holds
the destination open without share-delete.

```json
{
  "error": {
    "code": "ATOMIC_WRITE_FAILED",
    "message": "Failed to replace ...\\docko\\registry.json after 6 attempts (EPERM). Another process or a file scanner may be holding it open.",
    "file_path": "...\\docko\\registry.json",
    "attempts": 6,
    "cause_code": "EPERM"
  }
}
```

A real-time antivirus scanner is the usual holder. A read-only attribute on the destination produces
the same `EPERM`. Clear the attribute or exclude the workspace's `docko/` directory from real-time
scanning.

### CORRUPTED_REGISTRY

`docko/registry.json` either does not parse as JSON or does not satisfy the registry schema. docko
refuses every operation until it parses, because a partial read would hand out ownership answers it
cannot support.

```bash
docko render --root ./workspace
```

Restore `docko/registry.json` from version control or a backup, then run a read command to confirm
it validates. `docko/registry.md` is generated output and never a recovery source. See
[State files](state-files.md) for the shape the schema expects.

## Authorization reasons

`docko adapter claude-code pre-tool-use` answers every write with one reason from a closed set. Core
exports it as `AUTHORIZATION_REASONS`; `no-file-path` is added by the CLI when the hook payload
carries no path at all.

| Reason | Outcome | When |
| --- | --- | --- |
| `path-not-managed` | allowed | The path is outside every managed slot directory. |
| `owner` | allowed | The acting session owns the claim on the slot. |
| `delegated` | allowed | The acting session holds a `write` delegation on the claim. |
| `no-file-path` | allowed | The hook payload carries no file path to check. |
| `slot-not-claimed` | denied | The slot is free, or its directory name is not a valid resource id. |
| `claim-expired` | denied | The janitor released this session's own claim on the slot. |
| `unrelated-session` | denied | Another session owns the claim, or the delegation is `read`. |

An unregistered or ended session is answered, not rejected. It is evaluated as a session that owns
nothing, so a write inside `slots/` is denied with its natural reason and `session_known: false`.

Denied writes reach Claude Code as `permissionDecision: "deny"` with a reason string that names the
slot and the recovery command. [Use docko with Claude Code](claude-code.md) shows what the reader
sees for each one.

## Related

- [Troubleshooting](troubleshooting.md): symptom-first fixes that link back to these codes.
- [CLI reference](cli-reference.md): every command, option, and payload note.
- [Protocol](protocol.md): the rules these errors enforce.
- [State files](state-files.md): the on-disk shapes a corrupted registry violates.
