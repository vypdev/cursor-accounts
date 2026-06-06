import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';

/**
 * Concurrency tests for BetterSqliteConnectionManager.
 * 
 * @remarks
 * These tests simulate multi-window scenarios where multiple connection
 * managers (representing different VS Code windows) access the same database
 * file concurrently. WAL mode should prevent "database is locked" errors.
 */
describe('BetterSqlite Concurrency (Multi-Window Simulation)', () => {
  let tempDir: string;
  let sharedDbPath: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrency-test-'));
    sharedDbPath = path.join(tempDir, 'shared.db');
  });

  after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('two managers can write to same database without lock errors', async () => {
    const manager1 = new BetterSqliteConnectionManager();
    const manager2 = new BetterSqliteConnectionManager();

    try {
      // Window 1: Open connection and create table
      const conn1 = await manager1.getConnection(sharedDbPath);
      conn1.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)');
      
      // Window 2: Open connection to same database
      const conn2 = await manager2.getConnection(sharedDbPath);
      
      // Verify both can see the table
      const tables1 = conn1.all("SELECT name FROM sqlite_master WHERE type='table'");
      const tables2 = conn2.all("SELECT name FROM sqlite_master WHERE type='table'");
      
      assert.ok(tables1.length > 0, 'Window 1 should see tables');
      assert.ok(tables2.length > 0, 'Window 2 should see tables');
      
      // Both windows write concurrently (WAL mode allows this)
      conn1.run('INSERT INTO users (name) VALUES (?)', 'Alice');
      conn2.run('INSERT INTO users (name) VALUES (?)', 'Bob');
      
      // Both should see all data (eventually consistent in WAL)
      const count1 = conn1.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
      const count2 = conn2.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
      
      assert.ok(count1 && count1.count >= 2, 'Window 1 should see at least 2 users');
      assert.ok(count2 && count2.count >= 2, 'Window 2 should see at least 2 users');
    } finally {
      await manager1.closeAllConnections();
      await manager2.closeAllConnections();
    }
  });

  it('WAL files are created when using WAL mode', async () => {
    const manager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'wal-check.db');

    try {
      const conn = await manager.getConnection(dbPath);
      
      // Create some data to trigger WAL file creation
      conn.run('CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)');
      conn.run('INSERT INTO test (data) VALUES (?)', 'test data');
      
      // Verify the mode is WAL (WAL/SHM files may be managed by SQLite automatically)
      const mode = conn.get<{ journal_mode: string }>('PRAGMA journal_mode');
      assert.strictEqual(mode?.journal_mode, 'wal', 'Should be in WAL mode');
    } finally {
      await manager.closeAllConnections();
    }
  });

  it('checkpoint truncates WAL file on close', async () => {
    const manager = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'checkpoint-test.db');

    try {
      const conn = await manager.getConnection(dbPath);
      
      // Create data
      conn.run('CREATE TABLE checkpoint_test (id INTEGER PRIMARY KEY, data TEXT)');
      for (let i = 0; i < 100; i++) {
        conn.run('INSERT INTO checkpoint_test (data) VALUES (?)', `data-${i}`);
      }
      
      const walPath = `${dbPath}-wal`;
      
      // Close connection (triggers checkpoint)
      await manager.closeConnection(dbPath);
      
      // WAL file should be truncated or very small after checkpoint
      if (fs.existsSync(walPath)) {
        const walSize = fs.statSync(walPath).size;
        // WAL might still exist but should be small (<1KB typically after TRUNCATE checkpoint)
        assert.ok(
          walSize < 10000,
          `WAL file should be small after checkpoint, got ${walSize} bytes`
        );
      }
    } finally {
      await manager.closeAllConnections();
    }
  });

  it('handles rapid concurrent inserts without errors', async () => {
    const manager1 = new BetterSqliteConnectionManager();
    const manager2 = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'rapid-inserts.db');

    try {
      // Setup table
      const conn1 = await manager1.getConnection(dbPath);
      conn1.run('CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER)');
      
      const conn2 = await manager2.getConnection(dbPath);
      
      // Simulate rapid inserts from both "windows"
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < 50; i++) {
        promises.push(
          Promise.resolve().then(() => {
            conn1.run('INSERT INTO events (timestamp) VALUES (?)', Date.now());
          })
        );
        promises.push(
          Promise.resolve().then(() => {
            conn2.run('INSERT INTO events (timestamp) VALUES (?)', Date.now());
          })
        );
      }
      
      // All inserts should succeed without "database is locked" errors
      await Promise.all(promises);
      
      const count = conn1.get<{ count: number }>('SELECT COUNT(*) as count FROM events');
      assert.strictEqual(count?.count, 100, 'Should have 100 events');
    } finally {
      await manager1.closeAllConnections();
      await manager2.closeAllConnections();
    }
  });

  it('transactions from different managers do not block each other (WAL)', async () => {
    const manager1 = new BetterSqliteConnectionManager();
    const manager2 = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'txn-test.db');

    try {
      const conn1 = await manager1.getConnection(dbPath);
      const conn2 = await manager2.getConnection(dbPath);
      
      conn1.run('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance INTEGER)');
      conn1.run('INSERT INTO accounts (id, balance) VALUES (1, 1000), (2, 1000)');
      
      // Transaction 1: Transfer 100 from account 1 to 2
      conn1.transaction(() => {
        conn1.run('UPDATE accounts SET balance = balance - 100 WHERE id = 1');
        conn1.run('UPDATE accounts SET balance = balance + 100 WHERE id = 2');
      });
      
      // Transaction 2: Transfer 50 from account 2 to 1
      conn2.transaction(() => {
        conn2.run('UPDATE accounts SET balance = balance - 50 WHERE id = 2');
        conn2.run('UPDATE accounts SET balance = balance + 50 WHERE id = 1');
      });
      
      // Verify final balances (order may vary due to WAL, but total should be consistent)
      const balances = conn1.all<{ id: number; balance: number }>(
        'SELECT id, balance FROM accounts ORDER BY id'
      );
      
      const totalBalance = balances.reduce((sum, acc) => sum + acc.balance, 0);
      assert.strictEqual(totalBalance, 2000, 'Total balance should be preserved');
    } finally {
      await manager1.closeAllConnections();
      await manager2.closeAllConnections();
    }
  });

  it('busy_timeout prevents immediate lock errors', async () => {
    const manager1 = new BetterSqliteConnectionManager();
    const manager2 = new BetterSqliteConnectionManager();
    const dbPath = path.join(tempDir, 'busy-timeout-test.db');

    try {
      const conn1 = await manager1.getConnection(dbPath);
      const conn2 = await manager2.getConnection(dbPath);
      
      conn1.run('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT)');
      
      // Start long transaction in conn1
      const startTime = Date.now();
      conn1.transaction(() => {
        conn1.run('INSERT INTO items (value) VALUES (?)', 'item1');
        // Simulate some work
        for (let i = 0; i < 1000000; i++) {
          // Busy work
        }
      });
      
      // Conn2 should wait (busy_timeout=5000ms) rather than fail immediately
      conn2.run('INSERT INTO items (value) VALUES (?)', 'item2');
      const elapsed = Date.now() - startTime;
      
      // Should complete within reasonable time (not instant, but also not timeout)
      assert.ok(elapsed < 5000, `Should complete before timeout, took ${elapsed}ms`);
      
      const count = conn1.get<{ count: number }>('SELECT COUNT(*) as count FROM items');
      assert.strictEqual(count?.count, 2, 'Should have 2 items');
    } finally {
      await manager1.closeAllConnections();
      await manager2.closeAllConnections();
    }
  });

  it('connection caching works per-manager', async () => {
    const manager1 = new BetterSqliteConnectionManager();
    const manager2 = new BetterSqliteConnectionManager();

    try {
      // Each manager caches its own connection
      const conn1a = await manager1.getConnection(sharedDbPath);
      const conn1b = await manager1.getConnection(sharedDbPath);
      assert.strictEqual(conn1a, conn1b, 'Manager1 should cache connection');
      
      const conn2a = await manager2.getConnection(sharedDbPath);
      const conn2b = await manager2.getConnection(sharedDbPath);
      assert.strictEqual(conn2a, conn2b, 'Manager2 should cache connection');
      
      // But each manager has its own instance
      assert.notStrictEqual(conn1a, conn2a, 'Different managers have different connections');
    } finally {
      await manager1.closeAllConnections();
      await manager2.closeAllConnections();
    }
  });
});
