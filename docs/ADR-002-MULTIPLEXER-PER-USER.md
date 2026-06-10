# ADR 002: One Multiplexer Per User (Profile)

**Status:** Superseded  
**Date:** 2026-06-06  
**Superseded by:** Global multiplexer on port 9000 (see `docs/PROXY-MULTIPLEXER-ARCHITECTURE.md` v2)

## Context

This ADR described one router per profile on ports 9000–9099. The implementation moved to a **single global router on port 9000** shared by all profiles, with profile identification via JWT and upstreams keyed by `(profileId, workspacePath)`.

## Historical decision (no longer active)

Each VS Code profile was to get a dedicated multiplexer on its own port. That design was replaced because:

- A global router simplifies extension startup and UI
- JWT-based profile identification works without per-profile router ports
- Dynamic upstreams per `(profileId, workspacePath)` provide the same isolation

## Current architecture

See `docs/PROXY-MULTIPLEXER-MIGRATION.md` section **v2: Global Multiplexer on Port 9000**.
