import * as path from 'node:path';
import { getSharedProxyStorageDir } from '../sharedProxyPaths';

export const MULTIPLEXER_CONFIG_FILE = 'multiplexer-config.json';
export const MULTIPLEXER_LOG_PREFIX = 'router';

export function getMultiplexerConfigPath(): string {
  return path.join(getSharedProxyStorageDir(), MULTIPLEXER_CONFIG_FILE);
}

export function getMultiplexerLogDir(): string {
  return path.join(getSharedProxyStorageDir(), 'logs');
}
