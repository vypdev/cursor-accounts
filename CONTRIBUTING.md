# Contributing to Cursor Accounts

Thank you for contributing. This guide covers local setup, project layout, testing, and pull requests.

## Prerequisites

- [Node.js 22](https://nodejs.org/) — `nvm use` (see [.nvmrc](.nvmrc))
- [pnpm 10](https://pnpm.io/) — `corepack enable` or install globally
- [Cursor](https://cursor.com/) or VS Code for Extension Development Host (F5)

Use **pnpm only** in this repo. Do not mix `npm install` with `pnpm-lock.yaml`.

## Getting started

```bash
nvm use 22
pnpm install
pnpm run compile
```

Run the extension:

1. Open the repo in Cursor/VS Code
2. Press **F5** to launch an Extension Development Host
3. Status bar quota and the **Accounts** sidebar should appear after startup

Useful scripts:

| Command | Purpose |
|---------|---------|
| `pnpm run watch` | Recompile extension TypeScript on save |
| `pnpm run watch:webview` | Rebuild Accounts panel webview on save |
| `pnpm test` | Run unit tests (`pretest` compiles first) |
| `pnpm run test:types-sync` | Validate webview ↔ shared types alignment |
| `pnpm run lint` | Typecheck + ESLint (includes layer boundary rules) |
| `pnpm run validate:l10n` | Ensure all `locales/*.json` keys match `en.json` |
| `pnpm run package` | Build a `.vsix` for local install |

## Project structure

```
cursor-usage/
├── packages/types/      # @cursor-accounts/types — shared entities, rules, contracts
├── src/                 # Extension host (TypeScript)
│   ├── extension.ts     # Composition root: activate, wiring, commands
│   ├── domain/          # Ports + re-exports from shared types
│   ├── api/             # HTTP clients and DTO mappers for Cursor APIs
│   ├── auth/            # Tokens, SQLite state.vscdb, refresh, ProfileAuthReader
│   ├── profiles/        # Multi-profile CRUD, launch, detection
│   ├── services/        # Refresh and multi-profile quota polling
│   ├── validation/      # Zod schemas for API responses
│   ├── migrations/      # Legacy cursor-quota migration
│   ├── ui/              # Status bar, Accounts webview provider
│   ├── modelEfficiency/ # Composer polling + @cursor/sdk analysis
│   ├── commands/        # VS Code command handlers
│   ├── l10n/            # Runtime i18n
│   └── test/            # Unit tests (Node test runner)
├── webview/             # React UI for Accounts panel
├── locales/             # UI strings (25+ languages)
├── docs/                # Design and architecture docs
├── scripts/             # Build, l10n validation, type-sync, debug tools
└── bin/                 # Prebuilt SQLite binaries per platform
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module relationships and data flows.

## Code style

- **TypeScript strict mode** — keep `strict`, `noUnusedLocals`, and `noImplicitReturns` passing
- **Naming** — `cursorAccounts.*` for settings/commands; use **profile** in code, **account** in user-facing UI where it reads more naturally
- **Paths** — use `src/utils/pathUtils.ts` (`pathsEqual`, `validateUserDataPath`) for profile directory comparison; do not compare raw `path.normalize()` results
- **Logging** — use `src/logging/extensionLog.ts`; avoid `console.log` in `src/`
- **i18n** — add keys to `locales/en.json` first, then run `pnpm run validate:l10n` and update other locale files (or use the project’s l10n workflow)
- **Secrets** — never store tokens in `~/.cursor-accounts/config.json`; read `state.vscdb` read-only; persist refreshed tokens in VS Code Secret Storage only

## Testing

```bash
pnpm test
```

Tests live under `src/test/` and run against compiled output in `out/test/`. Prefer testing pure functions (mappers, parsers, path utils) with the Node.js built-in test runner.

When changing shared types or webview message protocols, update `packages/types/src/` (entities, rules, or `contracts/webviewMessages.ts`), then run `pnpm run test:types-sync` and add or extend tests in `src/test/accountsPanel.test.ts` where applicable.

Manual checks for profile/multi-window work:

- Create a profile and launch with `--user-data-dir`
- Open Accounts panel and confirm quotas refresh for multiple profiles
- Verify status bar shows the active profile when configured

## Pull requests

1. Branch from `main` (or the repo’s default branch)
2. Keep changes focused; split large features if possible
3. Run `pnpm run lint`, `pnpm test`, and `pnpm run validate:l10n` when touching strings
4. Update user-facing docs (`README.md`) or design docs (`docs/`) when behavior changes
5. Open a PR using [.github/pull_request_template.md](.github/pull_request_template.md)

Release notes for published versions are maintained in [CHANGELOG.md](CHANGELOG.md) and GitHub Releases workflows.

## Documentation map

| Document | Audience |
|----------|----------|
| [README.md](README.md) | End users: install, settings, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Contributors: structure, flows, decisions |
| [docs/FEATURE-MULTI-PROFILE.md](docs/FEATURE-MULTI-PROFILE.md) | Product/design: multi-profile feature |
| [docs/RESEARCH.md](docs/RESEARCH.md) | APIs, quotas, account-switching constraints |

## Questions

Open a [GitHub issue](https://github.com/vypdev/cursor-usage/issues) using the appropriate template (bug, feature, doc update, or help).
