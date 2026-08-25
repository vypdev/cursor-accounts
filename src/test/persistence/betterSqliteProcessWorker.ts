import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';

const [dbPath, workerId, countText] = process.argv.slice(2);
const count = Number.parseInt(countText ?? '', 10);

if (!dbPath || !workerId || !Number.isSafeInteger(count) || count < 1) {
  throw new Error('Expected database path, worker id, and positive row count');
}

const workerDbPath = dbPath;

async function run(): Promise<void> {
  const manager = new BetterSqliteConnectionManager();

  try {
    const connection = await manager.getConnection(workerDbPath);
    for (let index = 0; index < count; index += 1) {
      connection.run(
        'INSERT INTO process_events (worker_id, sequence) VALUES (?, ?)',
        workerId,
        index
      );
    }
  } finally {
    await manager.closeAllConnections();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
