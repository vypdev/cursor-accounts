import { randomBytes } from 'node:crypto';
import type { Profile } from '@cursor-accounts/types';
import type { ProxyServerConfig } from '../application/types/proxyConfig';

export interface ProxyServerConfigurationBuilderDependencies {
  storageDir: string;
  logDir: string;
  getConfig<T>(key: string, fallback: T): T;
  isJsonlLoggingEnabled(profile: Profile): boolean;
  createApiToken?(): string;
}

/** Assembles validated child-process configuration from application settings. */
export class ProxyServerConfigurationBuilder {
  constructor(
    private readonly dependencies: ProxyServerConfigurationBuilderDependencies
  ) {}

  build(
    port: number,
    profile: Profile,
    overrides: Partial<ProxyServerConfig> = {}
  ): ProxyServerConfig {
    const maxLogSizeMb = this.dependencies.getConfig('maxLogSizeMB', 500);
    const maxBodyLogMb = this.dependencies.getConfig('maxBodyLogMB', 4);
    const apiPortOffset = this.dependencies.getConfig('apiPortOffset', 10_000);
    return {
      port,
      apiPort: port + apiPortOffset,
      apiToken:
        this.dependencies.createApiToken?.() ??
        randomBytes(32).toString('hex'),
      profileId: profile.id,
      storageDir: this.dependencies.storageDir,
      logDir: this.dependencies.logDir,
      maxLogSizeMb,
      maxBodyLogBytes: Math.max(1, Math.floor(maxBodyLogMb * 1024 * 1024)),
      spillLargeBodies: this.dependencies.getConfig('spillLargeBodies', true),
      developmentMode: this.dependencies.isJsonlLoggingEnabled(profile),
      trafficDiagnostics: this.dependencies.getConfig('trafficDiagnostics', true),
      diagnosticsIntervalMs: this.dependencies.getConfig(
        'diagnosticsIntervalMs',
        30_000
      ),
      ...overrides,
    };
  }
}
