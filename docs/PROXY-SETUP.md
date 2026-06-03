# MITM Proxy Setup

The Cursor Accounts extension can run a local MITM proxy to observe HTTP/HTTPS traffic between Cursor and its servers. This is intended for **research and debugging** only.

## Enable the proxy

The proxy process and its state file live under `~/.cursor-accounts/proxy` so **every Cursor window** (default profile and profile windows) sees the same running/stopped status.

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

When the proxy is **running**, launching a profile from the Accounts panel:

- Writes `http.proxy` to that profile's `User/settings.json` (with `http.proxySupport: "override"`)
- Backs up any existing `http.proxy` to `http.proxy.backup` (restored later)
- Sets `NODE_EXTRA_CA_CERTS` in the environment when spawning Cursor (for Node/Electron)

When you **stop the proxy** or open the **default Cursor window** (no managed profile), the extension restores the original proxy settings in **all** stored profiles.

When the proxy **starts**, temporary proxy overrides are cleared from every profile so none use the proxy until you launch a profile again.

Windows opened **before** the proxy started, or already running when settings change, may need a **window reload** or relaunch to pick up `settings.json` changes.

### Where to see `http.proxy` in Cursor Settings

`http.proxy` is an **application-scoped** setting. In the Settings UI it appears under **Application → Proxy** with the note **(Applies to all profiles)** — that refers to Cursor’s built-in Settings Profiles inside the same window, not to Cursor Accounts profiles.

The value is stored in:

`<profile-user-data-dir>/User/settings.json`

For a Cursor Accounts profile at `~/.cursor-myaccount`, open that file or run **Preferences: Open Application Settings (JSON)** (not **Open User Settings (JSON)**, which opens the current VS Code Settings Profile file under `User/profiles/...` and will not show `http.proxy`).

If the field is empty after starting the proxy:

1. Start the proxy, then **launch the profile again** from the Accounts panel (or reload the window).
2. Confirm the proxy was running **before** launch.
3. Check `User/settings.json` on disk for `http.proxy` and `http.proxySupport`.

The Accounts panel shows a **Temporary proxy** badge on profiles whose `settings.json` was modified and will be restored automatically.

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
| Panel shows proxy running but this window does not use it | Launch the profile again after starting the proxy, or reload the window. |
| Empty proxy logs | Ensure the profile window was launched after the proxy started; confirm `http.proxy` in that profile's settings. |
| Profile shows **Temporary proxy** badge | Normal while the proxy is active; settings revert when the proxy stops or the default window opens. |
| Stale “running” status | The proxy process may have crashed; click **Stop Proxy** then **Start Proxy**. |

## Configuration reference

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.proxy.enabled` | `false` | Start proxy on extension activation |
| `cursorAccounts.proxy.port` | `8080` | Local TCP port |
| `cursorAccounts.proxy.maxLogSizeMB` | `100` | Max total log size before rotation |
