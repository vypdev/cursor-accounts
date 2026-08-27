import { isProfileProxyEnabled, type Profile } from '@cursor-accounts/types';
import type { IProfileReader } from '../../domain/ports/IProfileReader';
import type { ProxyStartResult } from '../../domain/ports/IProxyManager';

export interface ProxyProfileLifecycleUseCaseDependencies {
  profileReader: Pick<IProfileReader, 'getProfile' | 'getProfiles'>;
  ensureSharedProxy(profiles: Profile[]): Promise<ProxyStartResult>;
  isRunning(profileId: string): Promise<boolean>;
  stop(
    profileId: string,
    options?: { restoreSettings?: boolean }
  ): Promise<void>;
  logInfo(message: string): void;
}

/** Applies profile validation to the public proxy start/restart workflows. */
export class ProxyProfileLifecycleUseCase {
  constructor(
    private readonly dependencies: ProxyProfileLifecycleUseCaseDependencies
  ) {}

  async start(profileId: string): Promise<ProxyStartResult> {
    const profile = await this.dependencies.profileReader.getProfile(profileId);
    if (!profile) {
      return { success: false, error: `Profile ${profileId} not found` };
    }

    if (!isProfileProxyEnabled(profile)) {
      return { success: false, error: 'Proxy is disabled for this profile' };
    }

    return this.dependencies.ensureSharedProxy(
      await this.dependencies.profileReader.getProfiles()
    );
  }

  async ensureProfileProxy(profileId: string): Promise<ProxyStartResult> {
    const profile = await this.dependencies.profileReader.getProfile(profileId);
    if (!profile || !isProfileProxyEnabled(profile)) {
      return { success: false, error: 'Proxy is disabled for this profile' };
    }

    return this.dependencies.ensureSharedProxy(
      await this.dependencies.profileReader.getProfiles()
    );
  }

  async restart(profileId: string): Promise<ProxyStartResult> {
    const profile = await this.dependencies.profileReader.getProfile(profileId);
    if (!profile) {
      return { success: false, error: `Profile ${profileId} not found` };
    }

    if (!(await this.dependencies.isRunning(profileId))) {
      return { success: true };
    }

    this.dependencies.logInfo(
      `[Proxy:${profileId}] Restarting proxy after JSONL logging change`
    );
    await this.dependencies.stop(profileId, { restoreSettings: false });
    return this.start(profileId);
  }
}
