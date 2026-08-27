import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { IProxyTraffic } from '../../domain/ports/IProxyTraffic';
import type { ConversationTokenTotals } from '../types/agentPersistence';

export interface ActiveConversationTotalsLoaderDependencies {
  profileDetector: Pick<IProfileDetector, 'detectCurrentProfile'>;
  proxyTraffic: Pick<IProxyTraffic, 'getAgentTrackingService'>;
}

/** Resolves conversation totals for the active or explicitly selected profile. */
export class ActiveConversationTotalsLoader {
  constructor(
    private readonly dependencies: ActiveConversationTotalsLoaderDependencies
  ) {}

  async load(
    conversationId: string,
    profileId?: string
  ): Promise<ConversationTokenTotals | null> {
    const resolvedProfileId =
      profileId ?? (await this.dependencies.profileDetector.detectCurrentProfile())?.id;
    if (!resolvedProfileId) {
      return null;
    }

    const tracking = this.dependencies.proxyTraffic.getAgentTrackingService(
      resolvedProfileId
    );
    if (!tracking) {
      return null;
    }

    return tracking.getConversationTokens(conversationId);
  }
}
