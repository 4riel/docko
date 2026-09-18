# Quickstart

Create a workspace root, claim a slot, and release it, using the CLI directly. Use this page to
evaluate docko or to script it without a runtime adapter.

## Before you begin

docko needs Node 22 or later. Install the CLI:

```bash
npm install --global docko-workspace@alpha
```

To run docko without installing it, replace `docko` with the package runner in every command on
this page:

```bash
npx --yes --package docko-workspace@alpha docko status --root ./workspace
```

Output on this page comes from real runs, trimmed to the fields the text discusses.
`<workspace-root>` stands in for the absolute path docko resolved.

## Step 1: Create a workspace

`docko init` creates the workspace root, scaffolds `slots/`, and writes the registry. Run it once
per workspace root.

```bash
docko init --root ./workspace
```

```json
{
  "ok": true,
  "mode": "workspace",
  "created_directories": ["slots", "slots/main"],
  "starter_slots": ["main"]
}
```

The run leaves this tree behind:

```text
workspace/
|-- slots/main/   <- the starter slot, free and claimable
`-- docko/        <- registry.json, registry.md, sessions/, logs/
```

In a terminal, `init` runs a guided flow that asks about runtimes, guidance files, and starter slots
before it writes anything. Every answer has a flag too, so a script skips the flow. The
[CLI reference](cli-reference.md#docko-init) lists them.

## Step 2: Check the workspace

`docko status` reads the registry, runs stale recovery, and returns every resource with a summary.
Run it before you claim anything.

```bash
docko status --root ./workspace
```

```json
{
  "resources": [
    { "resource_type": "slot", "resource_id": "main", "path": "slots/main", "status": "free", "claim": null }
  ],
  "janitor": { "released_claims": [], "ended_sessions": [], "deleted_manifests": 0 },
  "resolved_root": "<workspace-root>",
  "summary": {
    "slots": { "total": 1, "free": 1, "claimed": 0 },
    "session_id": null,
    "my_claims": [],
    "stale_candidates": []
  }
}
```

Three fields carry the state you act on. `summary.slots` counts free and claimed slots,
`summary.my_claims` lists the slots the acting session owns, and `janitor.released_claims` names the
claims stale recovery released during this read. `summary.session_id` is `null` because no session
is active yet, and step 3 starts one.

## Step 3: Claim a slot

A claim belongs to a session, so start a session first. Then let docko pick the slot: `slot acquire`
takes the next free slot in rotation, so you do not have to know which one is free.

```bash
docko session start --root ./workspace --session quickstart --runtime shell
docko slot acquire --root ./workspace --session quickstart --branch docs/quickstart --task "try docko" --brief
```

```json
{"ok":true,"action":"claimed-existing-slot","session_id":"quickstart","slot_id":"main","slot_path":"<workspace-root>/slots/main","availability":{"total_slots":1,"free_slots_before":1,"claimed_slots_before":0,"pinned_slot_count":0},"clone":null}
```

Do the work inside `slot_path`. `branch` and `task` are claim metadata: docko records them and never
runs `git checkout`. `--brief` returns the compact one-line payload above, which is what a script or
an agent reads. Reach for `docko claim` instead when you already know the exact slot you want.

## Step 4: Release the slot

Releasing returns the slot to the pool, and ending the session releases whatever it still holds.

```bash
docko release --root ./workspace --session quickstart --resource slot --id main --reason "quickstart done" --brief
docko session end --root ./workspace --session quickstart
```

```json
{"ok":true,"released":true,"resource_type":"slot","resource_id":"main","released_by_session_id":"quickstart","previous_owner_session_id":"quickstart","forced_by_session_id":null,"release_reason":"quickstart done"}
```

`session end` answers `{ "ok": true, "released": true, "session_id": "quickstart" }`. Run it at
shutdown even when you released by hand, so a forgotten claim never blocks the next session.

## Run it from a source checkout

Use `node ./bin/docko.js` after a build to run an unreleased change against a workspace.

```bash
git clone https://github.com/4riel/docko.git
cd docko
corepack enable
pnpm install
pnpm build
node ./bin/docko.js status --root ./workspace
```

`--root` still points at the workspace you manage, which does not have to live inside the checkout.

## Next steps

- [Use docko with Claude Code](claude-code.md): install the plugin and let hooks run these commands.
- [Codex and other AGENTS.md runtimes](agents-md-runtimes.md): guidance-based setup without hooks.
- [Application slot pools](applications.md): give backend and frontend their own slot pools.
- [CLI reference](cli-reference.md): every command, option, and payload field.
- [Troubleshooting](troubleshooting.md): symptom-first fixes for sessions, claims, and locks.
