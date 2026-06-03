# MITM Proxy Setup

The Cursor Accounts extension can run a local MITM proxy to observe HTTP/HTTPS traffic between Cursor and its servers. This is intended for **research and debugging** only.

## Enable the proxy

1. Open VS Code/Cursor Settings and search for `cursorAccounts.proxy`.
2. Set **Proxy: Enabled** to start the proxy when the extension activates, or use the Accounts panel **MITM Proxy** card to start/stop manually.
3. Default listen address: `127.0.0.1:8080` (configurable via **Proxy: Port**).

## Trust the CA certificate

HTTPS interception requires trusting the extension-generated CA:

1. In the Accounts panel MITM Proxy card, click **Install instructions** to open the guided setup dialog.
2. **macOS / Windows:** click **Install to Keychain** or **Install certificate**. The OS shows a native permission dialog (macOS password / Windows UAC). Accept to install, or cancel to skip — installation is never forced.
3. **Linux:** use **Save CA certificate…**, then copy and run the terminal commands shown in the dialog (`sudo cp` + `update-ca-certificates`).
4. If automatic install fails, use the **Manual installation** section in the same dialog, or **Cursor Accounts: Save Proxy CA Certificate…** from the Command Palette.

Without trusting the CA, Cursor may reject TLS connections when using the proxy.

The MITM Proxy card in the Accounts panel shows two status badges: **Running / Stopped** (proxy process) and **CA trusted / CA not trusted** (system trust store). The CA badge is checked only when needed (opening or focusing the panel, after install, when starting the proxy)—not continuously in the background.

## Remove the CA certificate

When the panel shows **CA trusted**, a **Delete certificate** button appears on the MITM Proxy card:

1. Click **Delete certificate** and confirm the prompt.
2. **macOS / Windows:** the OS shows a native permission dialog (same as install). Accept to remove the CA from the system trust store.
3. **Linux:** automatic removal is not supported; the extension shows the terminal commands to run (`sudo rm` the file under `/usr/local/share/ca-certificates/` + `sudo update-ca-certificates`).

After removal, the badge should show **CA not trusted** when you focus the panel again.

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
| Cursor network errors | Install the CA certificate; confirm the panel shows **CA trusted**, then restart Cursor if needed. |
| Panel shows **CA not trusted** after install | Focus the Accounts panel again to refresh; on Linux, confirm `/usr/local/share/ca-certificates/cursor-accounts-mitm.crt` exists and run `sudo update-ca-certificates`. |
| Panel shows proxy running but this window does not use it | Launch the profile again after starting the proxy. |
| Stale “running” status | The proxy process may have crashed; click **Stop Proxy** then **Start Proxy**. |

## Configuration reference

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.proxy.enabled` | `false` | Start proxy on extension activation |
| `cursorAccounts.proxy.port` | `8080` | Local TCP port |
| `cursorAccounts.proxy.maxLogSizeMB` | `100` | Max total log size before rotation |
| `cursorAccounts.proxy.autoLaunchWithProxy` | `true` | Inject proxy args when launching profiles if proxy is running |
