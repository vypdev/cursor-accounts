# Clean Architecture principles (cursor-accounts)

How this extension structures proxy and tracking code.

**Last reviewed:** 2026-06-04

---

## Dependency rule

Dependencies point **inward**:

- **Infrastructure** (`src/proxy/`, `src/persistence/`) implements domain ports.
- **Application** (`src/services/`, `src/application/types/`) orchestrates use cases and shared DTOs.
- **Domain** (`src/domain/`) has no imports from VS Code, `http-mitm-proxy`, or httpolyglot.

Example: [`IProxyServer`](../src/domain/ports/IProxyServer.ts) is implemented by [`PolyglotMitmProxyServer`](../src/proxy/polyglotMitmProxyServer.ts), not the reverse.

---

## Ports and adapters

| Port | Adapter(s) |
|------|------------|
| `IProxyManager` | `ProxyManager` (facade) |
| `IProxyProcess` | `NodeProxyProcess` |
| `IProxyCertificateService` | `ProxyCertificateService` |
| `IProxyTrafficBus` | `ProxyTrafficBus` |
| `IProxyTrafficIngress` | `ProxyTrafficIngress` |
| `IProxyServer` | `PolyglotMitmProxyServer` (production), `MitmProxyServer` (HTTP/1.x base) |
| `IProtocolAdapter` | `Http10ProtocolAdapter`, `Http11ProtocolAdapter`, `Http2ProtocolAdapter` |
| `ITrafficDecoder` | `ConnectTrafficDecoder` (batch JSONL; streaming still in MITM) |

Protocol adapters normalize HTTP/1.x vs HTTP/2 metadata for JSONL (`protocolVersion` field) without coupling decode logic to transport.

---

## Single responsibility

| Component | One job |
|-----------|---------|
| `httpolyglotHttpsPatch` | Swap HTTPS server factory for ALPN/http2 |
| `StreamingAgentDecoder` | Connect frame → `token_delta` / `turn_ended` |
| `AgentTrackingService` | Persist billing rows |
| `AgentLiveUsageStatusBar` | Show live counters |

---

## Extensibility

To add a new protocol version or log field:

1. Extend [`HttpProtocolVersion`](../src/domain/types/httpProtocol.ts) if needed.
2. Add an `IProtocolAdapter` implementation under `src/proxy/adapters/`.
3. Register in [`protocolDetection.ts`](../src/proxy/protocolDetection.ts).
4. Extend [`ProxyLogEntry`](../src/proxy/types.ts) and tests.

Decode paths (`StreamingAgentDecoder`) should remain unchanged when only metadata differs.

---

## HTTP/2 case study

See [HTTP2-PROXY-IMPLEMENTATION.md](HTTP2-PROXY-IMPLEMENTATION.md) for the full MITM + httpolyglot design.

---

## Proxy refactor case study

**Before:** `ProxyManager` (~850 lines) mixed child lifecycle, certificates, traffic fan-out, agent DB init, and log tailing.

**After:** Layered services with explicit ports:

- `IProxyProcess` → `NodeProxyProcess` (fork + IPC)
- `IProxyCertificateService` → `ProxyCertificateService`
- `IProxyTrafficBus` → `ProxyTrafficBus` (pub/sub + cost enrichment)
- `IProxyTrafficIngress` → `ProxyTrafficIngress` (JSONL tail when enabled)
- `RunSseStreamHandler` → builds live/turn summaries from `StreamingAgentDecoder`

Shared DTOs live in `src/application/types/` (`proxyTraffic`, `proxyInsights`, `proxyConfig`). UI presenters moved under `src/ui/presentation/` with re-exports from `src/proxy/` for backward compatibility.

---

## Multiplexer MITM + upstream workers

The global multiplexer uses a **MITM-first** design:

| Component | Responsibility |
|-----------|----------------|
| `MultiplexerMitmServer` | Full MITM proxy on port 9000 for **all** IDE traffic |
| `UpstreamWorkerManager` | Fork/manage analysis worker processes |
| `upstreamWorker.ts` | Child process: `AgentTrackingService` + persistent SQLite |
| `ManagementApiServer` | HTTP/WebSocket API on `/_api/*` |
| `MultiplexerRegistry` | Lifecycle only (start/stop multiplexer and workers) |
| `ProfileMultiplexerService` | API client facade for every extension window |

**Dependency rule:** `IUpstreamWorkerRegistry` (domain port) is implemented by `UpstreamWorkerRegistry` (infrastructure). Application services depend on the port, not the fork implementation.

Workers are created when `ProfileLauncher` opens a profile window with a workspace — not on-demand during routing. The multiplexer detects agent traffic and forwards summaries to the matching worker via IPC.

See [PROXY-MULTIPLEXER-ARCHITECTURE.md](PROXY-MULTIPLEXER-ARCHITECTURE.md) and [PROXY-MULTIPLEXER-MANAGEMENT-API.md](PROXY-MULTIPLEXER-MANAGEMENT-API.md).
