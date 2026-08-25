import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';
import * as extensionLog from '../../logging/extensionLog';
import { DatabaseMigrator } from '../databaseMigrations';

const REQUIRED_AGENT_TRACKING_TABLES = [
  'conversations',
  'agents',
  'agent_tokens',
  'agent_tokens_delta',
  'agent_tokens_delta_events',
  'agent_turn_ended',
] as const;

/** Owns agent-tracking schema migration and post-migration verification. */
export class BetterSqliteAgentTrackingSchemaInitializer {
  constructor(
    private readonly connectionManager: IDatabaseConnectionManager,
    private readonly dbPath: string,
    private readonly extensionPath: string
  ) {}

  async initialize(): Promise<void> {
    extensionLog.info(`[BetterSqliteAgentTracking] Initializing: ${this.dbPath}`);

    const conn = await this.connectionManager.getConnection(this.dbPath);
    const migrator = new DatabaseMigrator(this.dbPath, this.extensionPath);
    await migrator.migrate();

    const tables = conn.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const tableNames = new Set(tables.map((table) => table.name));

    for (const table of REQUIRED_AGENT_TRACKING_TABLES) {
      if (!tableNames.has(table)) {
        throw new Error(`Missing required table: ${table}`);
      }
    }

    extensionLog.info('[BetterSqliteAgentTracking] Initialization complete');
  }
}
