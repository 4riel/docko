# Workspace layout

This page shows a workspace root after `docko init`, an application slot pool, and a Claude Code
install, so you can recognize your own.

## A populated workspace

The tree below is that workspace after two sessions have claimed and released slots.

```text
workspace/
|-- README.md
|-- AGENTS.md
|-- CLAUDE.md
|-- .claude/
|   |-- commands/
|   |-- skills/
|   |-- snippets/
|   |-- settings.docko.json
|   `-- settings.local.json
|-- .claude-plugin/
|   `-- docko/
|       |-- plugin.json
|       |-- hooks/
|       `-- scripts/
|-- docs/
|-- plans/
|-- docko/
|   |-- registry.json
|   |-- registry.md
|   |-- sessions/
|   |   |-- <session-id>.json      <- one manifest per active session
|   |   `-- ended/                 <- ended sessions, kept for the retention window
|   `-- logs/
|       `-- YYYY-MM-DD.jsonl
`-- slots/
    |-- main/                      <- flat slot, no application
    |-- backend/
    |   |-- main_1/                <- application slot: resource id backend.main_1
    |   `-- main_2/
    `-- frontend/
        `-- main/
```

## What docko creates

- `docko init` always creates `docko/` and `slots/`. It adds a starter `slots/main` only when you
  pass no `--slot` and `slots/` is empty; existing slot directories are adopted instead.
- `docko app ensure --id backend ...` adds `slots/backend/` and its seeded slot directories; it
  also registers the application in `docko/registry.json`.
- `docko adapter claude-code install` (or `docko init --claude`) adds `.claude/`,
  `.claude-plugin/`, and the `CLAUDE.md` and `AGENTS.md` snippets under `.claude/snippets/`. See
  [Use docko with Claude Code](../docs/claude-code.md) for what each file does.
- `docko init` writes `docko/registry.json`, `docko/registry.md`, `docko/sessions/`, and the first
  `docko/logs/YYYY-MM-DD.jsonl` immediately. Session manifests under `docko/sessions/` appear as
  sessions start.

## What your workflow adds

`README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/`, and `plans/` are not written by docko. They are
ordinary root-level files your own workflow keeps beside the managed directories. docko never reads
or writes them except to append the `CLAUDE.md` and `AGENTS.md` snippets when you ask it to during
`init`.

## Related

- [State files](../docs/state-files.md): field-by-field detail for every file under `docko/`.
- [Concepts](../docs/concepts.md): what a workspace root, slot, and application are.
- [Quickstart](../docs/quickstart.md): build this tree from an empty directory.
