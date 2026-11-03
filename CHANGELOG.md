# Changelog

Notable changes to Locado are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-03

### Added

- Natural-language Quick Add for dates, times, projects, tags, priorities, reminders, and repeat rules, with per-field corrections.
- Daily, weekly, monthly, yearly, and after-completion recurring tasks with linked next occurrences.
- Five rotating local backups, pre-restore protection copies, and restore previews with timestamps and task/project/tag counts.
- Tauri 2 desktop shell configuration and Linux native build checks; no native installers have been published.
- Windows, macOS, and Linux one-command Web/PWA setup scripts with Node.js checks and automatic browser launch.
- Public-repository documentation, application screenshot, issue forms, and pull request checklist.
- Full Chinese README and source-distribution/native-status documentation.
- GitHub Actions for automated tests and production builds.
- MIT license, repository metadata, and structured development scripts.

### Changed

- Reorganize bilingual documentation around quick start, source distribution, native status, and focused contribution workflows.
- Coordinate snapshot mutations with queued writes, Web Locks when available, and fresh reads to reduce stale cross-tab overwrites.
- Surface persistence failures and reload saved state instead of leaving unsaved edits presented as successfully stored.
- Validate backup structure and record IDs before restore, and flush pending edits and create protection copies before JSON restore or CSV import.
- Claim reminders through persistent storage and preserve reminder state during unrelated task edits to avoid duplicate delivery.
- Persist running and paused focus sessions across reloads, including task links and stable completion record IDs.
- Check reminders immediately at startup, summarize expired missed reminders in the app, and explain notification permission failures.
- Standardize all-day tasks at 09:00 local time and keep later conflicting date text when Quick Add uses the first valid date.

### Fixed

- Use Node.js 24 explicitly in WSL launchers and stop on setup failures instead of falling back to Windows npm.
- Prevent stale pending edits from recreating tasks deleted in another tab.
- Keep backup timestamps strictly increasing so rapid backups retain a deterministic newest-first order.

## [0.1.0] - 2026-10-29

### Added

- Projects, tags, subtasks, reminders, priorities, and independent important/urgent classification.
- Smart task views, calendar, custom filters, and an Eisenhower matrix.
- Habit tracking and task-linked focus sessions.
- Light and dark liquid-glass desktop interface with keyboard-accessible controls.
- Installable offline PWA with precached application assets.
- JSON backup and restore, plus TickTick CSV import.
- Snapshot validation, corrupted-data backup, storage error reporting, and multi-tab synchronization.
- Node.js regression tests for parsing, imports, and local storage.
