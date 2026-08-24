import Database from 'better-sqlite3';
import * as path from 'path';
import * as extensionLog from '../../logging/extensionLog';
import type {
  IDatabaseConnection,
  IDatabaseConnectionManager,
} from '../../domain/ports/IDatabaseConnectionManager';
import { DatabaseError } from '../../domain/ports/IDatabaseConnectionManager';
import { BetterSqliteConnection } from './betterSqliteConnection';

/**
 * Connection manager for better-sqlite3 databases.
 * 
 * @remarks
 * Manages a cache of open database connections per-path. Connections are opened
 * lazily on first access and reused for subsequent requests. WAL mode is enabled
 * immediately on connection to support concurrent access from multiple windows.
 * 
 * Thread safety: Not thread-safe (runs in single-threaded Node.js extension host).
 * Multi-window safety: Achieved via SQLite WAL mode + busy_timeout.
 * 
 * @example
 * ```typescript
 * const manager = new BetterSqliteConnectionManager();
 * const conn = await manager.getConnection('/path/to/db.sqlite');
 * // Use connection...
 * await manager.closeAllConnections(); // On extension deactivate
 * ```
 */
export class BetterSqliteConnectionManager implements IDatabaseConnectionManager {
  private readonly connections = new Map<string, BetterSqliteConnection>();
  
  /**
   * Get or create a connection to the specified database.
   * 
   * @param dbPath - Absolute path to SQLite database file
   * @returns Existing connection (if cached and open) or new connection
   * @throws {DatabaseError} If connection fails to open
   */
  async getConnection(dbPath: string): Promise<IDatabaseConnection> {
    await Promise.resolve();
    // Return cached connection if still open
    const existingConn = this.connections.get(dbPath);
    if (existingConn?.isOpen) {
      extensionLog.debug(`[BetterSqlite] Reusing connection: ${dbPath}`);
      return existingConn;
    }
    
    try {
      extensionLog.info(`[BetterSqlite] Opening connection: ${dbPath}`);
      
      // Resolve path to native binding to avoid bindings package navigation issues in VS Code.
      // The bindings package fails when the call stack includes Node.js internal modules
      // like "node:internal/process/task_queues", which don't have a real filesystem path.
      // We bypass this by resolving the binding path directly from better-sqlite3's location.
      let nativeBindingPath: string;
      try {
        // Preferred: Use require.resolve to find better-sqlite3's package
        const betterSqlite3Path = require.resolve('better-sqlite3');
        const betterSqlite3Root = path.dirname(betterSqlite3Path);
        nativeBindingPath = path.join(betterSqlite3Root, '../build/Release/better_sqlite3.node');
      } catch {
        // Fallback: Relative path from compiled output directory
        // From: out/persistence/betterSqlite/betterSqliteConnectionManager.js
        // To: node_modules/better-sqlite3/build/Release/better_sqlite3.node
        nativeBindingPath = path.join(
          __dirname,
          '../../../node_modules/better-sqlite3/build/Release/better_sqlite3.node'
        );
      }
      
      // Open database with 5s timeout for lock contention
      const db = new Database(dbPath, {
        timeout: 5000,
        readonly: false,
        fileMustExist: false, // Create if doesn't exist
        nativeBinding: nativeBindingPath, // Explicitly specify binding path to avoid bindings package
      });
      
      // Configure for optimal concurrent access
      db.pragma('journal_mode = WAL');        // Enable Write-Ahead Logging
      db.pragma('busy_timeout = 5000');       // 5s wait on SQLITE_BUSY
      db.pragma('synchronous = NORMAL');      // Faster commits in WAL mode
      db.pragma('foreign_keys = ON');         // Enforce FK constraints
      db.pragma('temp_store = MEMORY');       // Temp tables in memory
      
      extensionLog.info(
        `[BetterSqlite] Connection configured: WAL=${JSON.stringify(db.pragma('journal_mode', { simple: true }))}`
      );
      
      const conn = new BetterSqliteConnection(db, dbPath);
      this.connections.set(dbPath, conn);
      return conn;
    } catch (error) {
      extensionLog.error(
        `[BetterSqlite] Failed to open connection: ${dbPath} - ${extensionLog.formatError(error)}`
      );
      throw new DatabaseError(`Failed to open database: ${dbPath}`, error);
    }
  }
  
  /**
   * Close a specific connection.
   * 
   * @param dbPath - Database path to close
   * @remarks Idempotent - safe to call even if connection doesn't exist
   */
  async closeConnection(dbPath: string): Promise<void> {
    await Promise.resolve();
    const conn = this.connections.get(dbPath);
    if (conn) {
      try {
        extensionLog.info(`[BetterSqlite] Closing connection: ${dbPath}`);
        conn.close();
        this.connections.delete(dbPath);
      } catch (error) {
        extensionLog.warn(
          `[BetterSqlite] Error closing connection: ${dbPath} - ${extensionLog.formatError(error)}`
        );
        // Still remove from cache even if close failed
        this.connections.delete(dbPath);
      }
    }
  }
  
  /**
   * Close all managed connections.
   * 
   * @remarks Called on extension deactivation. Attempts to close all connections
   * gracefully, logging any errors but continuing to close remaining connections.
   */
  async closeAllConnections(): Promise<void> {
    await Promise.resolve();
    extensionLog.info(`[BetterSqlite] Closing all connections (${this.connections.size} open)`);
    
    const errors: Array<{ dbPath: string; error: unknown }> = [];
    
    for (const [dbPath, conn] of this.connections.entries()) {
      try {
        conn.close();
      } catch (error) {
        errors.push({ dbPath, error });
        extensionLog.warn(
          `[BetterSqlite] Error closing ${dbPath}: ${extensionLog.formatError(error)}`
        );
      }
    }
    
    this.connections.clear();
    
    if (errors.length > 0) {
      extensionLog.warn(`[BetterSqlite] ${errors.length} connection(s) had close errors`);
    } else {
      extensionLog.info('[BetterSqlite] All connections closed successfully');
    }
  }
}
