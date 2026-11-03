# Contributing to Locado

Thanks for helping improve Locado. Preserve local-first behavior and avoid adding unnecessary dependencies.

## Workflow

1. Start with an [existing issue](https://github.com/Maobuchiyugutou/locado/issues), or open a feature request before making a large behavior change.
2. Fork the repository and create a focused branch for your change.
3. Make the change with appropriate regression coverage and documentation updates.
4. Open a pull request, link the related issue, and complete the checklist.

## Set up

Use Node.js 24 or newer:

```bash
npm ci
npm test
npm run build
```

For the Windows + WSL workflow, see [docs/zh-CN.md](docs/zh-CN.md).

## Before opening a pull request

- Run `npm test` and `npm run build`.
- Add regression coverage for parsing, storage, or import changes.
- Preserve compatibility with existing snapshots. New task fields should have safe defaults or fallback behavior.
- Keep UI changes consistent with the existing desktop-focused light and dark themes.
- Test keyboard navigation and dialogs when changing interactive controls.
- Do not include personal backups, user data, credentials, editor-specific settings, or generated build output.
- Update documentation when commands, storage behavior, or user-facing features change.

Use clear commits such as `feat: add ...`, `fix: prevent ...`, `test: cover ...`, or `docs: clarify ...`.

## Reporting issues

Use the bug report or feature request form. Include reproduction steps, expected and actual behavior, browser and operating system details, and console errors where relevant.

Never attach a real Locado backup containing personal tasks. Create a small anonymized example instead.

## Security

Do not disclose vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md).
