import type { AgentSessionInfo } from '../types/agentTracking';

/** Merge fields into a concrete session object while ignoring undefined values. */
export function mergeAgentSessionFields(
  base: Partial<AgentSessionInfo>,
  extra: Partial<AgentSessionInfo>
): AgentSessionInfo {
  const merged: AgentSessionInfo = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** Merge populated agent-session fields without allowing undefined values to erase state. */
export function mergeAgentSessionInfo(
  base: AgentSessionInfo | undefined,
  extra: AgentSessionInfo | undefined
): AgentSessionInfo | undefined {
  if (!base && !extra) {
    return undefined;
  }

  const merged = mergeAgentSessionFields(base ?? {}, extra ?? {});

  return Object.keys(merged).length > 0 ? merged : undefined;
}
