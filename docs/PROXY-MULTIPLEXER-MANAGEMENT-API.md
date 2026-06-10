# Multiplexer Management API

**Last reviewed:** 2026-06-10

## Overview

The global multiplexer exposes a **Management API** on the same port as the MITM proxy (`127.0.0.1:9000`). All Cursor extension windows communicate with the multiplexer through this API — no window accesses the runtime directly.

Routes are prefixed with `/_api/` and are intercepted by `MultiplexerMitmServer` before proxy forwarding.

## Architecture

```
Extension windows
  └─ ProfileMultiplexerService
       └─ ManagementApiClient (HTTP + WebSocket)
            ↓
Multiplexer MITM process (:9000)
  ├─ MultiplexerMitmServer (all IDE traffic)
  └─ ManagementApiServer (/_api/*)
       └─ Reads UpstreamWorkerRegistry, MetricsAggregator, SessionStore
```

Upstream workers are **analysis processes**, not proxy endpoints. The API exposes their metadata (profile, workspace, health, traffic count) — not host/port.

## HTTP endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/_api/health` | Health check (`{ "status": "ok" }`) |
| GET | `/_api/status` | Running state, port, strategy, sessions, worker count |
| GET | `/_api/metrics` | Current metrics snapshot |
| GET | `/_api/upstreams` | All upstream workers |
| GET | `/_api/upstreams?profileId=X` | Workers for a profile |
| GET | `/_api/sessions` | Active session bindings |
| GET | `/_api/config` | Router and routing configuration |
| POST | `/_api/upstreams` | Create worker (`{ profileId, workspacePath, userDataDir? }`) |
| DELETE | `/_api/upstreams/:upstreamId` | Stop one worker |
| DELETE | `/_api/upstreams/profile/:profileId` | Stop all workers for a profile |

### Upstream DTO

```json
{
  "id": "profile-a-a1b2c3d4",
  "healthy": true,
  "trafficReceived": 42,
  "metadata": {
    "profileId": "profile-a",
    "workspacePath": "/path/to/workspace"
  }
}
```

### Examples

```bash
curl -s http://127.0.0.1:9000/_api/status | jq
curl -s 'http://127.0.0.1:9000/_api/upstreams?profileId=work-uuid' | jq
curl -s -X POST http://127.0.0.1:9000/_api/upstreams \
  -H 'Content-Type: application/json' \
  -d '{"profileId":"work-uuid","workspacePath":"/path/to/repo"}' | jq
```

## WebSocket

Connect to `ws://127.0.0.1:9000/_api/ws` for push notifications:

| Event | Description |
|-------|-------------|
| `upstream_created` | Worker registered for profile+workspace |
| `upstream_stopped` | Worker stopped |
| `metrics_updated` | Metrics snapshot changed |
| `status_changed` | Running state or worker count changed |
| `config_changed` | Routing config changed |

## Extension integration

1. **Startup:** `MultiplexerRegistry.ensureStarted()` starts the MITM multiplexer (or detects port 9000 in use).
2. **Window launch:** `ProfileLauncher` creates an upstream worker for `(profileId, workspacePath)`.
3. **Queries:** `ProfileMultiplexerService` uses `ManagementApiClient` for status, metrics, workers.
4. **Stop profile proxy:** `DELETE /_api/upstreams/profile/:profileId`.

## Logging

API requests are logged as `[API] GET /_api/status → 200` in the multiplexer JSONL log.
