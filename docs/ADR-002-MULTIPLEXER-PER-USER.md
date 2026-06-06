# ADR 002: One Multiplexer Per User (Profile)

**Status:** Accepted  
**Date:** 2026-06-06

## Context

We need to track metrics (tokens, costs) per project (workspace), not only per user (profile). An earlier design used a single global multiplexer router. That worked for routing but:

1. Mixed workspace mappings across different users on the same machine
2. Required complex garbage-collection logic for shared resources
3. Made it hard to isolate configs and metrics by user

The legacy alternative — one MITM proxy per profile with no router — could not isolate metrics when multiple Cursor windows shared a profile.

## Decision

Each VS Code profile gets a dedicated multiplexer:

- **Router ports**: 9000–9099 (one per profile)
- **Upstream ports**: 8000–8999 (segmented per profile, dynamic per workspace)
- **Lifecycle**: created on profile window launch, stopped when the profile multiplexer is stopped
- **Routing default**: `workspace-path` with dynamic upstream creation

## Consequences

### Positive

- Full user isolation: configs, upstreams, and metrics are scoped to the profile
- Simpler GC: upstreams are cleaned per profile, not globally
- Scalable for single-machine use: up to 100 concurrent profile routers

### Negative

- More processes: N profiles ⇒ N multiplexer processes plus M upstreams per profile
- Port exhaustion: limited to 100 profiles in the 9000–9099 range

### Neutral

- Port allocation is sequential within the extension process (9000 for first profile, 9001 for second, etc.)

## Alternatives considered

1. **Single global multiplexer** — simpler process model, no per-user isolation
2. **Per-workspace proxies without a router** — no protobuf-based workspace detection layer
3. **Keep legacy + optional multiplexer** — rejected; dual code paths increased maintenance and confusion

## Implementation

- `MultiplexerRegistry` — `src/application/services/multiplexerRegistry.ts`
- `ProfileMultiplexerService` — `src/application/services/profileMultiplexerService.ts`
- `WorkspacePathStrategy` — `src/proxy/multiplexer/routing/workspacePathStrategy.ts`

See [PROXY-MULTIPLEXER-ARCHITECTURE.md](PROXY-MULTIPLEXER-ARCHITECTURE.md) for the full data flow.
