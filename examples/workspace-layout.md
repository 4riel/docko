# Example Workspace Layout

```text
workspace/
|-- README.md
|-- AGENTS.md
|-- CLAUDE.md
|-- .agents/
|   `-- skills/
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
|   |-- INDEX.md
|   |-- concepts.md
|   `-- protocol.md
|-- plans/
|-- investigations/
|-- docko/
|   |-- registry.json
|   |-- registry.md
|   |-- sessions/
|   `-- logs/
`-- slots/
    |-- app-alpha/
    |-- app-beta/
    `-- app-gamma/
```

Notes:

- `docko init` always bootstraps `docko/` plus `slots/`. The extra root folders are workflow-specific.
- `.claude/` and `.claude-plugin/` exist only when you install the Claude Code adapter.
- `AGENTS.md` and repo-local skills are the main Docko integration points for Codex today.
- Docko does not currently generate a `.codex/` adapter bundle.
