# Troubleshooting

Common issues and how to resolve them.

## Quick diagnostics

1. Confirm **Cursor Settings → Usage** works natively in the IDE
2. Run **Cursor Accounts: Refresh Now** from the Command Palette
3. Check the Extension Host log for errors (Help → Toggle Developer Tools → Console)
4. Compare status bar values with **Cursor Settings → Usage** or [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage)

## Common issues

| Symptom | Action |
|---------|--------|
| `Quota unavailable` | Confirm **Cursor Settings → Usage** works natively; sign in again |
| Stuck on loading | Run **Cursor Accounts: Refresh Now** from the Command Palette |
| Wrong percentages | Cursor may show included vs credits separately; compare with Settings UI |
| Wrong account in status bar | Ensure each profile uses a separate `--user-data-dir`; enable `showAccountEmail` to verify |
| Enterprise shows 0% | Compare with [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage); run **Refresh Now** |
| DB read errors | Uses bundled SQLite binary (no installation required). If issues persist, check Extension Host log |

## Account-related issues

### In-window account switching is not supported

Cursor does not expose a supported API for switching subscription accounts inside one window.

**What this extension does support:** managing and launching **separate Cursor instances** with different user data directories via the Accounts panel and profile commands. Each profile is an isolated Cursor install path — not a snapshot swap inside a single window.

**Recommended approach (official workaround):** run separate Cursor instances with different user data directories:

```bash
open -na "/Applications/Cursor.app" \
  --args --user-data-dir="$HOME/.cursor-profile-work"
```

Optional: enable `cursorAccounts.statusBar.showAccountEmail` to display the cached login email in tooltips and avoid using the wrong account.

Community "account switcher" extensions swap SQLite snapshots of `state.vscdb`—unsupported, fragile, and a security risk. This project does **not** implement that.

See [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) for multi-profile setup and [RESEARCH.md](RESEARCH.md) for account-switching investigation.

### Wrong account showing in status bar

- Ensure each profile uses a separate `--user-data-dir`
- Enable `cursorAccounts.statusBar.showAccountEmail` to verify the cached login email in tooltips
- Focus the correct Cursor window — the status bar reflects the **active window's** profile only

## Platform-specific issues

### DB read errors

The extension uses bundled SQLite 3.53.1 binaries (see [PLATFORM-SUPPORT.md](PLATFORM-SUPPORT.md)). No additional installation is required. If read errors persist:

1. Check the Extension Host log for SQLite-related errors
2. Validate bundled binaries with `bash scripts/verify-binaries.sh`
3. Ensure `state.vscdb` exists under your profile's user data directory

## When to file a bug report

Open a [GitHub issue](https://github.com/vypdev/cursor-accounts/issues) if:

- **Cursor Settings → Usage** works but the extension shows `Quota unavailable` after refresh
- Status bar percentages consistently differ from the native Usage UI after comparing both
- Multi-profile quota fails for a signed-in profile that works in its own window

Include: Cursor version, OS/platform, account type (personal/enterprise), and relevant Extension Host log output.

## Related documentation

- [GETTING-STARTED.md](GETTING-STARTED.md) — installation and first launch
- [CONFIGURATION.md](CONFIGURATION.md) — settings that affect display and refresh
- [RESEARCH.md](RESEARCH.md) — known API limitations
- [PLATFORM-SUPPORT.md](PLATFORM-SUPPORT.md) — platform and binary details
