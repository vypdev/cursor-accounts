import * as path from 'node:path';
import { getSharedProxyStorageDir } from '../sharedProxyPaths';

export const MULTIPLEXER_LOG_PREFIX = 'router';

export function getMultiplexerLogDir(): string {
  return path.join(getSharedProxyStorageDir(), 'logs');
}
