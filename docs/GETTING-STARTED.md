# Getting Started

This guide covers installation, first launch, and upgrading from the legacy **Cursor Quota** extension.

## Prerequisites

- [Node.js 22](https://nodejs.org/) via [nvm](https://github.com/nvm-sh/nvm): `nvm use 22` (see [.nvmrc](../.nvmrc))
- [pnpm](https://pnpm.io/): `corepack enable` or `npm install -g pnpm`

Use **pnpm only** for this repo—do not mix `npm install` with `pnpm-lock.yaml`.

## Installation

### From source (development)

```bash
nvm use 22
pnpm install   # installs extension + webview workspace packages
pnpm run compile
```

`pnpm run compile:webview` builds only the Accounts panel bundle; `pnpm run watch:webview` watches the webview.

Press **F5** in Cursor/VS Code to launch an Extension Development Host, or build a VSIX:

```bash
pnpm run build:current
```

Then in Cursor: **Extensions** → **⋯** → **Install from VSIX…** → select the generated `.vsix`.

### After install

Reload the window if prompted. Status bar items appear automatically on startup (`onStartupFinished`)—no manual setup.

## First launch

1. **Confirm the status bar** — After reload, you should see a quota indicator in the status bar (e.g. `usage` with a progress bar for personal accounts, or **Monthly Usage** spend for enterprise).
2. **Open the Accounts panel** — Click the status bar item or run **Cursor Accounts: Open Accounts Panel** from the Command Palette.
3. **Verify quota data** — If usage shows as loading briefly, wait for the first refresh (default 60s) or run **Cursor Accounts: Refresh Now**.
4. **Compare with Cursor Settings** — Open **Cursor Settings → Usage** (personal) or [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage) (enterprise) to confirm numbers match.

## Initial configuration

Most settings work out of the box. Common first-time adjustments:

| Goal | Setting |
|------|---------|
| Show login email in tooltips | `cursorAccounts.statusBar.showAccountEmail` → `true` |
| Change refresh interval | `cursorAccounts.refresh.intervalSeconds` (30–300 s) |
| Show active profile name | `cursorAccounts.profiles.showProfileInStatusBar` (default `true`) |

See [CONFIGURATION.md](CONFIGURATION.md) for the full settings reference.

## Upgrading from Cursor Quota (`vypdev.cursor-quota`)

The extension was renamed to **Cursor Accounts** (`vypdev.cursor-accounts`). Uninstall the old **Cursor Quota** extension before installing the new VSIX to avoid duplicate sidebar entries. Settings and cached tokens from `cursorQuota.*` are migrated automatically on first activation.

## Related documentation

- [COMMANDS.md](COMMANDS.md) — full command reference
- [CONFIGURATION.md](CONFIGURATION.md) — all settings
- [FEATURES.md](FEATURES.md) — feature overview
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — common issues
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development setup
