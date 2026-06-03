# Changelog

All notable changes to **Cursor Accounts** (`vypdev.cursor-accounts`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

For older release notes entered only in GitHub Actions workflows, see [GitHub Releases](https://github.com/vypdev/cursor-accounts/releases).

## [Unreleased]

### Changed
- Architecture audit: dependency injection fixes, profile domain ports, command module split, coverage reporting, and expanded tests.

## [0.1.33] - 2026-06-02

### Changed
- Version bump and compilation script updates for multi-platform VSIX builds.

## [0.1.32] - 2026-06-01

### Added
- Recent project opening and workspace-open checks in the Accounts panel.

### Changed
- Workspace handling and webview API refinements.

## [0.1.31] - 2026-05-31

### Added
- GitHub integration and profile enrichment in the Accounts panel.

### Changed
- Profile card project-open state handling.

## [0.1.30] - 2026-05-30

### Added
- Project status in profile cards and workspace management localization.

## [0.1.29] - 2026-05-30

### Changed
- VSIX packaging and extension icon references.

## [0.1.28] - 2026-05-29

### Added
- Accounts panel init/refresh tests when the panel is visible.

## [0.1.27] - 2026-05-29

### Changed
- VSIX packaging pipeline and dependency updates.

## [0.1.26] - 2026-05-28

### Changed
- Build process and shared utilities package (`@cursor-accounts/shared`).

## [0.1.25] - 2026-05-28

### Changed
- Quota client refactor and usage-merge test coverage.

## [0.1.24] - 2026-05-27

### Added
- Storage management in the Accounts panel (breakdown, cleanup actions).
- Documentation and localization for file management features.

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

[Unreleased]: https://github.com/vypdev/cursor-accounts/compare/v0.1.33...HEAD
[0.1.33]: https://github.com/vypdev/cursor-accounts/releases
[0.1.32]: https://github.com/vypdev/cursor-accounts/releases
[0.1.31]: https://github.com/vypdev/cursor-accounts/releases
[0.1.30]: https://github.com/vypdev/cursor-accounts/releases
[0.1.29]: https://github.com/vypdev/cursor-accounts/releases
[0.1.28]: https://github.com/vypdev/cursor-accounts/releases
[0.1.27]: https://github.com/vypdev/cursor-accounts/releases
[0.1.26]: https://github.com/vypdev/cursor-accounts/releases
[0.1.25]: https://github.com/vypdev/cursor-accounts/releases
[0.1.24]: https://github.com/vypdev/cursor-accounts/releases
[0.1.23]: https://github.com/vypdev/cursor-accounts/releases
[0.1.22]: https://github.com/vypdev/cursor-accounts/releases
[0.1.21]: https://github.com/vypdev/cursor-accounts/releases
[0.1.20]: https://github.com/vypdev/cursor-accounts/releases
[0.1.x]: https://github.com/vypdev/cursor-accounts/releases
[0.1.0]: https://github.com/vypdev/cursor-accounts/releases
