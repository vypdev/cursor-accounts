import { decodeJwtPayload } from '../auth/tokenReader';

/**
 * Extract Cursor user id from JWT `sub` claim (handles auth0|userId format).
 */
export function extractUserIdFromJwt(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  const sub = payload?.sub;
  if (typeof sub !== 'string' || !sub) {
    return undefined;
  }
  return sub.includes('|') ? sub.split('|').pop()! : sub;
}

/**
 * Resolve profileId from Authorization Bearer JWT using a userId → profileId map.
 */
export function resolveProfileIdFromAuthorizationHeader(
  headers: Record<string, string>,
  userIdToProfileId?: Map<string, string>
): string | undefined {
  if (!userIdToProfileId || userIdToProfileId.size === 0) {
    return undefined;
  }

  const authHeader = headers.authorization ?? headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authHeader.slice('Bearer '.length);
  const userId = extractUserIdFromJwt(token);
  if (!userId) {
    return undefined;
  }

  return userIdToProfileId.get(userId);
}

/**
 * Returns true when summary contains agent metrics worth persisting.
 */
export function isAgentMetricsTraffic(summary: {
  insights?: { agent?: {
    requestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    usageEvent?: string;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  } };
  isLiveTokenUpdate?: boolean;
  isTurnEnded?: boolean;
}): boolean {
  const agent = summary.insights?.agent;
  if (!agent?.requestId) {
    return false;
  }

  if (summary.isLiveTokenUpdate || summary.isTurnEnded) {
    return true;
  }

  return Boolean(
    agent.inputTokens ||
      agent.outputTokens ||
      agent.usageEvent ||
      agent.cacheReadTokens ||
      agent.cacheWriteTokens
  );
}
