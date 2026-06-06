import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DEFAULT_MULTIPLEXER_CONFIG,
  type MultiplexerConfig,
} from '../../../application/types/multiplexerConfig';
import type { RoutingStrategyName } from '../../../domain/types/multiplexerTypes';
import { getMultiplexerConfigPath } from '../multiplexerPaths';

const VALID_STRATEGIES = new Set<RoutingStrategyName>([
  'sticky-session',
  'token-hash',
  'round-robin',
  'least-connections',
  'hybrid',
  'workspace-path',
]);

/** Loads and validates multiplexor JSON configuration. */
export class FileConfigLoader {
  constructor(private readonly configPath = getMultiplexerConfigPath()) {}

  async load(): Promise<MultiplexerConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<MultiplexerConfig>;
      return this.mergeWithDefaults(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...DEFAULT_MULTIPLEXER_CONFIG };
      }
      throw error;
    }
  }

  async save(config: MultiplexerConfig): Promise<void> {
    const validated = this.mergeWithDefaults(config);
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(
      this.configPath,
      `${JSON.stringify(validated, null, 2)}\n`,
      'utf8'
    );
  }

  mergeWithDefaults(partial: Partial<MultiplexerConfig>): MultiplexerConfig {
    const strategy = partial.routing?.strategy ?? DEFAULT_MULTIPLEXER_CONFIG.routing.strategy;
    if (!VALID_STRATEGIES.has(strategy)) {
      throw new Error(`Invalid routing strategy: ${strategy}`);
    }

    const fallback = partial.routing?.fallbackStrategy;
    if (fallback && !VALID_STRATEGIES.has(fallback)) {
      throw new Error(`Invalid fallback strategy: ${fallback}`);
    }

    return {
      router: {
        ...DEFAULT_MULTIPLEXER_CONFIG.router,
        ...partial.router,
      },
      upstreams: partial.upstreams ?? DEFAULT_MULTIPLEXER_CONFIG.upstreams,
      routing: {
        ...DEFAULT_MULTIPLEXER_CONFIG.routing,
        ...partial.routing,
        strategy,
      },
      health: {
        ...DEFAULT_MULTIPLEXER_CONFIG.health,
        ...partial.health,
      },
      metrics: {
        enabled:
          partial.metrics?.enabled ??
          DEFAULT_MULTIPLEXER_CONFIG.metrics?.enabled ??
          true,
        aggregationIntervalMs:
          partial.metrics?.aggregationIntervalMs ??
          DEFAULT_MULTIPLEXER_CONFIG.metrics?.aggregationIntervalMs,
      },
    };
  }
}
