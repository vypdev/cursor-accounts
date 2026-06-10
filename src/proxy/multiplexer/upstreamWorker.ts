#!/usr/bin/env node
/**
 * Upstream analysis worker child process.
 * Receives agent traffic summaries via IPC and persists them to SQLite.
 */
import { AgentTrackingDatabase } from '../../persistence/agentTrackingDatabase';
import { BetterSqliteAgentTrackingRepository } from '../../persistence/betterSqlite/betterSqliteAgentTrackingRepository';
import { BetterSqliteConnectionManager } from '../../persistence/betterSqlite/betterSqliteConnectionManager';
import { getEfficiencyDbPath } from '../../persistence/efficiencyDatabase';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import { ProxyLiveCostCalculator } from '../../domain/services/ProxyLiveCostCalculator';
import { TokenTurnDetectionService } from '../../domain/services/tokenTurnDetectionService';
import { CursorModelPricingProvider } from '../../modelEfficiency/cursorModelPricingProvider';
import { AgentTrackingService } from '../../services/agentTrackingService';
import type {
  UpstreamWorkerChildMessage,
  UpstreamWorkerConfig,
  UpstreamWorkerParentMessage,
} from './upstreamWorkerTypes';

function send(message: UpstreamWorkerChildMessage): void {
  if (process.send) {
    process.send(message);
  }
}

function parseConfig(): UpstreamWorkerConfig {
  const raw = process.env.CURSOR_ACCOUNTS_UPSTREAM_WORKER_CONFIG;
  if (!raw) {
    throw new Error('CURSOR_ACCOUNTS_UPSTREAM_WORKER_CONFIG is required');
  }
  return JSON.parse(raw) as UpstreamWorkerConfig;
}

function createRepository(config: UpstreamWorkerConfig): IAgentTrackingRepository {
  const dbPath = getEfficiencyDbPath(config.userDataDir);
  if (config.useBetterSqlite3) {
    return new BetterSqliteAgentTrackingRepository(
      new BetterSqliteConnectionManager(),
      dbPath,
      config.extensionPath
    );
  }
  return new AgentTrackingDatabase(dbPath, config.extensionPath);
}

async function main(): Promise<void> {
  const config = parseConfig();
  const repository = createRepository(config);
  const turnDetectionService = new TokenTurnDetectionService();
  const liveCostCalculator = new ProxyLiveCostCalculator(
    new CursorModelPricingProvider(),
    () => config.estimatedDollarsPerMillionTokens
  );
  const agentTracking = new AgentTrackingService(
    repository,
    config.profileId,
    turnDetectionService,
    liveCostCalculator
  );

  await agentTracking.initialize();

  process.on('message', (msg: UpstreamWorkerParentMessage) => {
    void (async () => {
      if (msg.type === 'traffic' && msg.summary) {
        const result = await agentTracking.ingestTraffic(
          msg.summary,
          config.workspacePath
        );
        send({
          type: 'traffic_ingested',
          upstreamId: config.upstreamId,
          conversationId: result?.conversationId,
        });
      } else if (msg.type === 'shutdown') {
        process.exit(0);
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[upstream-worker] ${message}\n`);
    });
  });

  send({ type: 'ready', upstreamId: config.upstreamId });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  send({ type: 'error', message });
  process.exit(1);
});
