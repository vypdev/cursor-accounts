# Model Efficiency Analysis

Per-profile analysis that scores Composer prompts and recommends lighter models when a heavy model is overkill.

## What it does

Each account in the **Accounts** panel can enable **Análisis de eficiencia**:

1. Confirm creation of a Cursor API key named **Cursor Accounts - API Key** (uses the profile's stored session).
2. Every **10 seconds** (configurable), the extension reads the active profile's `state.vscdb` for new Composer user messages and the selected model.
3. Analysis runs in the background via `@cursor/sdk` and prints scoring to the **Cursor Model Efficiency** output channel.

Example: prompt *"¿Cuál es la capital de España?"* with **Opus** should score low and recommend a lighter model.

## How to enable

1. Open the **Accounts** sidebar (click the status bar or run **Cursor Accounts: Open Accounts Panel**).
2. Find the profile card for **this window's active profile** (marked as "Current Window").
3. Toggle **Análisis de eficiencia** on the profile card.
4. Confirm API key creation when prompted.

The efficiency toggle appears only on the profile card for **this window's active profile** (the same rule as "Current Window"). Enabling or disabling from another window is blocked, because the API key is stored in that window's extension host secrets.

## Commands

See [COMMANDS.md](COMMANDS.md#model-efficiency) for model efficiency commands.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.modelEfficiency.showNotificationOnHigh` | `true` | Notify when efficiency severity is high |
| `cursorAccounts.modelEfficiency.autoShowOutputChannel` | `false` | Open Model Efficiency output on each analysis |
| `cursorAccounts.modelEfficiency.pollIntervalSeconds` | `10` | Poll interval (5–60 s) |

See [CONFIGURATION.md](CONFIGURATION.md) for all settings.

## How detection works

- Reads `{userDataDir}/User/globalStorage/state.vscdb` (Composer headers, `composerData`, user `bubbleId` entries)
- Polls on the configured interval (default 10 s)
- Latency is up to the poll interval
- Uses your Cursor plan quota (SDK `model: auto`)

## Limitations

- Available only for the **active window's profile** — secrets and API keys are scoped to that extension host
- Not available for cloud agents submitted from the web UI
- Detection depends on Composer data in `state.vscdb`; if the database is locked or unavailable, polling may fail (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md))

## Related documentation

- [COMMANDS.md](COMMANDS.md) — full command reference
- [FEATURES.md](FEATURES.md) — feature overview
- [CONFIGURATION.md](CONFIGURATION.md) — all settings
- [ARCHITECTURE.md](ARCHITECTURE.md) — implementation details (`src/modelEfficiency/`)
