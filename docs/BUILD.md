# Building Cursor Accounts

This document describes the canonical build pipeline for producing installable `.vsix` packages.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) (`nvm use` — see [.nvmrc](../.nvmrc))
- [pnpm 10](https://pnpm.io/) (`corepack enable`)
- Use **pnpm only** in this repo

## Quick Start

Build for your current platform and architecture:

```bash
pnpm install
pnpm run build:current
```

Build for all supported platforms:

```bash
pnpm install
pnpm run build:all
```

Build for a specific target:

```bash
pnpm run build -- --target darwin-arm64
```

## Canonical Build Command

`pnpm run build` is the single entry point for packaging. It:

1. Compiles shared types, the extension host, and the Accounts webview
2. Installs dependencies and rebuilds the `sqlite3` native binding
3. Converts workspace dependencies to a production layout compatible with `vsce`
4. Removes hoisted devDependencies that break npm dependency validation
5. Packages a platform-specific `.vsix` with bundled binaries and native modules
6. Verifies the VSIX contains the webview bundle, `sqlite3`, and `@cursor/sdk`
7. Restores the workspace to its original development state

No manual patches or intermediate workarounds are required.

## Platform Targets

| Target | Platform |
|--------|----------|
| `darwin-arm64` | macOS Apple Silicon |
| `darwin-x64` | macOS Intel |
| `linux-x64` | Linux x64 |
| `linux-arm64` | Linux ARM64 |
| `win32-x64` | Windows x64 |
| `win32-arm64` | Windows ARM64 |

## Output

Each successful build produces:

```
cursor-accounts-<target>-<version>.vsix
```

Example: `cursor-accounts-darwin-arm64-0.1.26.vsix`

Install locally:

```bash
cursor --install-extension cursor-accounts-darwin-arm64-0.1.26.vsix
```

Or in Cursor/VS Code: **Extensions → ⋯ → Install from VSIX…**

## What Gets Bundled

| Component | Source | Included in VSIX |
|-----------|--------|------------------|
| Extension host | `out/` | Yes |
| Accounts webview | `webview-dist/` | Yes |
| Shared types | `@cursor-accounts/types` | Yes (production copy) |
| Cursor SDK | `@cursor/sdk` + platform package | Yes (installed per target) |
| SQLite CLI | `bin/<target>/sqlite3` | Yes |
| SQLite native binding | `node_modules/sqlite3` | Yes |

## Clean Build

To verify a reproducible build from scratch:

```bash
rm -rf node_modules webview/node_modules packages/types/node_modules out webview-dist .build-backup
pnpm install --frozen-lockfile
pnpm run build:current
```

## CI/CD

The release workflow (`.github/workflows/release_workflow.yml`) uses the same build command:

```bash
pnpm run build -- --target <platform-arch>
```

Each matrix job builds and verifies a VSIX, then publishes it to Open VSX.

## Development vs Packaging

| Command | Purpose |
|---------|---------|
| `pnpm run compile` | Compile TypeScript and webview for local development (F5) |
| `pnpm run watch` | Watch extension TypeScript |
| `pnpm run watch:webview` | Watch webview bundle |
| `pnpm run build:current` | Produce an installable VSIX for your machine |
| `pnpm run build:all` | Produce VSIXes for all platforms |

## Troubleshooting

### Node version mismatch

The build requires Node 22+. Run `nvm use` or ensure CI uses `node-version: 22`.

### Missing bundled SQLite binary

Platform binaries live under `bin/<target>/`. See [PLATFORM-SUPPORT.md](PLATFORM-SUPPORT.md) for regeneration steps (notably Linux ARM64).

### `npm list` / extraneous dependency errors

The unified build script (`scripts/build.mjs`) handles pnpm workspace compatibility automatically. Do not run `pnpm run package` directly; use `pnpm run build:current` instead.

## Legacy Scripts

The following scripts remain for compatibility but are deprecated:

- `pnpm run package`
- `pnpm run package:all`
- `pnpm run package:*`

Use `pnpm run build` variants instead.
