# Changelog

All notable changes to **Cursor Accounts** (`vypdev.cursor-accounts`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

For older release notes entered only in GitHub Actions workflows, see [GitHub Releases](https://github.com/vypdev/cursor-usage/releases).

## [Unreleased]

### Changed
- Documentation audit: removed obsolete implementation-phase specs; added `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/ARCHITECTURE.md`.

## [0.1.23] - 2026-05-29

### Added
- Account selection improvements and status bar localization updates.

## [0.1.22] - 2026-05

### Added
- Broad localization support across extension and Accounts panel.
- Enhanced quota management and user feedback.

### Changed
- Package management and CI workflow updates.

## [0.1.21] - 2026-05

### Added
- Model efficiency analysis: Composer `state.vscdb` polling, `@cursor/sdk` scoring, output channel and per-profile toggle.

## [0.1.20] - 2026-05

### Added
- Analytics team leaderboard in Accounts panel (enterprise, session cookie API).

## [0.1.x] - 2026-05

### Added
- Multi-profile management: `ProfileManager`, launcher, instance detection, export/import.
- Accounts sidebar webview (React).
- Multi-profile quota service (parallel fetch per profile).
- Profile commands and status bar profile indicator.
- SQLite binary bundling for all supported platforms (macOS, Linux, Windows; x64 and arm64).

### Changed
- Extension renamed from **Cursor Quota** (`vypdev.cursor-quota`) to **Cursor Accounts** (`vypdev.cursor-accounts`).
- Automatic migration of `cursorQuota.*` settings and secrets on first activation.

## [0.1.0] - Initial

### Added
- Status bar quota display for Cursor plans (API/auto mode, enterprise monthly spend).
- Token read from local `state.vscdb`, refresh via OAuth, polling with cache and backoff.
- Research-backed API usage documented in `docs/RESEARCH.md`.

[Unreleased]: https://github.com/vypdev/cursor-usage/compare/v0.1.23...HEAD
[0.1.23]: https://github.com/vypdev/cursor-usage/releases
[0.1.22]: https://github.com/vypdev/cursor-usage/releases
[0.1.21]: https://github.com/vypdev/cursor-usage/releases
[0.1.20]: https://github.com/vypdev/cursor-usage/releases
[0.1.x]: https://github.com/vypdev/cursor-usage/releases
[0.1.0]: https://github.com/vypdev/cursor-usage/releases
