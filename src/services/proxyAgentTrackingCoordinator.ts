import type { IProfileManager } from '../domain/ports/IProfileManager';
import { createAgentTrackingRepository } from '../persistence/agentTrackingRepositoryFactory';
import { getEfficiencyDbPath } from '../persistence/efficiencyDatabase';
import { ProxyLiveCostCalculator } from '../domain/services/ProxyLiveCostCalculator';
import { TokenTurnDetectionService } from '../domain/services/tokenTurnDetectionService';
import { CursorModelPricingProvider } from '../modelEfficiency/cursorModelPricingProvider';
import { AgentTrackingService } from './agentTrackingService';
import * as extensionLog from '../logging/extensionLog';

export interface ProxyAgentTrackingCoordinatorDependencies {
  createService?: (
    profileId: string,
    userDataDir: string
  ) => Promise<AgentTrackingService>;
  onInitialized?: (profileId: string) => void;
}

/** Owns profile-scoped agent tracking service creation and lifecycle. */
export class ProxyAgentTrackingCoordinator {
  private readonly services = new Map<string, AgentTrackingService>();
  private readonly createService: (
    profileId: string,
    userDataDir: string
  ) => Promise<AgentTrackingService>;

  constructor(
    private readonly extensionPath: string,
    private readonly getEstimatedDollarsPerMillionTokens: () => number,
    private readonly dependencies: ProxyAgentTrackingCoordinatorDependencies = {}
  ) {
    this.createService =
      dependencies.createService ??
      ((profileId, userDataDir) =>
        this.createDefaultService(profileId, userDataDir));
  }

  get(profileId: string): AgentTrackingService | undefined {
    return this.services.get(profileId);
  }

  delete(profileId: string): void {
    this.services.delete(profileId);
  }

  async ensureForProfile(
    profileId: string,
    profileManager: IProfileManager
  ): Promise<void> {
    if (this.services.has(profileId)) {
      return;
    }
    const profile = await profileManager.getProfile(profileId);
    if (!profile) {
      return;
    }
    await this.ensure(profileId, profile.userDataDir);
  }

  async ensure(profileId: string, userDataDir: string): Promise<void> {
    if (this.services.has(profileId)) {
      return;
    }

    try {
      const service = await this.createService(profileId, userDataDir);
      this.services.set(profileId, service);
      this.dependencies.onInitialized?.(profileId);
    } catch (error) {
      extensionLog.error(
        `[AgentTracking] Failed to initialize for ${profileId}: ${extensionLog.formatError(error)}`
      );
    }
  }

  private async createDefaultService(
    profileId: string,
    userDataDir: string
  ): Promise<AgentTrackingService> {
    const repository = createAgentTrackingRepository(
      getEfficiencyDbPath(userDataDir),
      this.extensionPath
    );
    const turnDetectionService = new TokenTurnDetectionService();
    const liveCostCalculator = new ProxyLiveCostCalculator(
      new CursorModelPricingProvider(),
      this.getEstimatedDollarsPerMillionTokens
    );
    const service = new AgentTrackingService(
      repository,
      profileId,
      turnDetectionService,
      liveCostCalculator
    );
    await service.initialize();
    return service;
  }
}
