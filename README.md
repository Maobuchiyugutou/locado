# Locado

**English | [简体中文](README.zh-CN.md)**

A local-first task manager with projects, tags, an Eisenhower matrix, habit tracking, focus sessions, and an installable offline PWA.

Built with Vite and TypeScript, without a UI framework. Your data stays in your browser and can be exported at any time.

[![CI](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml/badge.svg)](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

![Locado desktop application](docs/assets/locado-desktop.png)

## Highlights

- **Tasks, your way**: projects, tags, subtasks, notes, priorities, reminders, pinning, and independent important/urgent classification.
- **Useful planning views**: Today, Next 7 Days, All, Completed, calendar, custom filters, and a drag-and-drop Eisenhower matrix.
- **Sustainable routines**: habit check-ins and a Pomodoro-style focus timer linked to tasks.
- **Local-first and offline-capable**: no account, telemetry, or backend required. Install the PWA and keep working offline.
- **Portable data**: JSON backup and restore, plus TickTick CSV import.
- **Desktop-focused interface**: light and dark themes, liquid-glass styling, keyboard navigation, and accessible dialogs.

## Quick start

### Requirements

- Node.js 24 or newer
- npm

```bash
npm ci
npm run dev
```

Open [http://localhost:1420](http://localhost:1420).

### Production build

```bash
npm run build
npm run preview -- --port 1420 --strictPort
```

### Tests

```bash
npm test
npm run build
```

The test suite covers natural-language dates, CSV imports, snapshot compatibility, local storage, focus-record idempotency, and corrupted-data recovery.

## Your data

Locado currently stores its snapshot in browser `localStorage`. No task data is sent to a server.

- Back up regularly with **Import / Export → Export JSON backup**.
- Browser site data is isolated by origin. Keep using `http://localhost:1420` rather than switching between `localhost`, `127.0.0.1`, or different ports.
- Clearing site data or switching browsers can remove or hide your local snapshot. Export before doing either.

See the [完整中文 README](README.zh-CN.md), [Windows + WSL guide](docs/zh-CN.md), and [cross-platform distribution plan](docs/distribution-plan.md).

## Project structure

```text
src/                 Application, storage, parsing, and UI
public/              PWA manifest, service worker, and icons
tests/               Node.js regression tests
scripts/             Windows + WSL development scripts
docs/                Guides and application screenshots
.github/             CI, issue forms, and pull request template
```

## Roadmap

- [Cross-platform Tauri installers and release pipeline](docs/distribution-plan.md)
- Tauri + SQLite storage adapter
- Mobile navigation and narrow-screen layouts
- Repeatable browser end-to-end tests
- Additional import and export options

## Community

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © 2026 Maobuchiyugutou
