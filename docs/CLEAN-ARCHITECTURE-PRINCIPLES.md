# Clean Architecture principles (cursor-accounts)

How this extension structures proxy and tracking code.

**Last reviewed:** 2026-08-25

The complete executable layer matrix is maintained in
[ARCHITECTURE-CONTRACT.md](ARCHITECTURE-CONTRACT.md).

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

- `IProxyProcess` → `NodeProxyProcess` (spawn, sin IPC; lifecycle via localhost API)
- `IProxyCertificateService` → `ProxyCertificateService`
- `IProxyTrafficBus` → `ProxyTrafficBus` (pub/sub + cost enrichment)
- `IProxyTrafficIngress` → `ProxyTrafficIngress` (JSONL tail when enabled)
- `RunSseStreamHandler` → builds live/turn summaries from `StreamingAgentDecoder`

Shared DTOs live in `src/application/types/` (`proxyTraffic`, `proxyInsights`, `proxyConfig`). UI presenters moved under `src/ui/presentation/` with re-exports from `src/proxy/` for backward compatibility.

The architecture gate is executable with `pnpm run check:architecture`. It
uses the TypeScript AST and module resolver, checks type and runtime imports,
resolves workspace package entrypoints, reports line-level rule identifiers,
fails closed on unresolved relative imports, excludes tests/generated output
from the production graph, and detects static cycles. The independent fixture
suite is `pnpm run test:architecture`.

The gate keeps `ProxyLogEntry` in the application boundary instead of making
the domain decoder port depend on `src/proxy/`. The previously detected
certificate-manager/install-helper cycle was removed by moving the shared CA
constant to `src/proxy/certificateConstants.ts`.
