# Proxy API Reference

The MITM proxy child process exposes a **localhost-only** control-plane API. All extension host windows communicate with the proxy exclusively through this API (traffic, stats, health, shutdown). No IPC channel is used.

## Ports

| Role | Default | Setting |
|------|---------|---------|
| MITM listen port | `8080` (per profile: `8080`–`8888`) | `cursorAccounts.proxy.port` + per-profile assignment |
| API control plane | MITM port + **10000** (e.g. `18080`) | `cursorAccounts.proxy.apiPortOffset` |

The API port is persisted in each profile's `proxy-state.json` as `apiPort`.

## Base URL

```
http://127.0.0.1:{apiPort}
```

Example: MITM on `8080` → API on `http://127.0.0.1:18080`.

## Security

- All REST and WebSocket endpoints accept connections **from localhost only** (`127.0.0.1` / `::1`).
- No authentication token is required; the API must never be exposed beyond loopback.

## REST Endpoints

### `GET /api/health`

Health check. The extension polls this endpoint after forking the proxy child to detect when the API is ready (typically within 1s).

**Response**

```json
{
  "ok": true,
  "version": 1
}
```

### `GET /api/status`

Current proxy runtime state.

**Response**

```json
{
  "running": true,
  "mitmPort": 8080,
  "apiPort": 18080,
  "profileId": "profile-uuid",
  "pid": 12345,
  "startedAt": "2026-06-10T02:23:00.000Z",
  "uptimeMs": 45000
}
```

### `GET /api/stats`

Aggregated traffic counters from the MITM server.

**Response:** [`ProxyStatistics`](../packages/types/src/entities/ProxyStatus.ts) JSON object (`totalRequests`, `cursorRequests`, `bytesTransferred`, `activeConnections`, optional `diagnostics`).

### `POST /api/shutdown`

Request graceful shutdown of the proxy child process. Returns immediately; the process exits after stopping MITM and the API server.

**Response**

```json
{ "success": true }
```

## WebSocket API

### Connection

```
ws://127.0.0.1:{apiPort}/ws
```

Only localhost clients are accepted.

### Event envelope

All messages are JSON objects:

```json
{
  "type": "traffic",
  "timestamp": "2026-06-10T02:23:00.000Z",
  "profileId": "profile-uuid",
  "data": { }
}
```

### Event types

| `type` | `data` shape | Description |
|--------|--------------|-------------|
| `traffic` | `ProxyTrafficSummary` | Redacted request/response/error summary (live token updates, turn ended, agent insights) |
| `stats` | `ProxyStatistics` | Periodic counters (~5s) |
| `diagnostics` | `{ "lines": string[] }` | `[ProxyDiagnostics]` summary lines when enabled |
| `error` | `{ "message": string, "kind"?: string }` | Proxy-level errors |

### Example: traffic event

```json
{
  "type": "traffic",
  "timestamp": "2026-06-10T02:23:01.234Z",
  "profileId": "abc-123",
  "data": {
    "timestamp": "2026-06-10T02:23:01.200Z",
    "kind": "response",
    "url": "https://api2.cursor.sh/agent.v1.AgentService/RunSSE",
    "host": "api2.cursor.sh",
    "endpoint": "/agent.v1.AgentService/RunSSE",
    "isLiveTokenUpdate": true,
    "liveTokenData": {
      "accumulatedTokens": 1200,
      "latestDelta": 42
    }
  }
}
```

## Extension integration

| Component | Role |
|-----------|------|
| [`ProxyApiServer`](../src/proxy/api/proxyApiServer.ts) | Runs inside the proxy child; broadcasts events |
| [`ProxyApiClient`](../src/proxy/api/proxyApiClient.ts) | Used by each extension host window |
| [`ProxyTrafficIngress`](../src/application/services/proxyTrafficIngress.ts) | Connects WebSocket + optional JSONL tail |
| [`ProxyManager.connectToExistingProxy()`](../src/services/proxyManager.ts) | Attaches a new window to a running proxy |

On extension activation, every window calls `connectToExistingProxy()` for all profiles, then ensures the proxy for the active profile if enabled.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cursorAccounts.proxy.apiPortOffset` | `10000` | Added to MITM port to derive API port |

Traffic and stats are always consumed via the localhost WebSocket API.

## Manual testing

```bash
# Status
curl -s http://127.0.0.1:18080/api/status | jq

# Stats
curl -s http://127.0.0.1:18080/api/stats | jq

# WebSocket (requires wscat)
wscat -c ws://127.0.0.1:18080/ws
```

## Related docs

- [PROXY-SETUP.md](PROXY-SETUP.md) — Enable proxy and trust CA
- [ARCHITECTURE.md](ARCHITECTURE.md) — Subsystem overview
- [TESTING-MULTI-WINDOW.md](TESTING-MULTI-WINDOW.md) — Multi-window attach scenarios
- [PROXY-JSONL-SCHEMA.md](PROXY-JSONL-SCHEMA.md) — Offline JSONL format (development mode)
