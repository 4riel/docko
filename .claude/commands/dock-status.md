---
description: Show current docko slot and resource state for this workspace
---

Show current `docko` slot and resource state for this workspace.

Use this first. Do not inspect every slot folder manually before checking the public docko status.

Run:

```bash
docko status --brief
```

`docko` walks up from the current directory to the workspace root, so this works from inside a slot too. Add `--root <workspace>` only when running from outside the workspace.

Useful variants:

- `docko status --brief --claimed` — only the claimed resources.
- `docko status --brief --application <id>` — only one application's slots.

Summarize from the `summary` block:

- free and claimed slot counts (per application when the workspace has several)
- `my_claims`: the slots this session already owns
- `stale_candidates`: claims that are about to be reclaimed, with the owner's last heartbeat
