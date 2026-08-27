import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProxyTraffic } from '../domain/ports/IProxyTraffic';
import type { ConversationTokenTotals } from '../application/types/agentPersistence';
import { ActiveConversationTotalsLoader } from '../application/services/activeConversationTotalsLoader';

const TOTALS = {} as ConversationTokenTotals;

describe('ActiveConversationTotalsLoader', () => {
  it('uses an explicitly supplied profile without detecting the current profile', async () => {
    let detectCalled = false;
    let requestedProfileId: string | undefined;
    const loader = createLoader({
      profileDetector: {
        detectCurrentProfile: async () => {
          detectCalled = true;
          return null;
        },
      },
      getAgentTrackingService: (profileId) => {
        requestedProfileId = profileId;
        return { getConversationTokens: async () => TOTALS };
      },
    });

    const result = await loader.load('conversation-1', 'profile-1');

    assert.equal(result, TOTALS);
    assert.equal(detectCalled, false);
    assert.equal(requestedProfileId, 'profile-1');
  });

  it('detects the current profile when no profile id is supplied', async () => {
    let requestedConversationId: string | undefined;
    const loader = createLoader({
      profileDetector: {
        detectCurrentProfile: async () => ({ id: 'profile-2' } as never),
      },
      getAgentTrackingService: () => ({
        getConversationTokens: async (conversationId) => {
          requestedConversationId = conversationId;
          return TOTALS;
        },
      }),
    });

    const result = await loader.load('conversation-2');

    assert.equal(result, TOTALS);
    assert.equal(requestedConversationId, 'conversation-2');
  });

  it('returns null when no current profile can be resolved', async () => {
    let serviceLookupCalled = false;
    const loader = createLoader({
      profileDetector: { detectCurrentProfile: async () => null },
      getAgentTrackingService: () => {
        serviceLookupCalled = true;
        return undefined;
      },
    });

    assert.equal(await loader.load('conversation-3'), null);
    assert.equal(serviceLookupCalled, false);
  });

  it('returns null when tracking is unavailable for the resolved profile', async () => {
    const loader = createLoader({
      profileDetector: { detectCurrentProfile: async () => ({ id: 'profile-4' } as never) },
      getAgentTrackingService: () => undefined,
    });

    assert.equal(await loader.load('conversation-4'), null);
  });
});

function createLoader(overrides: {
  profileDetector?: Partial<IProfileDetector>;
  getAgentTrackingService?: IProxyTraffic['getAgentTrackingService'];
}) {
  return new ActiveConversationTotalsLoader({
    profileDetector: {
      detectCurrentProfile: async () => null,
      ...overrides.profileDetector,
    },
    proxyTraffic: {
      getAgentTrackingService:
        overrides.getAgentTrackingService ?? (() => undefined),
    },
  });
}
