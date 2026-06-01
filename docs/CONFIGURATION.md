# Configuration

All extension settings use the `cursorAccounts.*` prefix. Configure them in **Cursor Settings** or your `settings.json`.

## Overview

Settings are grouped by area: refresh polling, status bar display, multi-profile behavior, and model efficiency analysis. Defaults are chosen for automatic quota display with minimal setup.

## Refresh

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.refresh.enabled` | `true` | Enable automatic polling |
| `cursorAccounts.refresh.intervalSeconds` | `60` | Poll interval (30–300 seconds) |

## Status bar

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.statusBar.showIncluded` | `true` | Show included usage indicator |
| `cursorAccounts.statusBar.showTotal` | `true` | Show total plan percentage indicator |
| `cursorAccounts.statusBar.showAccountEmail` | `false` | Show cached email in tooltips |

## Profiles

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.profiles.autoDetectRunning` | `true` | Detect running Cursor instances per profile |
| `cursorAccounts.profiles.showProfileInStatusBar` | `true` | Show active profile name in status bar |
| `cursorAccounts.profiles.refreshAllInterval` | `300` | Background quota refresh for all profiles (60–3600 s) |
| `cursorAccounts.profiles.instanceDetectionInterval` | `30` | How often to scan for running instances (15–120 s) |

## Model efficiency

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.modelEfficiency.showNotificationOnHigh` | `true` | Notify when efficiency severity is high |
| `cursorAccounts.modelEfficiency.autoShowOutputChannel` | `false` | Open Model Efficiency output on each analysis |
| `cursorAccounts.modelEfficiency.pollIntervalSeconds` | `10` | Poll interval (5–60 s) |

See [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md) for how to enable and use model efficiency analysis per profile.

## Common scenarios

### Verify you are on the correct account

Enable `cursorAccounts.statusBar.showAccountEmail` to display the cached login email in status bar tooltips. This is especially useful when running multiple Cursor instances with different `--user-data-dir` profiles.

### Reduce API polling

Set `cursorAccounts.refresh.intervalSeconds` to a higher value (up to 300 s) if you prefer less frequent status bar updates.

### Monitor all profiles in the background

The Accounts panel refreshes quotas for all configured profiles on `cursorAccounts.profiles.refreshAllInterval` (default 300 s). Lower this value for more frequent parallel updates across profiles.

## Related documentation

- [FEATURES.md](FEATURES.md) — what each setting affects in the UI
- [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md) — model efficiency feature details
- [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) — multi-profile behavior
