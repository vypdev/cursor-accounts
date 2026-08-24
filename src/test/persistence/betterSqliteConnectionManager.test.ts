import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';
import { DatabaseError } from '../../domain/ports/IDatabaseConnectionManager';

/**
 * Unit tests for BetterSqliteConnectionManager.
 * 
 * @remarks
 * Tests use temporary file databases for isolation (WAL mode requires file-based DBs).
 * Each test verifies connection lifecycle, caching, and error handling.
 */
describe('BetterSqliteConnectionManager', () => {
  let manager: BetterSqliteConnectionManager;
  let tempDir: string;

  before(() => {
    manager = new BetterSqliteConnectionManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'better-sqlite-test-'));
  });

  after(async () => {
    await manager.closeAllConnections();
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /** Helper to generate unique temp DB path */
  function getTempDbPath(name: string): string {
    return path.join(tempDir, `${name}-${Date.now()}.db`);
  }

  describe('getConnection', () => {
    it('creates new connection with WAL enabled', async () => {
      const conn = await manager.getConnection(getTempDbPath('wal-test'));
      
      assert.ok(conn.isOpen, 'Connection should be open');
      
      // Verify WAL mode is enabled
      const journalMode = conn.get<{ journal_mode: string }>('PRAGMA journal_mode');
      assert.strictEqual(journalMode?.journal_mode, 'wal', 'WAL mode should be enabled');
    });

    it('reuses existing connection (cache)', async () => {
      const dbPath = getTempDbPath('cache-test');
      
      const conn1 = await manager.getConnection(dbPath);
      const conn2 = await manager.getConnection(dbPath);
      
      // Both should be the same instance
      assert.strictEqual(conn1, conn2, 'Should return cached connection');
      assert.ok(conn1.isOpen, 'Cached connection should still be open');
    });

    it('creates multiple connections to different databases', async () => {
      const conn1 = await manager.getConnection(getTempDbPath('multi-1'));
      const conn2 = await manager.getConnection(getTempDbPath('multi-2'));
      
      assert.notStrictEqual(conn1, conn2, 'Should create separate connections');
      assert.ok(conn1.isOpen && conn2.isOpen, 'Both connections should be open');
    });

    it('sets busy_timeout to 5000ms', async () => {
      const conn = await manager.getConnection(getTempDbPath('timeout-test'));
      
      const timeout = conn.get<{ timeout: number }>('PRAGMA busy_timeout');
      assert.strictEqual(timeout?.timeout, 5000, 'Busy timeout should be 5000ms');
    });

    it('enables foreign key constraints', async () => {
      const conn = await manager.getConnection(getTempDbPath('fk-test'));
      
      const fkEnabled = conn.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
      assert.strictEqual(fkEnabled?.foreign_keys, 1, 'Foreign keys should be enabled');
    });
  });

  describe('closeConnection', () => {
    it('closes specific connection', async () => {
      const dbPath = getTempDbPath('close-test');
      const conn = await manager.getConnection(dbPath);
      
      assert.ok(conn.isOpen, 'Connection should be open initially');
      
      await manager.closeConnection(dbPath);
      
      assert.ok(!conn.isOpen, 'Connection should be closed');
    });

    it('is idempotent (safe to call multiple times)', async () => {
      const dbPath = getTempDbPath('idempotent-test');
      await manager.getConnection(dbPath);
      
      // Close twice - should not throw
      await manager.closeConnection(dbPath);
      await manager.closeConnection(dbPath);
      
      // Close non-existent - should not throw
      await manager.closeConnection(getTempDbPath('nonexistent'));
    });

    it('removes connection from cache after close', async () => {
      const dbPath = getTempDbPath('cache-removal');
      const conn1 = await manager.getConnection(dbPath);
      await manager.closeConnection(dbPath);
      
      const conn2 = await manager.getConnection(dbPath);
      
      // Should be a new connection instance (not cached)
      assert.notStrictEqual(conn1, conn2, 'Should create new connection after close');
    });
  });

  describe('closeAllConnections', () => {
    it('closes multiple connections', async () => {
      const conn1 = await manager.getConnection(getTempDbPath('closeall-1'));
      const conn2 = await manager.getConnection(getTempDbPath('closeall-2'));
      const conn3 = await manager.getConnection(getTempDbPath('closeall-3'));
      
      assert.ok(conn1.isOpen && conn2.isOpen && conn3.isOpen, 'All should be open');
      
      await manager.closeAllConnections();
      
      assert.ok(!conn1.isOpen && !conn2.isOpen && !conn3.isOpen, 'All should be closed');
    });

    it('handles close errors gracefully (continues closing others)', async () => {
      await manager.getConnection(getTempDbPath('err-1'));
      await manager.getConnection(getTempDbPath('err-2'));
      
      // This should not throw even if one connection has issues
      await manager.closeAllConnections();
    });

    it('clears connection cache', async () => {
      const dbPath = getTempDbPath('cache-clear');
      await manager.getConnection(dbPath);
      await manager.closeAllConnections();
      
      // Getting connection again should create new instance
      const conn = await manager.getConnection(dbPath);
      assert.ok(conn.isOpen, 'Should create fresh connection after closeAll');
    });
  });

  describe('connection operations', () => {
    it('executes basic SQL operations', async () => {
      const conn = await manager.getConnection(getTempDbPath('ops-test'));
      
      // Create table
      conn.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
      
      // Insert data
      conn.run('INSERT INTO users (name) VALUES (?)', 'Alice');
      conn.run('INSERT INTO users (name) VALUES (?)', 'Bob');
      
      // Query data
      const alice = conn.get<{ id: number; name: string }>(
        'SELECT * FROM users WHERE name = ?',
        'Alice'
      );
      const allUsers = conn.all<{ id: number; name: string }>('SELECT * FROM users');
      
      assert.strictEqual(alice?.name, 'Alice');
      assert.strictEqual(allUsers.length, 2);
    });

    it('prepared statements work correctly', async () => {
      const conn = await manager.getConnection(getTempDbPath('prepared-test'));
      
      conn.run('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)');
      
      const insert = conn.prepare('INSERT INTO items (value) VALUES (?)');
      insert.run('item1');
      insert.run('item2');
      insert.run('item3');
      
      const count = conn.get<{ count: number }>('SELECT COUNT(*) as count FROM items');
      assert.strictEqual(count?.count, 3, 'Should have 3 items');
    });

    it('transactions rollback on error', async () => {
      const conn = await manager.getConnection(getTempDbPath('txn-rollback'));
      
      conn.run('CREATE TABLE counters (id INTEGER PRIMARY KEY, value INTEGER)');
      conn.run('INSERT INTO counters (id, value) VALUES (1, 0)');
      
      try {
        conn.transaction(() => {
          conn.run('UPDATE counters SET value = 10 WHERE id = 1');
          // Force error: invalid SQL
          conn.run('THIS IS INVALID SQL');
        });
        
        assert.fail('Transaction should have thrown');
      } catch (error) {
        assert.ok(error instanceof DatabaseError, 'Should throw DatabaseError');
      }
      
      // Verify rollback occurred
      const result = conn.get<{ value: number }>('SELECT value FROM counters WHERE id = 1');
      assert.strictEqual(result?.value, 0, 'Value should be rolled back to 0');
    });

    it('transactions commit on success', async () => {
      const conn = await manager.getConnection(getTempDbPath('txn-commit'));
      
      conn.run('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)');
      conn.run('INSERT INTO accounts (id, balance) VALUES (1, 100), (2, 50)');
      
      conn.transaction(() => {
        conn.run('UPDATE accounts SET balance = balance - 30 WHERE id = 1');
        conn.run('UPDATE accounts SET balance = balance + 30 WHERE id = 2');
      });
      
      const account1 = conn.get<{ balance: number }>('SELECT balance FROM accounts WHERE id = 1');
      const account2 = conn.get<{ balance: number }>('SELECT balance FROM accounts WHERE id = 2');
      
      assert.strictEqual(account1?.balance, 70, 'Account 1 should be debited');
      assert.strictEqual(account2?.balance, 80, 'Account 2 should be credited');
    });
  });

  describe('error handling', () => {
    it('wraps database errors in DatabaseError', async () => {
      const conn = await manager.getConnection(getTempDbPath('err-wrap'));
      
      try {
        conn.run('INVALID SQL STATEMENT');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof DatabaseError, 'Should throw DatabaseError');
        assert.ok(error.message.includes('Failed to execute statement'));
        assert.ok(error.cause, 'Should include original error as cause');
      }
    });

    it('provides helpful error messages', async () => {
      const conn = await manager.getConnection(getTempDbPath('err-msg'));
      
      try {
        conn.get('SELECT * FROM nonexistent_table');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof DatabaseError);
        assert.ok(
          error.message.includes('Failed to execute query'),
          `Expected error message to include "Failed to execute query", got: ${error.message}`
        );
      }
    });
  });
});
