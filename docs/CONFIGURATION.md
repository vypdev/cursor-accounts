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

## Debug / development

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.debug.webviewLifecycle` | `true` | Log webview lifecycle diagnostics to the Cursor Accounts output channel |
| `cursorAccounts.debug.showActiveConversationInStatusBar` | `true` | Show focused Composer chat ID (`lastFocusedComposerIds`) in the status bar |
| `cursorAccounts.debug.activeConversationPollIntervalMs` | `400` | Poll interval for Composer tab focus changes (100–5000 ms) |

See [ACTIVE-CONVERSATION-DETECTION.md](ACTIVE-CONVERSATION-DETECTION.md) for how focus is resolved from workspace `state.vscdb`.

## MITM proxy (research / debugging)

Optional localhost proxy to observe Cursor network traffic. Setup: [PROXY-SETUP.md](PROXY-SETUP.md). Token and billing semantics: [TOKENS-AND-USAGE.md](TOKENS-AND-USAGE.md).

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.proxy.enabled` | `false` | Start proxy when the extension activates |
| `cursorAccounts.proxy.port` | `8080` | Listen port (per-profile launches may use 8081, 8082, or 8888) |
| `cursorAccounts.proxy.maxLogSizeMB` | `500` | Max total log disk usage before rotation |
| `cursorAccounts.proxy.maxBodyLogMB` | `4` | Inline body size threshold before spill to `logs/bodies/` |
| `cursorAccounts.proxy.spillLargeBodies` | `true` | Write large bodies to sidecar `.bin` files |
| `cursorAccounts.proxy.autoLaunchWithProxy` | `true` | Apply proxy settings when launching a profile from Accounts |
| `cursorAccounts.proxy.logTrafficToOutput` | `true` | Stream decoded traffic lines to MITM Proxy output |
| `cursorAccounts.proxy.autoShowOutputChannel` | `false` | Open output channel when proxy starts |
| `cursorAccounts.proxy.outputCursorHostsOnly` | `false` | Filter output to Cursor API hosts |
| `cursorAccounts.proxy.outputTailFromStart` | `false` | Tail log from beginning when output opens |
| `cursorAccounts.proxy.showLiveUsageInStatusBar` | `true` | Show live agent token counter + rough cost estimate (via proxy child IPC, not log tailing) |
| `cursorAccounts.proxy.estimatedDollarsPerMillionTokens` | `4` | Flat rate for live cost estimate (not real billing) |
| `cursorAccounts.proxy.developmentMode` | `false` | Write JSONL logs under `~/.cursor-accounts/proxy/logs/`; when off, traffic flows via IPC only |
| `cursorAccounts.proxy.trafficDiagnostics` | `true` | Periodic `[ProxyDiagnostics]` summaries in MITM output (hosts, RPC counts, bypass hints) |
| `cursorAccounts.proxy.diagnosticsIntervalMs` | `30000` | Interval between diagnostics summaries (10000–300000 ms) |
| `cursorAccounts.proxy.logTokenDetectorToOutput` | `true` | Stream agent/token events to **Cursor Token Detector** output channel |
| `cursorAccounts.proxy.autoShowTokenDetectorChannel` | `false` | Open Token Detector output when agent/token events arrive |

**Runtime modes:** With `developmentMode` off (default), the extension host receives decoded traffic from the proxy child over IPC (`ProxyManager.onTraffic`). JSONL files and log tailing are only used when `developmentMode` is `true` or when you open the output channel with **Proxy: Output Tail From Start** (replays the active log file if one exists).

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
- [PROXY-SETUP.md](PROXY-SETUP.md) — MITM proxy setup
- [TOKENS-AND-USAGE.md](TOKENS-AND-USAGE.md) — token signals and cost validation
