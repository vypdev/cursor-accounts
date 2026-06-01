# Cursor Accounts

Cursor extension that shows **plan quota usage** in the IDE status bar after activation—no need to open **Settings** manually.

## What it does

- Shows plan quota in the status bar — averaged **API mode** and **auto mode** usage for personal accounts, **Monthly Usage** spend for enterprise
- Auto-refreshes on a configurable interval (default 60s) with cached last-known usage on startup
- Opens the **Accounts** sidebar from the status bar for multi-profile management
- Manages multiple Cursor accounts via separate `--user-data-dir` profiles with parallel quota display, launch, export/import, and optional model efficiency analysis

See [docs/FEATURES.md](docs/FEATURES.md) for the full feature overview.

## Installation

### Quick start (from source)

```bash
nvm use 22
pnpm install
pnpm run compile
```

Press **F5** in Cursor/VS Code to launch an Extension Development Host, or package with `pnpm run package` and install the `.vsix` via **Extensions → ⋯ → Install from VSIX…**.

Reload the window if prompted. Status bar items appear automatically on startup—no manual setup.

For prerequisites, VSIX install steps, first-launch verification, and upgrading from **Cursor Quota**, see [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## Platform support

Pre-compiled SQLite 3.53.1 binaries are bundled for:

- macOS Intel (`darwin-x64`) and Apple Silicon (`darwin-arm64`)
- Linux x64 (`linux-x64`) and ARM64 (`linux-arm64`)
- Windows x64 (`win32-x64`) and ARM64 (`win32-arm64`)

No additional installation required. See [docs/PLATFORM-SUPPORT.md](docs/PLATFORM-SUPPORT.md) for binary details and verification.

## Documentation

### Getting started

- [Installation & Setup](docs/GETTING-STARTED.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

### Features

- [Feature Overview](docs/FEATURES.md)
- [Command Reference](docs/COMMANDS.md)
- [Multi-Profile Management](docs/FEATURE-MULTI-PROFILE.md)
- [Model Efficiency Analysis](docs/MODEL-EFFICIENCY.md)

### Technical

- [How It Works](docs/HOW-IT-WORKS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API Research](docs/RESEARCH.md)
- [Platform Support](docs/PLATFORM-SUPPORT.md)

### Other

- [Privacy & Security](docs/PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

## Development

```bash
nvm use 22
pnpm run watch         # extension TypeScript on save
pnpm run watch:webview # Accounts panel webview on save
pnpm test              # unit tests
pnpm run lint          # typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project structure, code style, and pull request guidelines.

## License

MIT
