# BaseSeer security

Report suspected vulnerabilities through the owner's existing private channel. Include the package version, trusted archive SHA-256, host versions and a minimal synthetic reproduction. Keep original evidence local; share only reviewed, redacted excerpts. No public reporting contact or response-time commitment is established.

## Boundaries

- DSH owns authentication, provider accounts and transport. Preserve its credential stores; BaseSeer does not protect against a compromised host or malicious installed plugin.
- Source inspection does not execute inspected project scripts. Model requests may send selected source and plan context to the configured provider.
- Repository text and model output are untrusted. A Planning chat's planner runs DSH's shell and file tools under the permissions chosen for that chat: it is told to look and leave the code to the build, and only those permissions enforce it. A build runs only when the owner types `/baseseer build` in a Planning chat. Its lead and subagents are ordinary DSH coding agents working in the project folder with DSH's full access while it runs. BaseSeer does not sandbox hostile programs.
- A project's `.baseseer/` folder and the acceptance check's copies can contain private source and history. Protect them locally.
- Verify private archives against a separately trusted digest. Hashes detect corruption; they do not authenticate an unknown sender.

Never share credentials, OAuth stores, token-bearing URLs or unreviewed logs. Review dependency advisories, distribution contents and third-party obligations before wider distribution.
