# Cursor Quota

Cursor extension that shows **plan quota usage** in the IDE status bar after activation—no need to open **Settings** manually.

## Features

- Two status bar indicators (visible on activation):
  1. **Included quota usage** — API/included pool (`apiPercentUsed`) with progress bar and percentage
  2. **Plan quota usage** — total plan usage (`totalPercentUsed`) with progress bar and percentage
- Separates **Auto mode** vs included/API usage in tooltips
- Auto-refresh (default 60s, configurable)
- Cached last-known usage on startup while fetching
- Click status bar → guidance to open **Cursor Settings → Usage**
- Command: **Cursor Quota: Refresh Now**

## Prerequisites

- [Node.js 22](https://nodejs.org/) via [nvm](https://github.com/nvm-sh/nvm): `nvm use 22` (see [.nvmrc](.nvmrc))
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

Press **F5** in Cursor/VS Code to launch an Extension Development Host, or package:

```bash
pnpm run package
```

Then in Cursor: **Extensions** → **⋯** → **Install from VSIX…** → select the generated `.vsix`.

### After install

Reload the window if prompted. Status bar items appear automatically on startup (`onStartupFinished`)—no manual setup.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorQuota.refresh.enabled` | `true` | Enable automatic polling |
| `cursorQuota.refresh.intervalSeconds` | `60` | Poll interval (30–300 seconds) |
| `cursorQuota.statusBar.showIncluded` | `true` | Show included usage indicator |
| `cursorQuota.statusBar.showTotal` | `true` | Show total plan percentage indicator |
| `cursorQuota.statusBar.showAccountEmail` | `false` | Show cached email in tooltips |

## How it works

1. Reads the Cursor session from local `state.vscdb` (`cursorAuth/accessToken`, `cursorAuth/refreshToken`).
2. Calls the same reverse-engineered endpoint the IDE uses:  
   `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
3. Refreshes expired tokens via `https://api2.cursor.sh/oauth/token` and stores them in VS Code **Secret Storage** (does not write back to `state.vscdb`).

See [docs/RESEARCH.md](docs/RESEARCH.md) for data sources, limitations, and account-switching investigation.

## Multi-account / account switching

**Not supported by this extension.** Cursor does not expose a supported API for switching subscription accounts inside one window.

**Recommended approach (official workaround):** run separate Cursor instances with different user data directories:

```bash
open -na "/Applications/Cursor.app" \
  --args --user-data-dir="$HOME/.cursor-profile-work"
```

Optional: enable `cursorQuota.statusBar.showAccountEmail` to display the cached login email in tooltips and avoid using the wrong account.

Community “account switcher” extensions swap SQLite snapshots of `state.vscdb`—unsupported, fragile, and a security risk. This project does **not** implement that.

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `Quota unavailable` | Confirm **Cursor Settings → Usage** works natively; sign in again |
| Stuck on loading | Run **Cursor Quota: Refresh Now** from the Command Palette |
| Wrong percentages | Cursor may show included vs credits separately; compare with Settings UI |
| DB read errors | Uses bundled SQLite binary (no installation required). If issues persist, check Extension Host log |

## Platform Support

This extension includes pre-compiled SQLite 3.53.1 binaries for all supported platforms:

- macOS Intel (`darwin-x64`) and Apple Silicon (`darwin-arm64`)
- Linux x64 (`linux-x64`) and ARM64 (`linux-arm64`)
- Windows x64 (`win32-x64`) and ARM64 (`win32-arm64`)

No additional installation or configuration required.

To regenerate the Linux ARM64 binary (no official precompiled CLI from SQLite):

```bash
docker run --rm --platform linux/arm64 -v "$PWD:/project" -w /project ubuntu:24.04 \
  bash -c 'apt-get update && apt-get install -y build-essential curl file && bash scripts/build-linux-arm64-sqlite.sh'
```

Validate all bundled binaries with `bash scripts/verify-binaries.sh`.

## Privacy

- Reads auth tokens from your local Cursor install (same data the IDE already uses).
- Network requests go only to `api2.cursor.sh` (Cursor).
- No third-party servers.

## Known limitations

- **Unofficial API** — may change without notice when Cursor updates.
- **Enterprise teams** — Admin/Analytics APIs at `api.cursor.com` are not used (team keys required).
- **Credits vs included pool** — UI follows `GetCurrentPeriodUsage`; “100% included” in Settings can still allow usage via credits.
- **Cursor-only** — built for Cursor; standard VS Code may lack `state.vscdb` auth keys.

## Development

```bash
nvm use 22
pnpm run watch         # extension TypeScript on save
pnpm run watch:webview # Accounts panel webview on save
pnpm test              # unit tests
pnpm run lint          # typecheck
```

## License

MIT
