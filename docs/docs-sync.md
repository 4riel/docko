# Commands, Skills, And Docs Sync

## Goal

Public adopters need a clean way to keep Claude-facing docs in sync with the protocol core.

## Recommended Rule

The protocol docs and schemas are authoritative. Claude commands, skills, and runtime guidance should be generated or reviewed against them, not maintained as separate truth systems.

## Cross-Platform Docs Rule

- prefer shell-neutral command examples by default
- split examples by shell only when syntax truly differs, such as directory creation or environment-variable assignment
- for public adopter docs, prefer `npm install --global docko-workspace@alpha` before the first `docko init` example until `latest` is intentionally promoted
- keep `npx` and source-checkout flows as secondary alternatives when they are useful
- treat PowerShell, `cmd.exe`, macOS, and Linux users as first-class readers, not appendix cases
- keep runtime snippets focused on the public CLI and protocol, not shell-specific quoting tricks

## Maintained Surfaces

- protocol reference
- CLI reference
- Claude command docs
- Claude skill docs
- `AGENTS.md` team guidance
- workspace setup examples

## Practical Updater Concepts

- a `docko docs render` command can rebuild `registry.md` and adapter-facing reference snippets
- a `docko docs check` command can detect drift between CLI commands and command docs
- a `docko docs scaffold claude-code` command can write example command and skill files into adopter repos

## Example Claude-Facing Files

- `.claude/commands/dock-status.md`
- `.claude/commands/dock-claim.md`
- `.claude/commands/dock-release.md`
- `.claude/skills/workspace-orchestration/SKILL.md`
- `.claude/snippets/CLAUDE.docko.md`
- `AGENTS.md`

## What To Keep Stable

- command names should stay thin wrappers over the public CLI
- skills should explain operating rules, not embed protocol logic
- team guidance should reference parent/child delegation semantics explicitly
