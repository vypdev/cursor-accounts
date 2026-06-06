#!/bin/bash
# Verify WAL mode configuration and database integrity for better-sqlite3

set -e

# Default database path (can override with argument)
DB_PATH="${1:-$HOME/.cursor-accounts/cursor-accounts-efficiency.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "❌ Database not found: $DB_PATH"
  echo "Usage: $0 [path-to-database]"
  exit 1
fi

echo "🔍 Verifying WAL mode configuration for: $DB_PATH"
echo ""

# Check if sqlite3 CLI is available
if ! command -v sqlite3 &> /dev/null; then
  echo "❌ sqlite3 CLI not found. Install with: brew install sqlite3 (macOS) or apt install sqlite3 (Linux)"
  exit 1
fi

# Check journal mode
echo "📝 Checking PRAGMA settings..."
MODE=$(sqlite3 "$DB_PATH" "PRAGMA journal_mode;")
echo "  Journal mode: $MODE"
if [ "$MODE" != "wal" ]; then
  echo "  ❌ Expected WAL mode, got: $MODE"
  echo "  This may indicate the feature flag is disabled or database was not opened with BetterSqliteConnectionManager"
  exit 1
else
  echo "  ✅ WAL mode confirmed"
fi

# Check busy timeout
TIMEOUT=$(sqlite3 "$DB_PATH" "PRAGMA busy_timeout;")
echo "  Busy timeout: ${TIMEOUT}ms"
if [ "$TIMEOUT" -lt 5000 ]; then
  echo "  ⚠️  Timeout less than 5000ms: $TIMEOUT (expected 5000+)"
else
  echo "  ✅ Busy timeout configured"
fi

# Check synchronous
SYNC=$(sqlite3 "$DB_PATH" "PRAGMA synchronous;")
echo "  Synchronous: $SYNC (1=NORMAL)"
if [ "$SYNC" = "1" ]; then
  echo "  ✅ Synchronous=NORMAL (optimal for WAL)"
fi

# Check foreign keys
FK=$(sqlite3 "$DB_PATH" "PRAGMA foreign_keys;")
echo "  Foreign keys: $FK"
if [ "$FK" = "1" ]; then
  echo "  ✅ Foreign keys enabled"
fi

# Check temp_store
TEMP=$(sqlite3 "$DB_PATH" "PRAGMA temp_store;")
echo "  Temp store: $TEMP (2=MEMORY)"

echo ""
echo "📊 Database statistics..."
PAGE_COUNT=$(sqlite3 "$DB_PATH" "PRAGMA page_count;")
PAGE_SIZE=$(sqlite3 "$DB_PATH" "PRAGMA page_size;")
DB_SIZE=$((PAGE_COUNT * PAGE_SIZE))
DB_SIZE_MB=$((DB_SIZE / 1024 / 1024))
echo "  Pages: $PAGE_COUNT (${PAGE_SIZE} bytes each)"
echo "  Total size: ${DB_SIZE_MB}MB"

# Check table counts
echo ""
echo "📋 Table row counts..."
CONVERSATIONS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM conversations;" 2>/dev/null || echo "0")
AGENTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM agents;" 2>/dev/null || echo "0")
TOKENS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM agent_tokens;" 2>/dev/null || echo "0")
DELTAS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM agent_tokens_delta;" 2>/dev/null || echo "0")
TURNS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM agent_turn_ended;" 2>/dev/null || echo "0")

echo "  Conversations: $CONVERSATIONS"
echo "  Agents: $AGENTS"
echo "  Token snapshots: $TOKENS"
echo "  Token deltas: $DELTAS"
echo "  Turn ended: $TURNS"

# Check WAL file
echo ""
echo "📁 WAL file status..."
if [ -f "${DB_PATH}-wal" ]; then
  if command -v stat &> /dev/null; then
    # macOS or Linux stat
    WAL_SIZE=$(stat -f%z "${DB_PATH}-wal" 2>/dev/null || stat -c%s "${DB_PATH}-wal" 2>/dev/null)
    WAL_SIZE_KB=$((WAL_SIZE / 1024))
    echo "  WAL file exists: ${WAL_SIZE_KB}KB"
    
    if [ "$WAL_SIZE" -gt 100000 ]; then
      echo "  ⚠️  WAL file is large (>${WAL_SIZE_KB}KB)"
      echo "     Consider running PRAGMA wal_checkpoint(TRUNCATE) or restarting extension"
    elif [ "$WAL_SIZE" -eq 0 ]; then
      echo "  ✅ WAL file is empty (checkpointed)"
    else
      echo "  ✅ WAL file size is reasonable"
    fi
  else
    echo "  WAL file exists (size unknown, stat command not available)"
  fi
else
  echo "  No WAL file (checkpointed or empty)"
  echo "  ✅ Database is fully checkpointed"
fi

# Check SHM file
if [ -f "${DB_PATH}-shm" ]; then
  echo "  SHM file exists (shared memory for WAL)"
  echo "  ✅ Multi-process coordination active"
else
  echo "  No SHM file (no active connections or not in WAL mode)"
fi

# Integrity check
echo ""
echo "🔒 Running integrity check..."
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;")
if [ "$INTEGRITY" = "ok" ]; then
  echo "  ✅ Database integrity: OK"
else
  echo "  ❌ Database integrity FAILED:"
  echo "$INTEGRITY"
  exit 1
fi

# Quick check (faster than integrity_check)
echo ""
echo "⚡ Running quick check..."
QUICK=$(sqlite3 "$DB_PATH" "PRAGMA quick_check;")
if [ "$QUICK" = "ok" ]; then
  echo "  ✅ Quick check: OK"
else
  echo "  ❌ Quick check FAILED:"
  echo "$QUICK"
  exit 1
fi

# Schema version
echo ""
echo "📦 Database metadata..."
SCHEMA_VERSION=$(sqlite3 "$DB_PATH" "SELECT version FROM database_metadata ORDER BY version DESC LIMIT 1;" 2>/dev/null || echo "unknown")
echo "  Schema version: $SCHEMA_VERSION"

echo ""
echo "✅ All checks passed!"
echo ""
echo "Summary:"
echo "  - WAL mode: ✅ enabled"
echo "  - Integrity: ✅ verified"
echo "  - Data: $AGENTS agents, $TOKENS token snapshots, $DELTAS deltas"
echo ""
echo "Database is healthy and ready for multi-window usage."
