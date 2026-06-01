# Features

Overview of what **Cursor Accounts** provides. Each major feature has a dedicated guide for deeper detail.

## Status bar quota display

The extension shows plan quota usage directly in the IDE status bar after activation—no need to open **Settings** manually.

- One status bar indicator for personal accounts — averaged **API mode** and **auto mode** usage (`usage` label with progress bar)
- **Monthly Usage** spend for enterprise (`$94.00 / $600.00` with percent)
- API mode, auto mode, and plan breakdown in tooltips
- Auto-refresh (default 60s, configurable)
- Cached last-known usage on startup while fetching
- Click status bar → **Accounts** sidebar (multi-profile panel)

### Commands

See [COMMANDS.md](COMMANDS.md) for the full command reference (quota, profiles, and model efficiency).

Configure display and refresh behavior in [CONFIGURATION.md](CONFIGURATION.md).

## Multi-profile management

Manage multiple Cursor accounts through separate `--user-data-dir` profiles:

- Add, edit, delete, launch, export, and import profiles
- View parallel quota usage and account info per profile
- Detect running Cursor instances and see which profile each window uses
- Enterprise team leaderboard on profile cards (when applicable)

Each profile uses its own user data directory — the official Cursor approach for running multiple accounts.

**Detailed guide:** [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md)

## Model efficiency analysis

Optional per-profile analysis that scores Composer prompts and recommends lighter models when appropriate. Enabled from the **Accounts** panel for the active window's profile.

**Detailed guide:** [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md)

## How data is fetched

The extension reads your local Cursor session and calls Cursor's quota APIs. No third-party servers are involved.

**Detailed guide:** [HOW-IT-WORKS.md](HOW-IT-WORKS.md)

## Related documentation

- [COMMANDS.md](COMMANDS.md) — full command reference
- [GETTING-STARTED.md](GETTING-STARTED.md) — installation and first launch
- [CONFIGURATION.md](CONFIGURATION.md) — all settings
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — common issues
