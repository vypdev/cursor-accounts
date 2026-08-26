import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IAgentTrackingRepository } from '../../domain/ports/IAgentTrackingRepository';
import type { ProxyTrafficUsageEvent } from '../../domain/types/proxyTraffic';
import {
  AgentTrafficIngestionUseCase,
  type AgentTrackingPersistencePort,
} from '../../application/services/agentTrafficIngestionUseCase';

function createDependencies() {
  const logs: string[] = [];
  const errors: string[] = [];
  const conversations: unknown[][] = [];
  const agents: unknown[] = [];
  const persistenceCalls: unknown[] = [];
  const repository = {
    initialize: async () => undefined,
    getAgentTokens: async () => null,
    upsertConversation: async (...args: unknown[]) => {
      conversations.push(args);
    },
    upsertAgent: async (agent: unknown) => {
      agents.push(agent);
    },
  } as unknown as IAgentTrackingRepository;
  const persistence: AgentTrackingPersistencePort = {
    persist: async (context) => {
      persistenceCalls.push(context);
      return { kind: 'live_delta', persisted: true };
    },
    hasPersistableContext: () => false,
  };
  const useCase = new AgentTrafficIngestionUseCase({
    repository,
    profileId: 'default-profile',
    persistence,
    now: () => 42,
    logInfo: (message) => logs.push(message),
    logError: (message) => errors.push(message),
  });

  return {
    useCase,
    persistence,
    logs,
    errors,
    conversations,
    agents,
    persistenceCalls,
  };
}

function summary(
  insights: ProxyTrafficUsageEvent['insights'],
  overrides: Partial<ProxyTrafficUsageEvent> = {}
): ProxyTrafficUsageEvent {
  return {
    timestamp: '1970-01-01T00:00:01.000Z',
    url: 'https://agent.cursor.sh/BidiAppend',
    endpoint: '/BidiAppend',
    insights,
    ...overrides,
  };
}

describe('AgentTrafficIngestionUseCase', () => {
  it('initializes the repository and logs failures before rethrowing', async () => {
    const setup = createDependencies();
    await setup.useCase.initialize();
    assert.match(setup.logs[0] ?? '', /Initialized successfully/);

    const failure = new Error('database unavailable');
    const failingRepository = {
      initialize: async () => {
        throw failure;
      },
    } as unknown as IAgentTrackingRepository;
    const failing = new AgentTrafficIngestionUseCase({
      repository: failingRepository,
      profileId: 'profile',
      persistence: setup.persistence,
      now: () => 42,
      logInfo: (message) => setup.logs.push(message),
      logError: (message) => setup.errors.push(message),
    });

    await assert.rejects(failing.initialize(), failure);
    assert.match(setup.errors[0] ?? '', /database unavailable/);
  });

  it('skips traffic without insights or an agent request id', async () => {
    const setup = createDependencies();
    await setup.useCase.execute(summary(undefined));
    await setup.useCase.execute(summary({ agent: {} }));

    assert.equal(setup.conversations.length, 0);
    assert.equal(setup.persistenceCalls.length, 0);
    assert.equal(setup.logs.filter((line) => line.includes('skip')).length, 2);
  });

  it('correlates, upserts, and persists a traffic event using the summary profile', async () => {
    const setup = createDependencies();
    const result = await setup.useCase.execute(
      summary(
        {
          agent: {
            requestId: 'request-1',
            conversationId: 'conversation-1',
            modelName: 'agent-model',
            usageEvent: 'token_delta',
          },
          tokens: { modelName: 'token-model' },
        },
        { profileId: 'summary-profile' }
      )
    );

    assert.deepEqual(result, {
      conversationId: 'conversation-1',
      deltaPersisted: true,
      turnEndedPersisted: false,
      contextPersisted: false,
    });
    assert.deepEqual(setup.conversations[0], [
      'conversation-1',
      'summary-profile',
      1,
      undefined,
    ]);
    assert.equal(setup.agents.length, 1);
    assert.equal(setup.persistenceCalls.length, 1);
    assert.equal(
      (setup.persistenceCalls[0] as { modelName?: string }).modelName,
      'token-model'
    );
  });

  it('resolves a missing conversation from the existing agent record', async () => {
    const setup = createDependencies();
    const repository = {
      initialize: async () => undefined,
      getAgentTokens: async () => ({ conversationId: 'stored-conversation' }),
      upsertConversation: async (...args: unknown[]) => {
        setup.conversations.push(args);
      },
      upsertAgent: async (agent: unknown) => {
        setup.agents.push(agent);
      },
    } as unknown as IAgentTrackingRepository;
    const useCase = new AgentTrafficIngestionUseCase({
      repository,
      profileId: 'profile',
      persistence: {
        persist: async () => ({ kind: 'snapshot', persisted: false }),
        hasPersistableContext: () => false,
      },
      now: () => 42,
      logInfo: (message) => setup.logs.push(message),
      logError: (message) => setup.errors.push(message),
    });

    await useCase.execute(
      summary({ agent: { requestId: 'request-1', usageEvent: 'usage_uuid' } })
    );

    assert.equal(setup.conversations[0]?.[0], 'stored-conversation');
    assert.match(setup.logs.at(-1) ?? '', /no persistence path/);
  });

  it('logs ingestion failures without leaking them to callers', async () => {
    const setup = createDependencies();
    const failingRepository = {
      initialize: async () => undefined,
      getAgentTokens: async () => null,
      upsertConversation: async () => {
        throw new Error('write failed');
      },
      upsertAgent: async () => undefined,
    } as unknown as IAgentTrackingRepository;
    const useCase = new AgentTrafficIngestionUseCase({
      repository: failingRepository,
      profileId: 'profile',
      persistence: setup.persistence,
      now: () => 42,
      logInfo: (message) => setup.logs.push(message),
      logError: (message) => setup.errors.push(message),
    });

    await useCase.execute(
      summary({ agent: { requestId: 'request-1', conversationId: 'conversation-1' } })
    );

    assert.match(setup.errors[0] ?? '', /write failed/);
  });
});
