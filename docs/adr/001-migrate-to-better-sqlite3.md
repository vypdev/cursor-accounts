# ADR-001: Migrate to better-sqlite3 with Persistent Connections

## Status
Accepted

## Context

The extension currently uses a CLI subprocess model for SQLite operations, spawning a new `sqlite3` binary process for each database operation via `execFileSync` or `spawn`. This approach has several issues:

1. **Performance**: Process spawn overhead (50-100ms) for each operation
2. **Concurrency**: No WAL mode or busy_timeout configured → "database is locked" errors when multiple VS Code windows access the same database
3. **Transactions**: Not possible to use multi-statement transactions (each subprocess is independent)
4. **Resource usage**: Spawning hundreds of processes per minute during active agent streaming

**Current symptoms** (reported by users):
- "database is locked" errors in logs when opening multiple windows with the same profile
- `agent_tokens` table remains empty despite `agents` records being created
- High CPU usage from constant process spawning

## Decision

Migrate to **better-sqlite3 v11** with **persistent connections per VS Code window**.

### Key changes:
1. Each extension host (VS Code window) maintains a `BetterSqliteConnectionManager` singleton
2. Connections are opened lazily and cached for the extension lifecycle
3. WAL mode enabled immediately on connection (`PRAGMA journal_mode=WAL`)
4. 5-second `busy_timeout` to handle lock contention gracefully
5. Prepared statements cached in repository layer for frequently-used queries

### Clean Architecture preservation:
- Domain layer defines `IDatabaseConnectionManager` port (interface)
- Infrastructure layer implements via `BetterSqliteConnectionManager` (adapter)
- Application layer (`AgentTrackingService`) depends only on port, not adapter
- No `import better-sqlite3` outside of `src/persistence/betterSqlite/`

## Consequences

### Positive
1. **Performance**: 10-100x faster operations (no process spawn overhead)
2. **Multi-window**: WAL mode + busy_timeout eliminates "database is locked" errors
3. **Transactions**: Real ACID transactions possible for batch operations
4. **Resource efficiency**: Persistent connections reduce CPU and memory churn
5. **Code quality**: Prepared statements prevent SQL injection, improve maintainability

### Negative
1. **Build complexity**: Requires `electron-rebuild` to compile native module for each platform
2. **Bundle size**: +5MB better-sqlite3 binaries per platform (but -10MB when legacy CLI removed)
3. **Native dependencies**: More fragile than pure JS/CLI (platform-specific binary issues possible)
4. **Migration effort**: ~3-5 weeks for complete implementation and testing

### Mitigation
- **Feature flag**: Removed in v0.1.35; better-sqlite3 is the only agent tracking implementation
- **CI pre-build**: GitHub Actions matrix builds native binaries for all 6 platforms
- **Rollback path**: Users can opt-out to CLI if issues occur
- **Grace period**: 4+ weeks with better-sqlite3 as default before removing legacy code

## Alternatives Considered

### A) Keep CLI, add WAL mode via PRAGMA in migration
**Rejected**: Would require modifying bundled `sqlite3` binaries or CLI flags. Process spawn overhead remains.

### B) Use @vscode/sqlite3 (VS Code's internal SQLite module)
**Rejected**: Not designed for extension use; undocumented, may break with VS Code updates.

### C) Write queue to serialize all writes
**Rejected**: Adds complexity for minimal benefit. WAL + busy_timeout achieves serialization automatically.

### D) Switch to different database (e.g., IndexedDB, LevelDB)
**Rejected**: Would require re-architecting schema, migrations, and queries. SQLite is ideal for this use case.

## References

- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3)
- [SQLite WAL mode documentation](https://www.sqlite.org/wal.html)
- [VS Code extension native modules guide](https://code.visualstudio.com/api/advanced-topics/extension-host)
- User issue: "database is locked" errors in logs (conversation context)
