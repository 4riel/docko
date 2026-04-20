# Why Not Just Worktrees?

Git worktrees are good. For many repos they are the better default.

`docko` exists for a different operating model:

- one stable workspace root
- coordination artifacts at the root when the team needs them
- multiple persistent full clones under `slots/`
- agent sessions coordinating against those slots

## When Worktrees Are A Better Fit

- you mainly need cheap parallel branch checkouts
- you do not need a shared workspace hub
- local setup is light and easy to recreate
- long-lived per-slot state is not important

## When Persistent Slots Are Easier

- long-running local servers are tied to a stable directory
- per-slot env files or local config differ
- framework caches and native build artifacts are expensive to rebuild
- IDE state, ports, or local tools are coupled to a full directory
- teams want warm slots that stay ready between sessions

That is the case `docko` serves.

## The Actual Tradeoff

Worktrees usually win on disk efficiency and fast branch fan-out.

Persistent slots usually win when operational stability matters more than minimal checkout cost:

- the path stays stable
- caches stay warm
- local state survives across sessions
- the workspace root becomes a shared coordination surface

`docko` is not a universal replacement for worktrees. It is a better fit for the persistent-clone workflow.
