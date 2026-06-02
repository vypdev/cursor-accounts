import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { getSqlite3Binary } from '../auth/sqliteBinary';

const SCRIPT_TIMEOUT_MS = 120_000;
const QUERY_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 20 * 1024 * 1024;

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function sqlLiteral(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return `'${escapeSqlString(value)}'`;
}

export function sqlNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'NULL';
  }
  return String(value);
}

export function resolveMigrationsDir(extensionPath: string): string {
  const candidates = [
    path.join(extensionPath, 'out', 'persistence', 'migrations'),
    path.join(extensionPath, 'src', 'persistence', 'migrations'),
    path.join(__dirname, 'migrations'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? path.join(__dirname, 'migrations');
}

export class SqliteExecutor {
  constructor(
    private readonly dbPath: string,
    private readonly extensionPath: string
  ) {}

  private binary(): string {
    return getSqlite3Binary(this.extensionPath);
  }

  async dbExists(): Promise<boolean> {
    try {
      await fsPromises.access(this.dbPath);
      return true;
    } catch {
      return false;
    }
  }

  query(sql: string, readonly = true): string {
    const args = readonly
      ? ['-readonly', '-json', this.dbPath, sql]
      : ['-json', this.dbPath, sql];

    try {
      return execFileSync(this.binary(), args, {
        encoding: 'utf8',
        timeout: QUERY_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
    } catch (error) {
      const stderr =
        error instanceof Error && 'stderr' in error
          ? String((error as { stderr?: string }).stderr)
          : '';
      throw new Error(
        stderr.trim() ||
          (error instanceof Error ? error.message : 'SQLite query failed')
      );
    }
  }

  queryRows<T>(sql: string, readonly = true): T[] {
    const output = this.query(sql, readonly).trim();
    if (!output) {
      return [];
    }
    try {
      const parsed = JSON.parse(output) as T | T[];
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  async runScript(script: string): Promise<void> {
    const binary = this.binary();
    await fsPromises.mkdir(path.dirname(this.dbPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const child = spawn(binary, [this.dbPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`SQLite script timed out for ${this.dbPath}`));
      }, SCRIPT_TIMEOUT_MS);

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(stderr.trim() || `SQLite exited with code ${code ?? 'unknown'}`)
        );
      });

      child.stdin.write(script);
      child.stdin.end();
    });
  }

  async runStatement(sql: string): Promise<void> {
    await this.runScript(`${sql}\n`);
  }
}
