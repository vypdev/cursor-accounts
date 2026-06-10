# Proxy Multiplexer Setup

**Last reviewed:** 2026-06-09

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

There is no global proxy enable setting. Proxy is toggled **per profile** in the Accounts panel (Edit Profile → Route traffic through MITM proxy).

The only multiplexer VS Code setting is:

```json
{
  "cursorAccounts.proxy.multiplexer.routingStrategy": "workspace-path"
}
```

Allowed values: `workspace-path` (default) or `sticky-session`. Reload the extension after changing settings.

## Commands

| Command | Purpose |
|---------|---------|
| `Cursor Accounts: Start Proxy Multiplexor` | Ensure global router is running on port 9000 |
| `Cursor Accounts: Stop Proxy Multiplexor` | Stop upstreams for the current profile (global router stays up) |
| `Cursor Accounts: Proxy Multiplexor Status` | Quick status summary |
| `Cursor Accounts: Proxy Multiplexor Metrics` | Per-upstream request counters |
| `Cursor Accounts: Proxy Multiplexor Sessions` | Show active session bindings |

## Accounts panel

The Accounts panel shows a unified **Proxy Status** card:

- Global router status (port 9000), strategy, and active sessions
- Per-upstream health, requests, and connections for the active profile
- CA certificate install/uninstall and log/traffic shortcuts

There are no manual Start/Stop proxy buttons — the router starts automatically on extension activation.

## Output channel logging

The **Cursor MITM Proxy** output channel logs:

- Global multiplexer start/stop
- JWT token extraction and profile resolution
- Routing decisions (`profile` + `workspace` → upstream)
- Upstream creation and removal
- `settings.json` proxy apply/restore

## Troubleshooting

1. Verify global router port: `lsof -i :9000`
2. Verify upstream MITM proxies: `lsof -i :8000-8999`
3. Check router logs under `~/.cursor-accounts/proxy/logs/router-*.jsonl`
4. Check **Cursor MITM Proxy** output channel for auth/routing/upstream events
5. Confirm profile `settings.json` contains `http.proxy: "http://127.0.0.1:9000"` (applied automatically on launch)
6. Relaunch profile windows after enabling proxy so settings take effect
7. Trust the MITM CA certificate (see Accounts panel → Proxy Status section)
