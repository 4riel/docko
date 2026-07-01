# Security Policy

## Supported Versions

`docko-workspace` is in **alpha**. Only the latest release published under the
`@alpha` tag on npm receives security fixes.

| Version | Supported |
| --- | --- |
| Latest `docko-workspace@alpha` | Yes |
| Any older or unpublished build | No |

Because the project is pre-1.0, releases may include breaking changes. Always
upgrade to the latest `@alpha` before reporting an issue.

## Reporting a Vulnerability

Please report security vulnerabilities privately through GitHub's built-in
private vulnerability reporting rather than opening a public issue or pull
request:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** to open a private advisory.

Direct link: <https://github.com/4riel/docko/security/advisories/new>

Include enough detail to reproduce the problem: the affected version, the
`docko` command and options involved, the workspace state, and the observed
versus expected behavior. You will receive a response acknowledging the report,
and any confirmed fix will ship in a subsequent `@alpha` release.

Please do not disclose the issue publicly until a fix has been released.

## Scope Note: The Lock Protocol Is Not a Security Boundary

docko coordinates writable slots, session ownership, delegation, and stale
recovery so that multiple cooperating agents do not clobber each other inside a
shared workspace root. The directory-based registry lock (`docko/.registry.lock/`)
and the ownership checks around claims and delegation are **operational controls
for cooperating processes**, not a trust or access-control boundary.

They assume all participants run with the same local filesystem privileges and
are acting in good faith. They do not sandbox untrusted code, defend against a
malicious local actor, or prevent a process that can already write to the
workspace from bypassing coordination. Do not rely on docko to isolate or
contain untrusted agents.

Reports about the coordination model behaving incorrectly for cooperating agents
(for example, a claim being granted to the wrong owner, or stale recovery
releasing a live slot) are welcome as functional issues via the tracker.
