import type { AgentSessionInfo } from '../../application/types/agentTracking';
import { pickField } from './fieldNormalization';

export function pickRequestId(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const nested = record.requestId ?? record.request_id;
    if (typeof nested === 'string' && nested.length > 0) {
      return nested;
    }
  }
  return undefined;
}

export function pickStringField(
  decoded: Record<string, unknown>,
  snake: string,
  camel: string
): string | undefined {
  const value = pickField(decoded, snake, camel);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Drop explicit `undefined` entries so spreads/merges never erase populated fields. */
export function definedAgentFields(
  fields: Partial<AgentSessionInfo>
): Partial<AgentSessionInfo> {
  const out: Partial<AgentSessionInfo> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Fill only missing fields so earlier protocol sources keep precedence. */
export function fillMissingAgentFields(
  base: Partial<AgentSessionInfo>,
  extra: Partial<AgentSessionInfo>
): Partial<AgentSessionInfo> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (merged[key as keyof AgentSessionInfo] === undefined && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}
