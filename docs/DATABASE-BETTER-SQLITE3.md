# Database — better-sqlite3 Implementation

**Status**: Default implementation for agent tracking (since v0.1.35)

This document describes the persistent connection architecture using `better-sqlite3`.

## Quick Start (Development)

### Prerequisites

1. Node.js 24.x (extension development; use the repository `.nvmrc`)
2. Electron version matching VS Code (for native module compilation)

### Setup

```bash
# Install dependencies (includes better-sqlite3)
pnpm install

# Rebuild native modules for current Node.js (for tests)
pnpm run rebuild:native:node

# Verify the binding, WAL mode, timeout, and foreign-key settings
pnpm run verify:native:node

# Rebuild for Electron (for extension runtime)
pnpm run rebuild:native:electron
```

Node.js and Electron use different native-module ABIs. The workspace binding
must be rebuilt for the runtime that will execute the code; a Node-compatible
binding is required by tests, while the Extension Host and packaged extension
require the Electron-compatible binding. `pnpm run rebuild:native` is the
Electron-default compatibility alias.

### Usage

Agent tracking always uses better-sqlite3. Reload the window after installing or updating the extension if native modules were rebuilt.

## Architecture

### Clean Architecture Layers

```
┌─────────────────────────────────────────────────┐
│ Domain Layer (business logic)                   │
│  └─ IDatabaseConnectionManager (port/interface) │
└────────────────┬────────────────────────────────┘
                 │ depends on (abstraction)
┌────────────────▼────────────────────────────────┐
│ Infrastructure Layer (implementation details)   │
│  ├─ BetterSqliteConnectionManager (adapter)     │
│  ├─ BetterSqliteConnection (wrapper)            │
│  └─ BetterSqliteAgentTrackingRepository         │
└─────────────────────────────────────────────────┘
```

### Key Files

| File | Role |
|------|------|
| `src/domain/ports/IDatabaseConnectionManager.ts` | Port (interface) defining connection contract |
| `src/persistence/betterSqlite/betterSqliteConnectionManager.ts` | Adapter implementing port via better-sqlite3 |
| `src/persistence/betterSqlite/betterSqliteConnection.ts` | Wrapper around better-sqlite3 Database instance |
| `src/persistence/betterSqlite/betterSqliteAgentTrackingRepository.ts` | Repository implementation using connections |

### Dependency Inversion

```typescript
// ❌ Bad: Application layer depends on concrete implementation
import Database from 'better-sqlite3';
class MyService {
  constructor(private db: Database.Database) {}
}

// ✅ Good: Application layer depends on abstraction (port)
import { IDatabaseConnectionManager } from '../domain/ports/IDatabaseConnectionManager';
class MyService {
  constructor(private connectionManager: IDatabaseConnectionManager) {}
}
```

## Connection Lifecycle

### Per-Window Instance

Each VS Code window (extension host process) has its own `BetterSqliteConnectionManager` instance:

```typescript
// In extension.ts
const connectionManager = new BetterSqliteConnectionManager();

// On activate
const conn = await connectionManager.getConnection('/path/to/db.sqlite');

// On deactivate
await connectionManager.closeAllConnections();
```

### Connection Caching

Connections are cached per database path:

```typescript
const conn1 = await manager.getConnection('/path/to/db.sqlite');
const conn2 = await manager.getConnection('/path/to/db.sqlite');
// conn1 === conn2 (same instance)
```

### WAL Mode Configuration

Connections are automatically configured on first open:

```sql
PRAGMA journal_mode = WAL;         -- Multi-process concurrency
PRAGMA busy_timeout = 5000;        -- 5s wait on SQLITE_BUSY
PRAGMA synchronous = NORMAL;       -- Faster commits in WAL mode
PRAGMA foreign_keys = ON;          -- Enforce referential integrity
PRAGMA temp_store = MEMORY;        -- Temp tables in memory
```

## Multi-Window Concurrency

### How It Works

```
Window 1 (PID 1234)              Window 2 (PID 5678)
        ↓                               ↓
ConnectionManager                 ConnectionManager
        ↓                               ↓
Connection (open)                Connection (open)
        ↓                               ↓
        └──── WAL Mode ────────────────┘
              ↓
       accounts.db
       accounts.db-wal  (shared write-ahead log)
       accounts.db-shm  (shared memory)
```

- **Readers**: Unlimited concurrent readers
- **Writers**: One writer at a time (serialized via SQLite locking)
- **Lock contention**: If write lock unavailable, wait up to 5s (`busy_timeout`)

### Testing Multi-Window

1. Open VS Code window 1 with profile A
2. Open VS Code window 2 with profile A (same profile)
3. Trigger agent streaming in both windows simultaneously
4. Verify: No "database is locked" errors in logs

## Transactions

### Automatic Transaction

```typescript
const result = conn.transaction(() => {
  conn.run('UPDATE accounts SET balance = balance - 100 WHERE id = 1');
  conn.run('UPDATE accounts SET balance = balance + 100 WHERE id = 2');
  return conn.get('SELECT SUM(balance) FROM accounts');
})();
// Auto-commit on success, auto-rollback on error
```

### Error Handling

```typescript
try {
  conn.transaction(() => {
    conn.run('INSERT INTO users (name) VALUES (?)', 'Alice');
    conn.run('INVALID SQL'); // Error!
  })();
} catch (error) {
  // Transaction rolled back automatically
  console.error('Transaction failed:', error);
}
```

## Prepared Statements

### Why Use Them

1. **Performance**: Compiled once, executed many times
2. **Security**: Prevents SQL injection
3. **Type safety**: Explicit parameter binding

### Example

```typescript
const insert = conn.prepare('INSERT INTO tokens (agent_id, value) VALUES (?, ?)');

// Execute multiple times efficiently
for (const token of tokens) {
  insert.run(token.agentId, token.value);
}
```

### Repository Pattern

```typescript
export class BetterSqliteAgentTrackingRepository implements IAgentTrackingRepository {
  private prepared = new Map<string, Database.Statement>();

  async initialize(): Promise<void> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    
    // Cache prepared statements
    this.prepared.set('upsert_agent', conn.prepare(`
      INSERT INTO agents (id, model, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET model = excluded.model
    `));
  }

  async upsertAgent(agent: AgentRecord): Promise<void> {
    const stmt = this.prepared.get('upsert_agent')!;
    stmt.run(agent.id, agent.model, agent.createdAt);
  }
}
```

## Build Process

### Local Development

```bash
# Rebuild for Node.js tests:
pnpm run rebuild:native:node

# Rebuild for the Electron Extension Host:
pnpm run rebuild:native:electron
```

### CI/CD (scripts/build.mjs)

```javascript
// 1. Determine Electron version from package.json engines.vscode
const electronVersion = getElectronVersionForVSCode(packageJson.engines.vscode);

// 2. Rebuild for Electron
execSync(`npx electron-rebuild -v ${electronVersion} -m ./node_modules/better-sqlite3 -f`);

// 3. Verify binding exists
const bindingPath = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
assert(fs.existsSync(bindingPath), 'Missing better-sqlite3 native binding');

// 4. Package with vsce (binding included in .vsix)
```

### Platform Matrix

| OS | Architecture | Binary |
|----|--------------|--------|
| macOS | arm64 (M1+) | `better_sqlite3.node` |
| macOS | x64 (Intel) | `better_sqlite3.node` |
| Linux | x64 | `better_sqlite3.node` |
| Linux | arm64 | `better_sqlite3.node` |
| Windows | x64 | `better_sqlite3.node` |
| Windows | arm64 | `better_sqlite3.node` |

Each platform's binary is built via `electron-rebuild` targeting the correct Electron ABI.

## Testing

### Unit Tests

```bash
# Run connection manager tests
node --import ./out/test/registerVscodeMock.js --test 'out/test/persistence/betterSqliteConnectionManager.test.js'
```

**Note**: Tests run in Node.js (not Electron), so run `pnpm run rebuild:native:node` first. Do not use the Electron rebuild for the test runtime.

### Test Structure

```typescript
describe('BetterSqliteConnectionManager', () => {
  let manager: BetterSqliteConnectionManager;
  let tempDir: string;

  before(() => {
    manager = new BetterSqliteConnectionManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  });

  after(async () => {
    await manager.closeAllConnections();
    fs.rmSync(tempDir, { recursive: true });
  });

  it('creates connection with WAL enabled', async () => {
    const conn = await manager.getConnection(getTempDbPath('test'));
    const mode = conn.get('PRAGMA journal_mode');
    assert.strictEqual(mode.journal_mode, 'wal');
  });
});
```

### Integration Tests

See `src/test/agentTrackingIntegration.test.ts` for end-to-end tests covering:
- Agent lifecycle persistence
- Token accumulation
- Multi-agent scenarios
- Concurrency (simulated multi-window)

## Migration from Legacy CLI

Legacy CLI agent tracking (`AgentTrackingDatabase`) was removed in v0.1.35. Agent tracking now always uses `BetterSqliteAgentTrackingRepository` via `createAgentTrackingRepository()`.

### Factory Pattern

```typescript
// src/persistence/agentTrackingRepositoryFactory.ts
export function createAgentTrackingRepository(
  dbPath: string,
  extensionPath: string
): IAgentTrackingRepository {
  return new BetterSqliteAgentTrackingRepository(
    getConnectionManager(),
    dbPath,
    extensionPath
  );
}
```

### Backward Compatibility

- Database schema unchanged (same tables, columns, indexes)
- Both implementations use identical SQL
- No data migration required (both read/write same `.db` file)

## Troubleshooting

### "Failed to open database" in tests

**Cause**: better-sqlite3 compiled for Electron, tests run in Node.js

**Fix**:
```bash
pnpm run rebuild:native:node
pnpm run verify:native:node
```

### "Module did not self-register" in extension

**Cause**: better-sqlite3 compiled for wrong Electron version

**Fix**:
```bash
pnpm run rebuild:native:electron
```

### "database is locked" errors persist

**Cause**: WAL mode not enabled, or busy_timeout too low

**Debug**:
```typescript
const mode = conn.get('PRAGMA journal_mode');
const timeout = conn.get('PRAGMA busy_timeout');
console.log({ mode, timeout }); // Should be { mode: 'wal', timeout: 5000 }
```

### WAL file grows indefinitely

**Cause**: Checkpoints not occurring

**Fix**:
```sql
-- Manual checkpoint
PRAGMA wal_checkpoint(TRUNCATE);

-- Or restart extension (triggers checkpoint on connection close)
```

## Performance Benchmarks (Preliminary)

| Operation | CLI (legacy) | better-sqlite3 | Speedup |
|-----------|--------------|----------------|---------|
| Single INSERT | ~50-100ms | ~0.1ms | 500-1000x |
| Batch 100 INSERTs (no txn) | ~5000ms | ~10ms | 500x |
| Batch 100 INSERTs (with txn) | N/A (no txn support) | ~1ms | N/A |
| Single SELECT | ~50ms | ~0.05ms | 1000x |

**Note**: CLI overhead is process spawn time, not SQLite itself.

## Further Reading

- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [SQLite WAL mode](https://www.sqlite.org/wal.html)
- [ADR-001: Migrate to better-sqlite3](adr/001-migrate-to-better-sqlite3.md)
- [ADR-002: Connection Manager Design](adr/002-connection-manager-design.md)
- [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) (unchanged, same schema for both implementations)
