import { isProfileProxyJsonlLoggingEnabled, type Profile } from '@cursor-accounts/types';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import type {
  IProxyOutputPresenter,
  ProxyOutputSettings,
} from '../domain/ports/IProxyOutputPresenter';
import type { IProxyTrafficIngress } from '../domain/ports/IProxyTrafficIngress';

export interface ProxyTrafficIngressCoordinatorOptions {
  forceRestart?: boolean;
  tailFromStart?: boolean;
  apiToken?: string;
}

export interface ProxyTrafficIngressCoordinatorDependencies {
  profileManager: IProfileReader;
  trafficIngress: IProxyTrafficIngress;
  outputPresenter?: IProxyOutputPresenter;
  getOutputConfig: () => ProxyOutputSettings;
  hasRuntime: (profileId: string) => boolean;
  sharedRuntimeKey: string;
}

/** Coordinates API/JSONL ingress attachment without owning proxy lifecycle. */
export class ProxyTrafficIngressCoordinator {
  constructor(
    private readonly dependencies: ProxyTrafficIngressCoordinatorDependencies
  ) {}

  async ensure(
    profileId: string,
    mitmPort: number,
    apiPort: number,
    options?: ProxyTrafficIngressCoordinatorOptions
  ): Promise<void> {
    const jsonlTail = await this.shouldTailJsonl(profileId);
    const attached =
      !this.dependencies.hasRuntime(profileId) ||
      options?.forceRestart === true;

    if (attached && this.dependencies.getOutputConfig().logTrafficToOutput) {
      this.dependencies.outputPresenter?.appendAttached(mitmPort);
    }

    await this.dependencies.trafficIngress.start(
      profileId,
      mitmPort,
      { api: true, jsonlTail },
      {
        apiPort,
        apiToken: options?.apiToken,
        attached,
        tailFromStart: options?.tailFromStart,
        forceRestart: options?.forceRestart,
      }
    );
  }

  private async shouldTailJsonl(profileId: string): Promise<boolean> {
    if (profileId === this.dependencies.sharedRuntimeKey) {
      const profiles = await this.dependencies.profileManager.getProfiles();
      return profiles.some((profile) => this.isJsonlEnabled(profile));
    }

    const profile = await this.dependencies.profileManager.getProfile(profileId);
    return profile ? this.isJsonlEnabled(profile) : false;
  }

  private isJsonlEnabled(profile: Profile): boolean {
    return isProfileProxyJsonlLoggingEnabled(profile);
  }
}
