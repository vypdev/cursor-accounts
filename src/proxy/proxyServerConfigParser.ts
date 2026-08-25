import { z } from 'zod';
import type { ProxyServerConfig } from './types';

const proxyServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  apiPort: z.number().int().min(1).max(65_535),
  apiToken: z.string().min(32).optional(),
  profileId: z.string().min(1),
  storageDir: z.string().min(1),
  logDir: z.string().min(1),
  maxLogSizeMb: z.number().finite().positive(),
  maxBodyLogBytes: z.number().int().positive(),
  spillLargeBodies: z.boolean(),
  developmentMode: z.boolean(),
  trafficDiagnostics: z.boolean(),
  diagnosticsIntervalMs: z.number().int().positive(),
  userIdToProfileId: z.record(z.string(), z.string()).optional(),
  profileDbPaths: z.record(z.string(), z.string()).optional(),
  extensionPath: z.string().min(1).optional(),
});

export function parseProxyServerConfig(raw: string): ProxyServerConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `CURSOR_ACCOUNTS_PROXY_CONFIG is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const result = proxyServerConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `CURSOR_ACCOUNTS_PROXY_CONFIG is invalid: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

export function parseProxyServerConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): ProxyServerConfig {
  const raw = environment.CURSOR_ACCOUNTS_PROXY_CONFIG;
  if (!raw) {
    throw new Error('CURSOR_ACCOUNTS_PROXY_CONFIG environment variable is required');
  }
  return parseProxyServerConfig(raw);
}
