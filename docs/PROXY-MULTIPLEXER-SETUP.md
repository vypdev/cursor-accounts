# Proxy Multiplexer Setup

**Last reviewed:** 2026-06-06

## Automatic setup

The multiplexer is **always enabled**. On extension activation, a **global router** starts on port **9000**.

When you launch a Cursor window with a profile that has proxy enabled:

1. The extension ensures the global multiplexer is running on port 9000
2. `settings.json` for that profile is updated with `http.proxy: "http://127.0.0.1:9000"`
3. Cursor launches **without** `--proxy-server` (the proxy is read from settings)
4. On the first request, the multiplexer decodes the JWT `Authorization` header to identify the profile
5. On the first request that includes a workspace path, the multiplexer creates a dedicated upstream MITM proxy for that `(profileId, workspace)` pair
6. All traffic from that workspace routes through its upstream

When proxy is disabled, `settings.json` is restored and upstreams for that profile are stopped. The global multiplexer on port 9000 keeps running.

## No enable/disable toggle

There is no `cursorAccounts.proxy.multiplexer.enabled` or `autoStart` setting. The multiplexor is the only proxy system.

The only multiplexer setting is:

```json
{
  "cursorAccounts.proxy.multiplexer.routingStrategy": "workspace-path"
}
```

Reload the extension after changing settings.

## Commands

| Command | Purpose |
|---------|---------|
| `Cursor Accounts: Start Proxy Multiplexor` | Ensure global router is running on port 9000 |
| `Cursor Accounts: Stop Proxy Multiplexor` | Stop upstreams for the current profile (global router stays up) |
| `Cursor Accounts: Proxy Multiplexor Status` | Quick status summary |
| `Cursor Accounts: Proxy Multiplexor Metrics` | Per-upstream request counters |
| `Cursor Accounts: Set Proxy Multiplexor Strategy` | Change routing strategy |
| `Cursor Accounts: Proxy Multiplexor Sessions` | Show active session bindings |

## Accounts panel

The Accounts panel shows:

- Global router port (9000) and strategy
- Active sessions
- Per-upstream health, requests, and connections for the active profile
- Strategy selector

## Output channel logging

The **Cursor MITM Proxy** output channel logs:

- Global multiplexer start/stop
- JWT token extraction and profile resolution
- Routing decisions (`profile` + `workspace` → upstream)
- Upstream creation and removal
- `settings.json` proxy apply/restore

## Advanced JSON config

Optional global config file: `~/.cursor-accounts/proxy/multiplexer-global-config.json`

```json
{
  "routing": {
    "strategy": "workspace-path",
    "fallbackStrategy": "sticky-session",
    "sessionTimeoutMs": 3600000
  },
  "health": {
    "checkIntervalMs": 30000,
    "timeoutMs": 5000,
    "unhealthyThreshold": 3
  }
}
```

Pre-created upstream example:

```json
{
  "upstreams": [
    {
      "id": "workspace-project-a",
      "host": "127.0.0.1",
      "port": 8100,
      "metadata": {
        "profileId": "profile-a",
        "workspacePath": "/Users/me/projects/project-a"
      }
    }
  ]
}
```

## Recommended scenarios

- **Multi-project development:** `workspace-path` (default)
- **Multiple Cursor accounts:** `token-hash`
- **Many windows, single workspace:** `sticky-session`
- **Load balancing:** `least-connections`

## Troubleshooting

1. Verify global router port: `lsof -i :9000`
2. Verify upstream MITM proxies: `lsof -i :8000-8999`
3. Check router logs under `~/.cursor-accounts/proxy/logs/router-global-*.jsonl`
4. Check **Cursor MITM Proxy** output channel for auth/routing/upstream events
5. Confirm profile `settings.json` contains `http.proxy: "http://127.0.0.1:9000"` (applied automatically on launch)
6. Relaunch profile windows after enabling proxy so settings take effect
7. Trust the MITM CA certificate (see Accounts panel → MITM Proxy section)
