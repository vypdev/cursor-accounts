import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentTrackingDatabase } from '../../../persistence/agentTrackingDatabase';
import { SqliteExecutor } from '../../../persistence/sqliteExecutor';
import { AgentTrackingService } from '../../../services/agentTrackingService';
import type { ProxyTrafficSummary } from '../../../proxy/types';

const extensionPath = path.join(__dirname, '..', '..', '..', '..');

describe('Workspace tracking in database', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  async function createService(
    profileId: string
  ): Promise<{ service: AgentTrackingService; executor: SqliteExecutor }> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-tracking-'));
    const dbPath = path.join(tempDir, 'efficiency.db');
    const repo = new AgentTrackingDatabase(dbPath, extensionPath);
    const service = new AgentTrackingService(repo, profileId);
    await service.initialize();
    return { service, executor: new SqliteExecutor(dbPath, extensionPath) };
  }

  it('persists workspace_path to conversations and agents', async () => {
    const { service, executor } = await createService('test-profile');

    await service.ingestTraffic(
      {
        timestamp: new Date(1_000_000).toISOString(),
        kind: 'response',
        url: 'https://agent.cursor.sh/BidiAppend',
        host: 'agent.cursor.sh',
        endpoint: '/BidiAppend',
        insights: {
          agent: {
            requestId: 'req-1',
            conversationId: 'conv-1',
            streamingTokens: 120,
            usageEvent: 'token_delta',
          },
          tokens: {
            modelName: 'claude-sonnet',
          },
        },
      } satisfies ProxyTrafficSummary,
      '/workspace/test-project'
    );

    const conversations = executor.queryRows<{ workspace_path: string | null }>(
      `SELECT workspace_path FROM conversations WHERE conversation_id = 'conv-1'`
    );
    const agents = executor.queryRows<{ workspace_path: string | null }>(
      `SELECT workspace_path FROM agents WHERE request_id = 'req-1'`
    );

    assert.equal(conversations[0]?.workspace_path, '/workspace/test-project');
    assert.equal(agents[0]?.workspace_path, '/workspace/test-project');
  });

  it('allows querying metrics by workspace', async () => {
    const { service, executor } = await createService('test-profile');

    await service.ingestTraffic(
      {
        timestamp: new Date(1_000_000).toISOString(),
        kind: 'response',
        url: 'https://agent.cursor.sh/BidiAppend',
        host: 'agent.cursor.sh',
        endpoint: '/BidiAppend',
        insights: {
          agent: {
            requestId: 'req-1',
            conversationId: 'conv-1',
            streamingTokens: 200,
            usageEvent: 'token_delta',
          },
          tokens: {
            modelName: 'claude-sonnet',
          },
        },
      } satisfies ProxyTrafficSummary,
      '/workspace/test-project'
    );

    const rows = executor.queryRows<{ total_tokens: number }>(
      `SELECT COALESCE(SUM(at.streaming_tokens), 0) AS total_tokens
       FROM agent_tokens at
       JOIN agents a ON a.request_id = at.request_id
       WHERE a.workspace_path = '/workspace/test-project'`
    );

    assert.ok((rows[0]?.total_tokens ?? 0) > 0);
  });
});
