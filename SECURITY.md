# Security Policy

## Supported versions

Security fixes are applied to the `main` branch. There is currently no long-term support branch for older releases.

## Report a vulnerability

Please use a [private GitHub Security Advisory](https://github.com/Maobuchiyugutou/locado/security/advisories/new) rather than opening a public issue.

Include:

- A description of the issue and its potential impact
- Reproduction steps or a small proof of concept
- Affected browser, operating system, and commit
- Any suggested mitigation, if available

Reports are reviewed on a best-effort basis. Do not include credentials, personal backups, or real task data in a report.

## Local data notes

Locado stores task data in browser `localStorage`; it does not send that data to a backend. Anyone with access to the same browser profile and origin may be able to read the snapshot.

Export backups only to trusted locations. Shared computers should use separate operating-system or browser profiles.
