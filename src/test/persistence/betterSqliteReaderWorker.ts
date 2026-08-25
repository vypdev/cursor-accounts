import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';

const dbPath = process.argv[2];
if (!dbPath) {
  throw new Error('Expected database path');
}
const readerDbPath = dbPath;

async function run(): Promise<void> {
  const manager = new BetterSqliteConnectionManager();
  const connection = await manager.getConnection(readerDbPath);

  connection.run('BEGIN;');
  connection.get('SELECT COUNT(*) AS count FROM checkpoint_events');
  process.stdout.write('ready\n');

  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  process.stdin.pause();
  process.stdin.destroy();
  connection.run('COMMIT;');
  await manager.closeAllConnections();
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
