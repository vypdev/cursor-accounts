# Proxy Multiplexor ADRs

**Last reviewed:** 2026-06-06

## ADR 001: Node.js for first implementation

**Status:** Accepted

Use Node.js/TypeScript to reuse the existing MITM stack (`ProxyManager`, `proxyDecode`, `protoRegistry`). Go/Rust remain options if router throughput becomes a bottleneck.

## ADR 002: Default routing strategy

**Status:** Accepted

Default to `sticky-session` (source IP:port). It requires no payload inspection, works for CONNECT tunnels immediately, and isolates windows in the common case.

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

## ADR 007: JSON configuration file

**Status:** Accepted

Persist advanced config at `~/.cursor-accounts/proxy/multiplexer-config.json`. VS Code settings provide user-friendly defaults; the file supports power users and tests.

## ADR 008: Workspace path routing via protobuf

**Status:** Accepted

`workspace-path` decodes `BidiAppend` protobuf payloads using the existing `decodeProtoEntry` pipeline and extracts `workspace_uris` / `workspace_root_path`. Falls back to sticky sessions when workspace cannot be resolved.
