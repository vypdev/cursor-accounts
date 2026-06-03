# MITM Proxy Setup

The Cursor Accounts extension can run a local MITM proxy to observe HTTP/HTTPS traffic between Cursor and its servers. This is intended for **research and debugging** only.

## Enable the proxy

1. Open VS Code/Cursor Settings and search for `cursorAccounts.proxy`.
2. Set **Proxy: Enabled** to start the proxy when the extension activates, or use the Accounts panel **MITM Proxy** card to start/stop manually.
3. Default listen address: `127.0.0.1:8080` (configurable via **Proxy: Port**).

## Trust the CA certificate

HTTPS interception requires trusting the extension-generated CA:

1. In the Accounts panel MITM Proxy card, click **Install instructions** to open the guided setup dialog.
2. Use **Save CA certificate…** in the dialog (step 1) to export the `.pem`, then follow the platform-specific trust steps shown in the same popup.
3. You can also run **Cursor Accounts: Save Proxy CA Certificate…** from the Command Palette to export the file without opening the guide.

Without this step, Cursor may reject TLS connections when using the proxy.

## Route Cursor through the proxy

When the proxy is **running**, launching a profile from the Accounts panel adds:

- `--proxy-server=http://127.0.0.1:<port>`
- `NODE_EXTRA_CA_CERTS` pointing at the generated CA (for Node/Electron)

Windows opened **before** the proxy started do not use it until you launch a new profile window.

## View logs

Logs are JSON Lines files under the extension global storage:

`<globalStorage>/proxy/logs/proxy-YYYY-MM-DD-*.jsonl`

Open the folder via **View Logs** in the panel or **Cursor Accounts: Open Proxy Logs**.

## Security

- Logs may contain **auth tokens**, cookies, and request bodies.
- The proxy only listens on localhost.
- Do not share log files without redacting secrets.

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Proxy fails to start | Another process may use the port; change **Proxy: Port** or stop the other service. |
| Cursor network errors | Install the CA certificate; restart Cursor after trusting it. |
| Panel shows proxy running but this window does not use it | Launch the profile again after starting the proxy. |
| Stale “running” status | The proxy process may have crashed; click **Stop Proxy** then **Start Proxy**. |

## Configuration reference

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.proxy.enabled` | `false` | Start proxy on extension activation |
| `cursorAccounts.proxy.port` | `8080` | Local TCP port |
| `cursorAccounts.proxy.maxLogSizeMB` | `100` | Max total log size before rotation |
| `cursorAccounts.proxy.autoLaunchWithProxy` | `true` | Inject proxy args when launching profiles if proxy is running |
