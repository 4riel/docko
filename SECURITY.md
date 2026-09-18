# Security policy

`docko-workspace` is in alpha. This page covers supported versions, how to report a vulnerability,
and what the coordination model does and does not protect against.

## Supported versions

Only the latest release published under the `alpha` tag on npm receives security fixes.

| Version | Supported |
| --- | --- |
| Latest `docko-workspace@alpha` | Yes |
| Any older or unpublished build | No |

The project is pre-1.0. Releases may include breaking changes. Upgrade to the latest `alpha` release
before you report an issue.

## Report a vulnerability

Report a security vulnerability privately through GitHub's private vulnerability reporting instead
of opening a public issue or pull request.

1. Go to the repository's Security tab.
2. Choose Report a vulnerability to open a private advisory.

Direct link: [Open a private advisory](https://github.com/4riel/docko/security/advisories/new)

Include enough detail to reproduce the problem: the affected version, the `docko` command and
options involved, the workspace state, and the observed versus expected behavior. You receive an
acknowledgment, and a confirmed fix ships in a later `alpha` release. Do not disclose the issue
publicly until a fix has been released.

## Scope: coordination is not a security boundary

docko coordinates writable slots, session ownership, delegation, and stale recovery so that multiple
cooperating agents do not overwrite each other inside a shared workspace root. The registry lock
(`docko/.registry.lock/`) and the ownership checks around claims and delegation are operational
controls for cooperating processes. They are not a trust or access-control boundary.

They assume every participant runs with the same local filesystem privileges and acts in good faith.
They do not sandbox untrusted code, defend against a malicious local actor, or stop a process that
can already write to the workspace from bypassing coordination. Do not rely on docko to isolate or
contain untrusted agents.

## Functional issues

Report the coordination model behaving incorrectly for cooperating agents, for example a claim
granted to the wrong owner, or stale recovery releasing a live slot, as a functional issue through
the issue tracker rather than a private security advisory.
