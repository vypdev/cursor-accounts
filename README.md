# Cursor Accounts

Cursor extension that shows **plan quota usage** in the IDE status bar after activation—no need to open **Settings** manually.

## Features

- One status bar indicator for personal accounts — averaged **API mode** and **auto mode** usage (`usage` label with progress bar)
- **Monthly Usage** spend for enterprise (`$94.00 / $600.00` with percent)
- API mode, auto mode, and plan breakdown in tooltips
- Auto-refresh (default 60s, configurable)
- Cached last-known usage on startup while fetching
- Click status bar → **Accounts** sidebar (multi-profile panel)
- **Multi-profile management** — Accounts panel with profile cards, parallel quota display, launch, export/import
- Command: **Cursor Accounts: Refresh Now**
- Command: **Cursor Accounts: Open Usage** — opens **Cursor Settings → Usage** (personal) or **cursor.com/dashboard/usage** (enterprise)

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

### Upgrading from Cursor Quota (`vypdev.cursor-quota`)

The extension was renamed to **Cursor Accounts** (`vypdev.cursor-accounts`). Uninstall the old **Cursor Quota** extension before installing the new VSIX to avoid duplicate sidebar entries. Settings and cached tokens from `cursorQuota.*` are migrated automatically on first activation.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.refresh.enabled` | `true` | Enable automatic polling |
| `cursorAccounts.refresh.intervalSeconds` | `60` | Poll interval (30–300 seconds) |
| `cursorAccounts.statusBar.showIncluded` | `true` | Show included usage indicator |
| `cursorAccounts.statusBar.showTotal` | `true` | Show total plan percentage indicator |
| `cursorAccounts.statusBar.showAccountEmail` | `false` | Show cached email in tooltips |
| `cursorAccounts.modelEfficiency.showNotificationOnHigh` | `true` | Notify when efficiency severity is high |
| `cursorAccounts.modelEfficiency.autoShowOutputChannel` | `false` | Open Model Efficiency output on each analysis |
| `cursorAccounts.profiles.autoDetectRunning` | `true` | Detect running Cursor instances per profile |
| `cursorAccounts.profiles.showProfileInStatusBar` | `true` | Show active profile name in status bar |
| `cursorAccounts.profiles.refreshAllInterval` | `300` | Background quota refresh for all profiles (60–3600 s) |
| `cursorAccounts.profiles.instanceDetectionInterval` | `30` | How often to scan for running instances (15–120 s) |

## Multi-profile accounts

The **Accounts** activity bar panel lets you manage multiple Cursor profiles (separate `--user-data-dir` instances):

- Add, edit, delete, launch, export, and import profiles
- View parallel quota usage and account info per profile
- Detect running Cursor instances and see which profile each window uses
- Enterprise team leaderboard on profile cards (when applicable)

Each profile uses its own user data directory — the official Cursor approach for running multiple accounts. See [docs/FEATURE-MULTI-PROFILE.md](docs/FEATURE-MULTI-PROFILE.md) for product design and flows.

| Command | Description |
|---------|-------------|
| `Cursor Accounts: Open Accounts` | Focus the Accounts sidebar |
| `Cursor Accounts: Add Profile` | Create a new profile |
| `Cursor Accounts: Launch Profile` | Launch Cursor with a profile's user data dir |
| `Cursor Accounts: List Profiles` | Quick pick of configured profiles |
| `Cursor Accounts: Delete Profile` | Remove a profile from config |
| `Cursor Accounts: Export Profiles` | Export profile config to JSON |
| `Cursor Accounts: Import Profiles` | Import profiles from JSON |
| `Cursor Accounts: Show Current Profile` | Show the active window's profile |

## Model efficiency analysis (per profile)

Each account in the **Accounts** panel can enable **Análisis de eficiencia**:

1. Confirm creation of a Cursor API key named **Cursor Accounts - API Key** (uses the profile’s stored session).
2. Every **10 seconds** (configurable), the extension reads the active profile’s `state.vscdb` for new Composer user messages and the selected model.
3. Analysis runs in the background via `@cursor/sdk` and prints scoring to the **Cursor Model Efficiency** output channel.

Example: prompt *“¿Cuál es la capital de España?”* with **Opus** should score low and recommend a lighter model.

| Command | Description |
|---------|-------------|
| `Cursor Accounts: Show Model Efficiency Output` | Open the analysis output channel |
| `Cursor Accounts: Restart Prompt Detector` | Clear detection state and restart `state.vscdb` polling |

**Notes:** The efficiency toggle appears only on the profile card for **this window’s active profile** (the same rule as “Current Window”). Enabling or disabling from another window is blocked, because the API key is stored in that window’s extension host secrets. Detection reads `{userDataDir}/User/globalStorage/state.vscdb` (Composer headers, `composerData`, user `bubbleId` entries). Latency is up to the poll interval (default 10 s). Uses your Cursor plan quota (SDK `model: auto`). Not available for cloud agents submitted from the web UI.

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.modelEfficiency.pollIntervalSeconds` | `10` | Poll interval (5–60 s) |

## How it works

1. Reads the Cursor session from the **active window’s** local `state.vscdb` (`cursorAuth/accessToken`, `cursorAuth/refreshToken`) — respects `--user-data-dir` for multi-profile setups.
2. Calls the reverse-engineered IDE endpoint:  
   `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
3. For **enterprise / team** accounts (or when IDE data is empty), also calls the web dashboard endpoint:  
   `GET https://cursor.com/api/usage-summary` (session cookie derived from the same JWT)
4. Refreshes expired tokens via `https://api2.cursor.sh/oauth/token` and stores them in VS Code **Secret Storage** scoped per profile (does not write back to `state.vscdb`).

See [docs/RESEARCH.md](docs/RESEARCH.md) for data sources, limitations, and account-switching investigation.

## Documentation

| Document | Description |
|----------|-------------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, structure, tests, pull requests |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Extension structure, data flows, design decisions |
| [docs/FEATURE-MULTI-PROFILE.md](docs/FEATURE-MULTI-PROFILE.md) | Multi-profile product design |
| [docs/RESEARCH.md](docs/RESEARCH.md) | Quota APIs and platform constraints |

## Multi-account / in-window switching

**In-window account switching is not supported.** Cursor does not expose a supported API for switching subscription accounts inside one window.

**What this extension does support:** managing and launching **separate Cursor instances** with different user data directories via the Accounts panel and profile commands. Each profile is an isolated Cursor install path — not a snapshot swap inside a single window.

**Recommended approach (official workaround):** run separate Cursor instances with different user data directories:

```bash
open -na "/Applications/Cursor.app" \
  --args --user-data-dir="$HOME/.cursor-profile-work"
```

Optional: enable `cursorAccounts.statusBar.showAccountEmail` to display the cached login email in tooltips and avoid using the wrong account.

Community “account switcher” extensions swap SQLite snapshots of `state.vscdb`—unsupported, fragile, and a security risk. This project does **not** implement that.

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `Quota unavailable` | Confirm **Cursor Settings → Usage** works natively; sign in again |
| Stuck on loading | Run **Cursor Accounts: Refresh Now** from the Command Palette |
| Wrong percentages | Cursor may show included vs credits separately; compare with Settings UI |
| Wrong account in status bar | Ensure each profile uses a separate `--user-data-dir`; enable `showAccountEmail` to verify |
| Enterprise shows 0% | Compare with [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage); run **Refresh Now** |
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
- Network requests go to `api2.cursor.sh` and `cursor.com` (Cursor) only.
- No third-party servers.

## Known limitations

- **Unofficial API** — may change without notice when Cursor updates.
- **Enterprise teams** — Monthly Usage uses the web dashboard API; team Admin/Analytics APIs at `api.cursor.com` are not used (admin API keys required).
- **Credits vs included pool** — UI follows combined IDE + web sources; “100% included” in Settings can still allow usage via credits.
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
