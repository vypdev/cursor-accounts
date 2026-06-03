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

**Important:** The proxy must sign TLS with the same CA you install from the panel (`Cursor Accounts MITM Proxy CA`). If Network Diagnostics shows interception by `Node MITM Proxy CA` / `NodeMITMProxyCA`, stop the proxy, delete `~/.cursor-accounts/proxy/certs/certs/` (except after updating the extension, restart proxy to regenerate), reinstall the panel CA, and relaunch Cursor. Older builds placed `ca.pem` in the wrong folder so `http-mitm-proxy` generated its own CA.

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
- Passes **`--proxy-server=http://127.0.0.1:<port>`** to Cursor (Chromium/Electron), using that profile's assigned MITM port (not always 8080 — see per-profile ports below)
- Sets `NODE_EXTRA_CA_CERTS` in the environment when spawning Cursor (for Node/Electron)

Each profile's proxy port is chosen from `8080`, `8081`, `8082`, or `8888` (first free port not used by another running profile proxy). The same port is used in `settings.json`, `--proxy-server`, and the proxy process listen address.

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

Logs are JSON Lines files under shared proxy storage:

`~/.cursor-accounts/proxy/logs/proxy-YYYY-MM-DD-*.jsonl`

Large request/response bodies are **not truncated** by default: they are written in full to `logs/bodies/*.bin` and referenced from the JSONL line as `bodyFile`. Configure inline size via **Proxy: Max Body Log MB** (default 4) and **Proxy: Spill Large Bodies** (default on).

Total disk usage (JSONL + spilled bodies) is capped by **Proxy: Max Log Size MB** (default 500).

Open the folder via **View Logs** in the panel or **Cursor Accounts: Open Proxy Logs**.

Analyze captured traffic:

```bash
pnpm run verify:proto-jsonl
pnpm run analyze:proxy-traffic
pnpm run scan:proxy-interactive
```

### Interactive chat vs background traffic

Cursor uses **several API hosts**. A log can look “healthy” (billing, agent snapshots) while **chat streams are missing**:

| Traffic | Typical host | Connect path |
|---------|--------------|--------------|
| Usage / billing | `api2.cursor.sh` | `aiserver.v1.DashboardService/GetCurrentPeriodUsage` |
| Agent file snapshots (metrics) | `api2.cursor.sh` | `aiserver.v1.OnlineMetricsService/ReportAgentSnapshot` |
| **Composer / legacy chat** | `api2.cursor.sh` | `aiserver.v1.AiService/StreamComposer`, `StreamChat`, … |
| **Agent chat (HTTP/2)** | `agent.api5.cursor.sh` | `agent.v1.AgentService/Run` / `RunSSE` |
| **Agent chat (HTTP/1)** | `api2.cursor.sh` | `agent.v1.AgentService/RunPoll`, `aiserver.v1.BidiService/BidiAppend`, … |

If you only see `api2` + `ReportAgentSnapshot` but **no** interactive RPCs, the proxy did not capture a chat turn.

**Checklist for chat capture:**

1. Proxy **running**, CA **trusted** (panel CA must match proxy signing CA — see note above on `NodeMITMProxyCA`), profile **relaunched** from Accounts.
2. With MITM, prefer **HTTP/1** (`cursor.general.disableHttp2: true`) so Agent uses `RunPoll` on `api2`.
3. Send a **new Agent message** while logging.
4. Run `pnpm run scan:proxy-interactive` — expect `RunPoll` / `BidiAppend` on api2, or `api5` / `StreamComposer` depending on HTTP mode.
5. Run `pnpm run analyze:proxy-traffic` — decoded `BidiAppend` rows include `insights.agent` (`requestId`, `appendSeqno`, optional `dataPreview` / `dataBytes`).

Composer message **metadata** is also stored locally in `state.vscdb`; the MITM proxy only sees **network** RPCs.

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
| Logs have billing/snapshots but no chat | Agent chat uses `agent.api5.cursor.sh`, not `StreamComposer` on `api2`; relaunch profile, send a test prompt, run `scan:proxy-interactive`. Many `HTTPS_CLIENT_ERROR` / certificate lines mean the CA is not trusted for some clients — reinstall CA and relaunch. |
| Network Diagnostics: API/Chat/Agent fail, SSL warns `Node MITM Proxy CA` | Proxy leaf certs signed by wrong CA; stop proxy, restart extension/proxy (regenerates `certs/ca.pem`), confirm diagnostics mention `Cursor Accounts MITM Proxy CA` or no warning after trusting panel CA. Try `cursor.general.disableHttp2` only after CA matches. |
| Profile shows **Temporary proxy** badge | Normal while the proxy is active; settings revert when the proxy stops or the default window opens. |
| Stale “running” status | The proxy process may have crashed; click **Stop Proxy** then **Start Proxy**. |

## Configuration reference

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.proxy.enabled` | `false` | Start proxy on extension activation |
| `cursorAccounts.proxy.port` | `8080` | Local TCP port |
| `cursorAccounts.proxy.maxLogSizeMB` | `100` | Max total log size before rotation |
