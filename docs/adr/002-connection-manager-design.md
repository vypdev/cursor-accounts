# ADR-002: Connection Manager Design (Per-Window Strategy)

## Status
Accepted

## Context

VS Code extensions run in an extension host process, one per window. When a user opens multiple windows pointing to the same Cursor profile, each window gets its own extension host process. Both may need to write to the same SQLite database file (`cursor-accounts-efficiency.db`) simultaneously.

**Challenge**: SQLite allows only one writer at a time (even in WAL mode), so we need a strategy to:
1. Avoid "database is locked" errors
2. Minimize latency (no remote coordination overhead)
3. Keep architecture simple (no message passing between windows)

## Decision

Implement a **per-window connection manager** with the following design:

### Architecture

```
Window 1                          Window 2
  ↓                                 ↓
Extension Host Process 1       Extension Host Process 2
  ↓                                 ↓
BetterSqliteConnectionManager  BetterSqliteConnectionManager
  ↓                                 ↓
Connection (cached)            Connection (cached)
  ↓                                 ↓
        ↓                     ↓
        └─→ WAL Mode ←────────┘
         cursor-accounts-efficiency.db
         cursor-accounts-efficiency.db-wal  (shared buffer)
         cursor-accounts-efficiency.db-shm  (shared memory)
```

### Key design decisions:

1. **One manager per window** (no cross-window communication)
   - Each extension host creates its own `BetterSqliteConnectionManager` instance
   - Managers are independent; they don't know about each other

2. **Connection caching per database path**
   - `Map<string, BetterSqliteConnection>` keyed by absolute path
   - Reuse connection if already open (avoids re-opening overhead)

3. **WAL mode enables concurrent access**
   - `PRAGMA journal_mode=WAL` set immediately on connection
   - Allows multiple readers + 1 writer across processes
   - SQLite handles coordination via shared memory (-shm file)

4. **Busy timeout for lock contention**
   - `PRAGMA busy_timeout=5000` (5 seconds)
   - If another process holds write lock, wait up to 5s instead of immediate failure
   - Sufficient for bursty write patterns (agent streaming)

5. **Graceful shutdown**
   - `closeAllConnections()` called on extension deactivation
   - WAL checkpoint before close (`PRAGMA wal_checkpoint(TRUNCATE)`)
   - Errors logged but don't fail deactivation

### Configuration pragmas

```sql
PRAGMA journal_mode = WAL;         -- Multi-process concurrency
PRAGMA busy_timeout = 5000;        -- Wait 5s on lock contention
PRAGMA synchronous = NORMAL;       -- Faster commits in WAL mode (still safe)
PRAGMA foreign_keys = ON;          -- Enforce referential integrity
PRAGMA temp_store = MEMORY;        -- Faster temp operations
```

## Implementation Notes

### Native Binding Path Resolution (2026-06-06)

To avoid issues with the `bindings` package in VS Code extension context, we explicitly specify the native binding path:

```typescript
const nativeBindingPath = path.join(
  __dirname,
  '../../../node_modules/better-sqlite3/build/Release/better_sqlite3.node'
);

const db = new Database(dbPath, {
  nativeBinding: nativeBindingPath,
  // ... other options
});
```

This prevents the `bindings.getRoot()` error that occurred when `bindings` tried to navigate the module tree from an internal Node.js module path like `node:internal/process/task_queues`.

## Consequences

### Positive
1. **Simple**: No inter-process communication or centralized coordinator
2. **Fast**: Direct file access, no network/IPC overhead
3. **Reliable**: SQLite's WAL mode is battle-tested for multi-process scenarios
4. **Scalable**: Works with N windows (not just 2)

### Negative
1. **Write serialization**: Only one writer at a time (SQLite inherent limitation)
2. **Busy-wait**: Blocked writers consume CPU spinning (mitigated by 5s max)
3. **WAL file overhead**: Additional -wal and -shm files (typically small, <1MB)

### Risks and mitigation

**Risk**: Pathological write pattern (sustained writes from multiple windows) could cause timeouts.
**Mitigation**: 
- Most writes are bursty (agent streaming finishes in <1 min)
- 5s timeout is generous for typical write durations (<10ms)
- If timeouts persist, logs will show; can increase timeout or add retry logic

**Risk**: WAL file grows unbounded if checkpoints fail.
**Mitigation**:
- Explicit checkpoint on connection close
- SQLite auto-checkpoints at 1000 pages (~4MB)
- `vacuum` command (manual cleanup action) also triggers checkpoint

## Alternatives Considered

### A) Single connection shared via IPC (message passing between windows)
**Rejected**: Complex to implement, adds latency, single point of failure. Benefits don't justify complexity.

### B) One database file per window
**Rejected**: Can't aggregate data across windows (e.g., total tokens for a profile). Complicates queries and cleanup.

### C) Exclusive lock per profile (only one window can write)
**Rejected**: Poor UX (users can't open multiple windows with same profile). WAL mode solves this better.

### D) External database server (Postgres, MySQL)
**Rejected**: Overkill for local extension data. Requires running server, networking, authentication.

## References

- [SQLite WAL mode](https://www.sqlite.org/wal.html)
- [SQLite locking and concurrency](https://www.sqlite.org/lockingv3.html)
- [better-sqlite3 multi-process FAQ](https://github.com/WiseLibs/better-sqlite3/issues/250)
- VS Code extension host architecture (single-threaded Node.js per window)
