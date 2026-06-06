# Migration from Legacy Proxy System

**Last reviewed:** 2026-06-06

## What changed

**Before** (legacy system):

- One MITM proxy per profile on fixed ports (8080, 8081, 8082, …)
- Cursor launched with `--proxy-server=localhost:8080`
- No workspace isolation — multiple windows with the same profile shared metrics

**After** (multiplexer system):

- One multiplexer per profile on ports 9000–9099
- One MITM proxy per workspace on dynamic ports 8000–8999
- Cursor launches with `--proxy-server=localhost:900X`
- Full workspace isolation — metrics tracked per project

## Database changes

New columns track workspace context:

- `conversations.workspace_path`
- `agents.workspace_path`
- `agent_tokens_delta.workspace_path` (schema column; token rows join via `agents`)

Migration `009_add_workspace_tracking.sql` runs automatically on extension activation.

## Breaking changes

1. **Settings removed**
   - `cursorAccounts.proxy.multiplexer.enabled` — always on
   - `cursorAccounts.proxy.multiplexer.port` — per-profile allocation
   - `cursorAccounts.proxy.multiplexer.upstreamCount` — dynamic upstreams
   - `cursorAccounts.proxy.multiplexer.autoStart` — starts on profile launch

2. **Port changes**
   - Update firewall or monitoring rules from 8080–8082 to 9000–9099 (routers) and 8000–8999 (upstreams)

3. **Logs location**
   - Router logs: `~/.cursor-accounts/proxy/logs/router-{profileId}-*.jsonl`
   - Upstream MITM logs: `~/.cursor-accounts/proxy/logs/proxy-{upstreamId}-*.jsonl`

4. **Code removed**
   - `ensureProfileProxy` direct launch path
   - Global `MultiplexerManager` singleton

## Rollback

There is no rollback to the legacy system — the direct per-profile proxy launch path has been removed.

If you encounter issues:

1. Report to the extension repository
2. Disable proxy for the profile in the Accounts panel (Edit Profile → Route traffic through MITM proxy)

## Verification checklist

- [ ] Profile windows launch with `--proxy-server=http://127.0.0.1:900X`
- [ ] Accounts panel shows multiplexer running for the active profile
- [ ] Token metrics in the database include `workspace_path` for new traffic
- [ ] Multiple workspaces under one profile get separate upstream ports

---

## v2: Global Multiplexer on Port 9000

**Last reviewed:** 2026-06-06

### What changed

**Before** (v1 — per-profile multiplexers):

- One multiplexer per profile on ports 9000–9099
- Cursor launched with `--proxy-server=http://127.0.0.1:900X`
- Profile identified implicitly by dedicated router port

**After** (v2 — global multiplexer):

- **One global multiplexer** on port **9000** shared by all profiles
- Cursor configured via **`settings.json`** (`http.proxy: "http://127.0.0.1:9000"`)
- Profile identified by **JWT `Authorization` header** (email → `ProfileManager` lookup)
- Upstreams keyed by **`(profileId, workspacePath)`** composite index
- Stopping proxy for one profile stops only its upstreams; the global router stays running

### Breaking changes

1. **Single router port**
   - All profiles share port **9000** (no more 9000–9099 per-profile allocation)
   - Update firewall/monitoring rules accordingly

2. **Proxy configuration method**
   - `--proxy-server` CLI arg is **no longer used**
   - `ProfileSettingsManager` temporarily modifies each profile's `settings.json`
   - Settings are restored when proxy is disabled for that profile

3. **API changes**
   - `MultiplexerRegistry.getOrCreateForProfile()` → `ensureStarted()`
   - `MultiplexerRegistry.stopForProfile()` → `stopUpstreamsForProfile()` (does not stop global router)
   - `WorkspaceUpstreamCreator` callback now receives `(profileId, workspacePath)`

4. **Logs**
   - Global router logs: `~/.cursor-accounts/proxy/logs/router-global-*.jsonl`
   - Detailed flow logging in **Cursor MITM Proxy** output channel

### Migration steps

1. Update any scripts or docs referencing per-profile ports `900X`
2. Relaunch all profile windows after upgrading — settings.json will be updated automatically
3. Verify `lsof -i :9000` shows a single global router
4. Check output channel for JWT auth and routing logs on first request

### v2 verification checklist

- [ ] Extension activation starts global multiplexer on port 9000
- [ ] Multiple profiles share the same multiplexer (`lsof -i :9000`)
- [ ] Profile `settings.json` contains `http.proxy: "http://127.0.0.1:9000"` when proxy enabled
- [ ] Cursor launches **without** `--proxy-server`
- [ ] ProfileId resolved from `Authorization` JWT header
- [ ] Upstreams created per `(profileId, workspacePath)`
- [ ] Settings restored when proxy disabled for a profile
- [ ] Token metrics include correct `workspace_path` per project
