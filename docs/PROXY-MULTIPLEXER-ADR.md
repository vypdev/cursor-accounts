# Proxy Multiplexor ADRs

**Last reviewed:** 2026-06-06

## ADR 001: Node.js for first implementation

**Status:** Accepted

Use Node.js/TypeScript to reuse the existing MITM stack (`ProxyManager`, `proxyDecode`, `protoRegistry`). Go/Rust remain options if router throughput becomes a bottleneck.

## ADR 002: Default routing strategy

**Status:** Accepted (updated 2026-06-09)

Default to `workspace-path` with fallback `sticky-session`. Workspace-path extracts profile and project from JWT + protobuf and creates upstream MITM proxies on demand. Sticky-session handles CONNECT traffic before workspace is known.

## ADR 003: Sticky session key

**Status:** Accepted

Use `remoteAddress:remotePort` as the session key. Each Cursor window uses distinct ephemeral ports, giving automatic per-window stickiness.

## ADR 004: Clean Architecture layering

**Status:** Accepted

Domain ports (`IRoutingStrategy`, `IUpstreamPool`, `IMultiplexerServer`) live in `src/domain`. Infrastructure adapters live in `src/proxy/multiplexer`. Application services orchestrate lifecycle without importing Node APIs.

## ADR 005: TCP connect health checks

**Status:** Accepted

Health checks probe upstream MITM ports with short TCP connect attempts. This is sufficient because upstreams are local MITM listeners, not remote HTTPS endpoints.

## ADR 006: In-memory session store

**Status:** Accepted

Session bindings are stored in memory. Restarting the multiplexor reassigns sessions, which is acceptable for desktop development workflows.

## ADR 007: Configuration source

**Status:** Accepted (updated 2026-06-09)

Multiplexer configuration is built in code via `buildMultiplexerConfig()` with optional VS Code setting overrides (`cursorAccounts.proxy.multiplexer.routingStrategy`). Upstreams are always created dynamically; there is no static upstream list at startup.

## ADR 008: Workspace path routing via protobuf

**Status:** Accepted

`workspace-path` decodes `BidiAppend` protobuf payloads using the existing `decodeProtoEntry` pipeline and extracts `workspace_uris` / `workspace_root_path`. Falls back to sticky sessions when workspace cannot be resolved.
