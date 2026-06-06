import type { UpstreamConfig } from '../../../domain/ports/IUpstreamPool';

const DEFAULT_UPSTREAM_PORTS = [8080, 8081, 8082, 8888];

/** Allocates upstream slots from a base port range. */
export function allocateUpstreamConfigs(
  count: number,
  startPort: number = DEFAULT_UPSTREAM_PORTS[0]!,
  host = '127.0.0.1'
): UpstreamConfig[] {
  const configs: UpstreamConfig[] = [];
  for (let i = 0; i < count; i++) {
    const port = startPort + i;
    configs.push({
      id: `upstream-${i + 1}`,
      host,
      port,
      weight: 1,
      maxConnections: 100,
    });
  }
  return configs;
}

export function defaultUpstreamPorts(): readonly number[] {
  return DEFAULT_UPSTREAM_PORTS;
}
