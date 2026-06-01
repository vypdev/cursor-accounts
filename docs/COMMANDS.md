# Command Reference

All commands registered by **Cursor Accounts** (`vypdev.cursor-accounts`). Run them from the **Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Cursor Accounts:` to filter.

Palette titles match [`package.nls.json`](../package.nls.json).

## Quota and usage

| Command ID | Palette title | Description |
|------------|---------------|-------------|
| `cursorAccounts.refresh` | Cursor Accounts: Refresh Now | Force an immediate quota refresh for the active window |
| `cursorAccounts.openUsage` | Cursor Accounts: Open Usage in Settings | Personal accounts: opens Cursor Settings (Usage section). Enterprise: opens [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage) |
| `cursorAccounts.openAccounts` | Cursor Accounts: Open Accounts Panel | Focus the **Accounts** sidebar |

## Profiles

| Command ID | Palette title | Description |
|------------|---------------|-------------|
| `cursorAccounts.addProfile` | Cursor Accounts: Add Profile | Prompt for email and display name, create a profile, optionally launch immediately |
| `cursorAccounts.launchProfile` | Cursor Accounts: Launch Profile | Quick pick of configured profiles; spawns Cursor with the profile's `--user-data-dir` |
| `cursorAccounts.listProfiles` | Cursor Accounts: List Profiles | List configured profiles (email, path, last launched) in the extension output channel |
| `cursorAccounts.deleteProfile` | Cursor Accounts: Delete Profile | Remove a profile from config; does **not** delete the user data directory |
| `cursorAccounts.showCurrentProfile` | Cursor Accounts: Show Current Profile | Show the active window's profile name and email, or indicate the default Cursor profile |
| `cursorAccounts.exportProfiles` | Cursor Accounts: Export Profiles | Export selected profiles (metadata only) to JSON; optionally include each profile's `settings.json` |
| `cursorAccounts.importProfiles` | Cursor Accounts: Import Profiles | Import profiles from a JSON bundle; partial success is reported per profile |

See [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) for user flows and profile behavior.

## Model efficiency

| Command ID | Palette title | Description |
|------------|---------------|-------------|
| `cursorAccounts.efficiency.showOutput` | Cursor Accounts: Show Model Efficiency Output | Open the **Cursor Model Efficiency** output channel |
| `cursorAccounts.efficiency.restartDetector` | Cursor Accounts: Restart Prompt Detector | Clear detection state and restart `state.vscdb` polling for Composer messages |

See [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md) for how to enable analysis per profile.

## Related UI actions (not commands)

These actions are available in the UI but are **not** registered as Command Palette commands:

| Action | Equivalent / notes |
|--------|-------------------|
| Click status bar quota item | Opens the Accounts panel (same as **Cursor Accounts: Open Accounts Panel**) |
| Edit profile | Accounts panel webview only — update display name, emoji, theme, color, notes |

## Related documentation

- [FEATURES.md](FEATURES.md) — feature overview
- [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) — multi-profile management
- [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md) — model efficiency analysis
- [CONFIGURATION.md](CONFIGURATION.md) — settings that affect command behavior
