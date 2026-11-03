# Locado

**English | [简体中文](README.zh-CN.md)**

A local-first task manager with projects, tags, an Eisenhower matrix, habit tracking, focus sessions, and an installable offline PWA.

Built with Vite and TypeScript, without a UI framework. Your data stays in your browser and can be exported at any time.

[![CI](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml/badge.svg)](https://github.com/Maobuchiyugutou/locado/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/node.js-24%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

![Locado desktop application](docs/assets/locado-desktop.png)

## Highlights

- **Natural-language Quick Add**: capture dates, times, projects, tags, priorities, reminders, and repeat rules in one sentence; correct individual parsed details before creating the task.
- **Tasks, your way**: projects, tags, subtasks, notes, priorities, reminders, pinning, and independent important/urgent classification.
- **Recurring tasks**: daily, weekly, monthly, yearly, and after-completion rules, with the next occurrence created when the current one is completed.
- **Useful planning views**: Today, Next 7 Days, All, Completed, calendar, custom filters, and a drag-and-drop Eisenhower matrix.
- **Sustainable routines**: habit check-ins and a task-linked Pomodoro timer that restores running or paused sessions after a reload.
- **Local-first and offline-capable**: no account, telemetry, or backend required. Install the PWA and keep working offline.
- **Portable data**: JSON backup and restore, TickTick CSV import, and five rotating local backups with restore previews.
- **Desktop-focused interface**: light and dark themes, liquid-glass styling, keyboard navigation, and accessible dialogs.

**Reminder scope:** reminders are checked and delivered only while Locado is running. Closing the browser tab, PWA, or desktop window stops reminder checks; there is no background notification service.

## Desktop shell status

The Tauri 2 desktop shell is configured in `src-tauri` and reuses the existing frontend. Native build and per-platform acceptance work is still in progress; no Windows, macOS, or Linux installers have been published. See the [distribution plan](docs/distribution-plan.md) for the current status. The commands below run the browser/PWA version.

## Quick start

### One-command setup (recommended)

Clone the repository:

```bash
git clone https://github.com/Maobuchiyugutou/locado.git
cd locado
```

On Windows, double-click `scripts\run-windows.cmd` or run:

```bat
scripts\run-windows.cmd
```

On macOS:

```bash
bash scripts/run-macos.sh
```

On Linux:

```bash
bash scripts/run-linux.sh
```

The scripts check for Node.js 24, installing it through winget on Windows or a user-local nvm on macOS/Linux. They then run `npm ci`, build the production app, and open [http://localhost:1420](http://localhost:1420). Keep the terminal running and press `Ctrl+C` to stop. This Web/PWA mode does not require Rust or native build dependencies.

### Manual setup

With Node.js 24 or newer already installed:

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

Locado currently stores its snapshot in browser or Tauri WebView `localStorage`. No task data is sent to a server.

- Back up regularly with **Import / Export → Export JSON backup**. Automatic backups use the same local storage and do not replace an independently exported copy.
- Locado retains the latest five local backups, including pre-restore protection copies. The restore list previews each backup's timestamp and task/project/tag counts before you confirm replacement.
- Browser site data is isolated by origin. Keep using `http://localhost:1420` rather than switching between `localhost`, `127.0.0.1`, or different ports.
- Clearing site data or switching browsers can remove or hide your local snapshot. Export before doing either.

See the [完整中文 README](README.zh-CN.md), [Windows + WSL guide](docs/zh-CN.md), and [cross-platform distribution plan](docs/distribution-plan.md).

## Project structure

```text
src/                 Application, storage, parsing, and UI
public/              PWA manifest, service worker, and icons
tests/               Node.js regression tests
scripts/             Cross-platform launchers and WSL development scripts
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
