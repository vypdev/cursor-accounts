/**
 * Connection abstraction for database operations.
 * 
 * @remarks
 * This interface abstracts the underlying database implementation (better-sqlite3)
 * to maintain Clean Architecture boundaries. Domain and application layers depend
 * on this port, not on concrete implementations.
 * 
 * @example
 * ```typescript
 * const conn = await connectionManager.getConnection('/path/to/db.sqlite');
 * const result = conn.get<User>('SELECT * FROM users WHERE id = ?', userId);
 * ```
 */
export interface IDatabaseConnection {
  /** Whether the connection is currently open and usable */
  readonly isOpen: boolean;
  
  /**
   * Execute a write statement (INSERT, UPDATE, DELETE).
   * @param sql - SQL statement with ? placeholders
   * @param params - Values to bind to placeholders
   * @throws {DatabaseError} If query execution fails
   */
  run(sql: string, ...params: unknown[]): void;
  
  /**
   * Execute a query returning a single row.
   * @param sql - SQL query with ? placeholders
   * @param params - Values to bind to placeholders
   * @returns First matching row or undefined
   */
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  
  /**
   * Execute a query returning all matching rows.
   * @param sql - SQL query with ? placeholders
   * @param params - Values to bind to placeholders
   * @returns Array of matching rows (empty if none)
   */
  all<T>(sql: string, ...params: unknown[]): T[];
  
  /**
   * Create a prepared statement for repeated execution.
   * @param sql - SQL statement with ? placeholders
   * @returns Prepared statement handle
   */
  prepare(sql: string): IPreparedStatement;
  
  /**
   * Execute operations in a transaction with automatic rollback on error.
   * @param fn - Function containing transactional operations
   * @returns Result of fn()
   * @throws {DatabaseError} If transaction fails (auto-rollback)
   */
  transaction<T>(fn: () => T): T;
  
  /**
   * Close the connection and release resources.
   * Safe to call multiple times (idempotent).
   */
  close(): void;
}

/**
 * Prepared statement handle for efficient repeated execution.
 */
export interface IPreparedStatement {
  /**
   * Execute the statement with given parameters.
   * @param params - Values to bind to ? placeholders
   */
  run(...params: unknown[]): void;
  
  /**
   * Execute query returning single row.
   * @param params - Values to bind to ? placeholders
   */
  get<T>(...params: unknown[]): T | undefined;
  
  /**
   * Execute query returning all rows.
   * @param params - Values to bind to ? placeholders
   */
  all<T>(...params: unknown[]): T[];
}

/**
 * Manages database connections per-window in the extension.
 * 
 * @remarks
 * Each VS Code window (extension host process) maintains its own connection
 * manager instance. Multiple connections to the same database file are supported
 * via SQLite WAL mode. Connections are opened lazily and cached for reuse.
 * 
 * @see {@link IDatabaseConnection} for connection API
 */
export interface IDatabaseConnectionManager {
  /**
   * Get or create a connection to the specified database.
   * @param dbPath - Absolute path to SQLite database file
   * @returns Connection instance (cached if already open)
   */
  getConnection(dbPath: string): Promise<IDatabaseConnection>;
  
  /**
   * Close a specific connection and remove from cache.
   * @param dbPath - Database path to close
   */
  closeConnection(dbPath: string): Promise<void>;
  
  /**
   * Close all managed connections (called on extension deactivation).
   */
  closeAllConnections(): Promise<void>;
}

/**
 * Base error for database operations.
 * Concrete implementations should extend this with specific error types.
 */
export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseError';
  }
}
