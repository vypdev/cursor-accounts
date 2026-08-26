import type { AgentSessionInfo } from '../types/agentTracking';

/** Merge populated agent-session fields without allowing undefined values to erase state. */
export function mergeAgentSessionInfo(
  base: AgentSessionInfo | undefined,
  extra: AgentSessionInfo | undefined
): AgentSessionInfo | undefined {
  if (!base && !extra) {
    return undefined;
  }

  const merged: AgentSessionInfo = { ...(base ?? {}) };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}
