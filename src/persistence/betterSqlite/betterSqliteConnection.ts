import type Database from 'better-sqlite3';
import type {
  IDatabaseConnection,
  IPreparedStatement,
} from '../../domain/ports/IDatabaseConnectionManager';
import { DatabaseError } from '../../domain/ports/IDatabaseConnectionManager';

/**
 * Wrapper around better-sqlite3 Database instance.
 * 
 * @remarks
 * This adapter implements IDatabaseConnection to abstract better-sqlite3
 * from the domain layer. All better-sqlite3 errors are wrapped in DatabaseError.
 */
export class BetterSqliteConnection implements IDatabaseConnection {
  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string
  ) {}

  get isOpen(): boolean {
    return this.db.open;
  }

  run(sql: string, ...params: unknown[]): void {
    try {
      this.db.prepare(sql).run(...params);
    } catch (error) {
      throw new DatabaseError(
        `Failed to execute statement: ${sql.slice(0, 100)}...`,
        error
      );
    }
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    try {
      return this.db.prepare(sql).get(...params) as T | undefined;
    } catch (error) {
      throw new DatabaseError(
        `Failed to execute query: ${sql.slice(0, 100)}...`,
        error
      );
    }
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    try {
      return this.db.prepare(sql).all(...params) as T[];
    } catch (error) {
      throw new DatabaseError(
        `Failed to execute query: ${sql.slice(0, 100)}...`,
        error
      );
    }
  }

  prepare(sql: string): IPreparedStatement {
    try {
      const stmt = this.db.prepare(sql);
      return new BetterSqlitePreparedStatement(stmt);
    } catch (error) {
      throw new DatabaseError(
        `Failed to prepare statement: ${sql.slice(0, 100)}...`,
        error
      );
    }
  }

  transaction<T>(fn: () => T): T {
    try {
      const txn = this.db.transaction(fn);
      return txn();
    } catch (error) {
      throw new DatabaseError('Transaction failed and was rolled back', error);
    }
  }

  close(): void {
    try {
      if (this.db.open) {
        // Checkpoint WAL before closing
        try {
          this.db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (checkpointError) {
          // Log but don't fail the close
          console.warn(
            `[BetterSqliteConnection] WAL checkpoint failed for ${this.dbPath}:`,
            checkpointError
          );
        }
        this.db.close();
      }
    } catch (error) {
      throw new DatabaseError(`Failed to close database: ${this.dbPath}`, error);
    }
  }
}

/**
 * Wrapper around better-sqlite3 Statement.
 */
class BetterSqlitePreparedStatement implements IPreparedStatement {
  constructor(private readonly stmt: Database.Statement) {}

  run(...params: unknown[]): void {
    try {
      this.stmt.run(...params);
    } catch (error) {
      throw new DatabaseError('Prepared statement execution failed', error);
    }
  }

  get<T>(...params: unknown[]): T | undefined {
    try {
      return this.stmt.get(...params) as T | undefined;
    } catch (error) {
      throw new DatabaseError('Prepared query execution failed', error);
    }
  }

  all<T>(...params: unknown[]): T[] {
    try {
      return this.stmt.all(...params) as T[];
    } catch (error) {
      throw new DatabaseError('Prepared query execution failed', error);
    }
  }
}
