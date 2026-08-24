# Building Cursor Accounts

This document describes the canonical build pipeline for producing installable `.vsix` packages.

For historical notes on extension bundling and prepublish simplification, see [SIMPLIFICATION-SUMMARY.md](SIMPLIFICATION-SUMMARY.md).

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

1. **Bundles** the extension code with esbuild for optimal performance
2. Compiles workspace packages (`@cursor-accounts/types`, `@cursor-accounts/shared`) and the Accounts webview
3. Installs dependencies and rebuilds the `sqlite3` native binding
4. Converts workspace dependencies to a production layout compatible with `vsce`
5. Removes hoisted devDependencies that break npm dependency validation, then prunes non-production top-level packages from `node_modules`
6. Packages a platform-specific `.vsix` with bundled code and full production dependencies
7. Verifies the VSIX contains the webview bundle, `sqlite3`, `@cursor/sdk`, and critical runtime deps (`undici`, `bindings`)
8. Restores the workspace to its original development state

The extension code is bundled into a single `out/extension-bundle.js` file (~1.2MB). All production `node_modules` (including `@cursor/sdk` and its full transitive dependency tree) are included in the VSIX.

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

The extension uses **esbuild** to bundle all TypeScript code into a single file, significantly reducing file count and improving load performance.

| Component | Source | Build Output | Included in VSIX |
|-----------|--------|--------------|------------------|
| Extension code (bundled) | `src/` | `out/extension-bundle.js` (~1.2MB) | Yes |
| Accounts webview (bundled) | `webview/src/` | `webview-dist/bundle.js` | Yes |
| Shared types | `packages/types/` | Bundled in extension | No (bundled) |
| Shared utilities | `packages/shared/` | Bundled in extension/webview | No (bundled) |
| Production dependencies | `node_modules/` | Same path | Yes (full tree) |
| Cursor SDK | `@cursor/sdk` (external in bundle) | `node_modules/@cursor/sdk` | Yes |
| Platform SDK | `@cursor/sdk-<platform>` | `node_modules/@cursor/sdk-*` | Yes (one per target) |
| SQLite CLI | `bin/<target>/sqlite3` | Same path | Yes (one per target) |

**Note**: `@cursor/sdk` is marked as `external` in the esbuild bundle because it has native dependencies and is dynamically imported. Its full production dependency tree (`undici`, `bindings`, `sqlite3`, etc.) is shipped in `node_modules/` — not selectively whitelisted.

**VSIX Size**: ~20 MB per platform (3465 files; down from ~26 MB before bundling; includes full production `node_modules` for `@cursor/sdk`)

## Clean Build

To verify a reproducible build from scratch:

```bash
pnpm run build:clean:current
```

Equivalent manual steps:

```bash
rm -rf node_modules webview/node_modules packages/types/node_modules packages/shared/node_modules out webview-dist .build-backup
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
| `pnpm run compile` | Compile TypeScript and webview for local development (F5); does not produce `extension-bundle.js` |
| `pnpm run bundle` | Full esbuild bundle (`out/extension-bundle.js`); used by packaging and `vscode:prepublish` |
| `pnpm run watch` | Watch extension TypeScript |
| `pnpm run watch:webview` | Watch webview bundle |
| `pnpm run build:current` | Bundle + package an installable VSIX for your machine (runs `pnpm run bundle` internally) |
| `pnpm run build:clean:current` | Clean `node_modules`/artifacts, reinstall, then build VSIX for your machine |
| `pnpm run build:all` | Bundle + package VSIXes for all platforms |

### Native Runtime Selection

Agent tracking uses `better-sqlite3`, which must be compiled for the runtime
that executes it. Use the Node binding for tests and the Electron binding for
the Extension Host or packaged extension:

```bash
pnpm run rebuild:native:node
pnpm run verify:native:node
pnpm run rebuild:native:electron
```

The same workspace binding cannot serve Node.js tests and Electron at the same
time. Rebuild explicitly when switching runtimes. `pnpm run rebuild:native`
remains the Electron-default compatibility alias.

For a clean test setup:

```bash
CI=true pnpm install --frozen-lockfile
pnpm run rebuild:native:node
pnpm run verify:native:node
```

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
