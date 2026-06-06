# Multi-Window Testing Guide — better-sqlite3 WAL Mode

This guide walks through manual testing of the better-sqlite3 implementation with multiple VS Code windows accessing the same database file concurrently.

## Prerequisites

1. **Enable feature flag** in User Settings or Workspace Settings:
   ```json
   {
     "cursorAccounts.experimental.useBetterSqlite3": true
   }
   ```

2. **Rebuild native modules** for Electron (not Node.js):
   ```bash
   cd /path/to/cursor-accounts
   pnpm run rebuild:native
   ```

3. **Compile and package** the extension:
   ```bash
   pnpm run compile
   ```

4. **Launch Extension Development Host** (F5) or install VSIX locally.

---

## Test 1: Two Windows, Same Profile, Concurrent Writes

### Objective
Verify that WAL mode eliminates "database is locked" errors when two VS Code windows write to the same database simultaneously.

### Steps

1. **Open Window 1** (Extension Development Host or regular VS Code with installed extension)
   - Open any workspace
   - Ensure Cursor profile is detected (check status bar)
   - Note the profile ID in Output → "Cursor Accounts" logs

2. **Open Window 2** with the **same profile**
   ```bash
   # From terminal (adjust paths to your setup)
   code --user-data-dir="/path/to/same/profile" /path/to/any/workspace
   ```

3. **Trigger agent activity in both windows** (if proxy tracking is enabled):
   - Window 1: Start Composer chat → Send a prompt → Wait for streaming
   - Window 2: Simultaneously start another Composer chat → Send prompt
   
   **Alternative manual trigger** (if proxy not active):
   - Use Command Palette → "Cursor Accounts: Show Accounts Panel"
   - Check that both windows show the same profile data

4. **Monitor logs** in **both windows**:
   - Open Output → "Cursor Accounts"
   - Look for:
     ```
     [AgentTrackingFactory] Using better-sqlite3 for: /path/to/db
     [BetterSqlite] Opening connection: /path/to/db
     [BetterSqlite] Connection configured: WAL=wal
     ```
   - **Verify NO "database is locked" errors**

5. **Inspect filesystem**:
   ```bash
   ls -lh /path/to/cursor-accounts-efficiency.db*
   ```
   - Should see:
     - `cursor-accounts-efficiency.db` (main database)
     - `cursor-accounts-efficiency.db-wal` (Write-Ahead Log)
     - `cursor-accounts-efficiency.db-shm` (Shared Memory)

### Expected Result
✅ **Both windows write successfully without lock errors**
✅ **WAL and SHM files exist**
✅ **Logs show WAL mode enabled in both windows**

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "database is locked" errors | Feature flag not enabled | Check settings.json |
| Module not found | Native module not rebuilt for Electron | Run `pnpm run rebuild:native` |
| No WAL files | Database in legacy mode | Verify logs show `WAL=wal` |

---

## Test 2: WAL Checkpoint on Extension Deactivate

### Objective
Verify that connections are closed gracefully with WAL checkpoint on extension deactivation.

### Steps

1. **Start Extension Development Host** with feature flag enabled

2. **Trigger some database activity**:
   - Open Accounts Panel
   - View efficiency stats (if available)
   - Let proxy track some agent streaming (if active)

3. **Check WAL file size before close**:
   ```bash
   ls -lh ~/.cursor-accounts/cursor-accounts-efficiency.db-wal
   ```
   - Note the size (may be several KB if activity occurred)

4. **Close the Extension Development Host window**
   - This triggers `deactivate()` → `closeAllConnections()`

5. **Immediately check logs** (before closing Output):
   ```
   [AgentTrackingFactory] Closing all database connections
   [BetterSqlite] Closing connection: /path/to/db
   [BetterSqlite] All connections closed successfully
   ```

6. **Check WAL file size after close**:
   ```bash
   ls -lh ~/.cursor-accounts/cursor-accounts-efficiency.db-wal
   ```
   - **Should be truncated** (0 bytes or very small <1KB)
   - Or **deleted** (file no longer exists)

### Expected Result
✅ **WAL file is truncated/deleted after deactivation**
✅ **Logs show graceful connection close**
✅ **No warnings or errors in deactivate logs**

---

## Test 3: Lock Contention with busy_timeout

### Objective
Verify that `PRAGMA busy_timeout = 5000` allows one window to wait for another rather than failing immediately.

### Steps

1. **Window 1**: Start a long-running operation (simulate with debugger):
   - Set breakpoint in `BetterSqliteAgentTrackingRepository.upsertAgent()`
   - Trigger agent activity
   - Pause execution (connection holds write lock)

2. **Window 2**: Attempt concurrent write:
   - Trigger another agent activity
   - Should **wait** up to 5 seconds (not fail immediately)

3. **Resume Window 1** debugger:
   - Window 2 operation should complete successfully

### Expected Result
✅ **Window 2 waits** (up to 5s) instead of immediate "database is locked"
✅ **Both operations succeed** after release

---

## Test 4: Database Corruption Check

### Objective
Ensure WAL mode + concurrent access does not corrupt the database.

### Steps

1. **Run both windows for extended period** (e.g., 30+ minutes) with:
   - Multiple agent streaming sessions
   - Frequent database writes
   - Occasional window reloads

2. **Run integrity check**:
   ```bash
   sqlite3 ~/.cursor-accounts/cursor-accounts-efficiency.db "PRAGMA integrity_check;"
   ```
   - **Expected output**: `ok`

3. **Run quick_check**:
   ```bash
   sqlite3 ~/.cursor-accounts/cursor-accounts-efficiency.db "PRAGMA quick_check;"
   ```
   - **Expected output**: `ok`

4. **Query sample data**:
   ```sql
   SELECT COUNT(*) FROM agents;
   SELECT COUNT(*) FROM agent_tokens;
   SELECT COUNT(*) FROM agent_tokens_delta;
   ```
   - Should return sensible counts (no negative, no nulls where unexpected)

### Expected Result
✅ **integrity_check: ok**
✅ **quick_check: ok**
✅ **Data queries return valid results**

---

## Test 5: Performance Comparison (Optional)

### Objective
Compare performance between legacy CLI and better-sqlite3.

### Steps

1. **Baseline (legacy CLI)**:
   - Disable feature flag: `"cursorAccounts.experimental.useBetterSqlite3": false`
   - Reload extension
   - Trigger 100 agent token upserts
   - Note time in logs (if instrumented) or manually

2. **With better-sqlite3**:
   - Enable feature flag: `"cursorAccounts.experimental.useBetterSqlite3": true`
   - Reload extension
   - Trigger same 100 agent token upserts
   - Compare time

### Expected Result
✅ **better-sqlite3 is 10-100x faster** than CLI subprocess
✅ **No regressions in data correctness**

---

## Automated Verification Script

Run after manual testing to verify database state:

```bash
#!/bin/bash
# scripts/verify-wal-mode.sh

DB_PATH="$HOME/.cursor-accounts/cursor-accounts-efficiency.db"

echo "🔍 Verifying WAL mode configuration..."

# Check journal mode
MODE=$(sqlite3 "$DB_PATH" "PRAGMA journal_mode;")
echo "Journal mode: $MODE"
if [ "$MODE" != "wal" ]; then
  echo "❌ Expected WAL mode, got: $MODE"
  exit 1
fi

# Check busy timeout
TIMEOUT=$(sqlite3 "$DB_PATH" "PRAGMA busy_timeout;")
echo "Busy timeout: ${TIMEOUT}ms"
if [ "$TIMEOUT" -lt 5000 ]; then
  echo "⚠️  Timeout less than 5000ms: $TIMEOUT"
fi

# Check synchronous
SYNC=$(sqlite3 "$DB_PATH" "PRAGMA synchronous;")
echo "Synchronous: $SYNC (1=NORMAL expected)"

# Check foreign keys
FK=$(sqlite3 "$DB_PATH" "PRAGMA foreign_keys;")
echo "Foreign keys: $FK (1=ON expected)"

# Check integrity
echo ""
echo "Running integrity check..."
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")
if [ "$INTEGRITY" = "ok" ]; then
  echo "✅ Database integrity: OK"
else
  echo "❌ Database integrity FAILED:"
  echo "$INTEGRITY"
  exit 1
fi

# Check WAL file
if [ -f "${DB_PATH}-wal" ]; then
  WAL_SIZE=$(stat -f%z "${DB_PATH}-wal" 2>/dev/null || stat -c%s "${DB_PATH}-wal" 2>/dev/null)
  echo ""
  echo "WAL file size: ${WAL_SIZE} bytes"
  if [ "$WAL_SIZE" -gt 100000 ]; then
    echo "⚠️  WAL file is large (>100KB), consider checkpoint"
  fi
else
  echo ""
  echo "No WAL file (checkpointed or empty)"
fi

echo ""
echo "✅ All checks passed!"
```

Make executable:
```bash
chmod +x scripts/verify-wal-mode.sh
```

Run after multi-window testing:
```bash
./scripts/verify-wal-mode.sh
```

---

## Rollback Plan

If issues occur during manual testing:

1. **Disable feature flag**:
   ```json
   {
     "cursorAccounts.experimental.useBetterSqlite3": false
   }
   ```

2. **Reload VS Code windows**
   - Extension will revert to legacy CLI subprocess implementation

3. **Report issue** with:
   - Extension logs (Output → "Cursor Accounts")
   - SQLite database path
   - OS and VS Code version
   - Reproduction steps

---

## Success Criteria for Milestone 4

- ✅ Two windows can write to same database without "database is locked" errors
- ✅ WAL files (`-wal`, `-shm`) are created and managed correctly
- ✅ Checkpoint truncates WAL file on connection close
- ✅ `PRAGMA integrity_check` returns `ok` after extended use
- ✅ Logs show no warnings or errors related to database operations
- ✅ All automated concurrency tests pass (7/7)

Once all criteria met, Milestone 4 is **complete** and ready for Alpha (Milestone 5).
