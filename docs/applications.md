# Application slot pools

An application gives one part of your workspace, such as a backend or a frontend, its own named
slot pool. Use it when one workspace root manages more than one codebase and slots should not mix.

## Before you begin

This guide assumes an initialized workspace. See [quickstart](quickstart.md) if you have not run
`docko init` yet. Examples use `--root ./workspace` and omit `--session`; add your session id or
run from inside a Claude Code session where docko resolves it for you.

## Register an application

`docko app ensure` registers an application and returns it in every later `docko status` call.

```bash
docko app ensure --root ./workspace --id backend --name Backend --description "Backend API service" --keyword backend --keyword api
```

```json
{
  "ok": true,
  "application": {
    "application_id": "backend",
    "name": "Backend",
    "description": "Backend API service",
    "keywords": ["backend", "api"],
    "source_path": null
  }
}
```

`--keyword` is repeatable. `docko status` lists every registered application with its own
`free`/`claimed` slot counts, separate from the flat, application-less slot pool.

## Seed the slot pool

Seed slots the same command creates the application with, or on a later call. Three ways to seed:

- `--slots <n> --slot-base <id>`: creates `<id>_1` through `<id>_n` as empty directories.
- `--slot <id>` (repeatable): creates one directory per named id instead of a numbered range.
- `--source <path>`: duplicates that path into each seeded slot instead of creating it empty.

```bash
docko app ensure --root ./workspace --id backend --slots 2 --slot-base main
```

```json
{
  "created_directories": ["slots/backend", "slots/backend/main_1", "slots/backend/main_2"],
  "discovered_slots": ["backend.main_1", "backend.main_2"]
}
```

Application slots live at `slots/<application-id>/<slot-name>` and carry the resource id
`<application-id>.<slot-name>`. Combine `--source` with `--slots` or `--slot` to seed every new slot
from one repo:

```bash
docko app ensure --root ./workspace --id mobile --source ./seed-repo --slots 1 --slot-base main
```

```json
{
  "duplicated_slots": [
    { "slot_id": "mobile.main", "slot_name": "main", "application_id": "mobile" }
  ],
  "discovered_slots": ["mobile.main"]
}
```

## Acquire a slot in one pool

Pass `--application` to restrict `docko slot acquire` to one pool:

```bash
docko slot acquire --root ./workspace --application backend --branch feat/api --task "update backend auth" --brief
```

```json
{
  "ok": true,
  "action": "claimed-existing-slot",
  "slot_id": "backend.main_1",
  "application_id": "backend",
  "slot_name": "main_1"
}
```

You can also omit `--application` and let docko infer it. It matches your `--task` and `--branch`
text against each application's `keywords`, `application_id`, and `name`. The task text
"update backend auth" matches the `backend` application above through its `backend` keyword. When
two applications score the same match, `slot acquire` fails with `AMBIGUOUS_APPLICATION`: pass
`--application` explicitly to resolve it.

## Pin a slot out of rotation

`slot acquire` picks slots by round-robin inside the selected pool. Pin one out of that rotation
with `docko resource ensure --no-auto-acquire`. A pinned slot stays claimable by name; round-robin
never selects it on its own.

```bash
docko resource ensure --root ./workspace --resource slot --id backend.main_2 --no-auto-acquire
```

```json
{
  "resource_type": "slot",
  "resource_id": "backend.main_2",
  "status": "free",
  "auto_acquire": false
}
```

`slot acquire` skips `backend.main_2` from then on. Reach it directly with `--prefer`:

```bash
docko slot acquire --root ./workspace --application backend --prefer backend.main_2 --branch feat/y --task "prefer pinned" --brief
```

Pass `--auto-acquire` to a later `resource ensure` call to put the slot back into rotation.

## Next steps

- [Delegate a slot to a teammate](delegation.md): give a second session write access inside a
  claimed application slot.
- [CLI reference](cli-reference.md): every `app ensure`, `slot acquire`, and `resource ensure`
  option.
- [State files](state-files.md): the application and resource fields the registry persists.

## Related

- [Concepts](concepts.md)
- [Protocol](protocol.md)
