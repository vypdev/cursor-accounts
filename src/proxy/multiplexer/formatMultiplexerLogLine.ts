import type { MultiplexerLogEntry } from './multiplexerEventLogger';

/** Formats a multiplexor JSONL entry for the Output channel. */
export function formatMultiplexerLogLine(entry: MultiplexerLogEntry): string | null {
  switch (entry.event) {
    case 'multiplexer_started':
      return `[Multiplexer] Global multiplexer started on port ${String(entry.port ?? '?')}${
        entry.strategy ? ` (strategy=${String(entry.strategy)})` : ''
      }`;
    case 'multiplexer_stopped':
      return '[Multiplexer] Global multiplexer stopped';
    case 'upstream_created':
      return `[Upstream] Created ${String(entry.upstreamId)} profile=${String(entry.profileId)} workspace=${String(entry.workspace)} port=${String(entry.port)}`;
    case 'upstream_stopped':
      return `[Upstream] Stopped ${String(entry.upstreamId)}${
        entry.reason ? ` (${String(entry.reason)})` : ''
      }`;
    case 'token_extraction': {
      const email = entry.email;
      const profileId = entry.profileId;
      if (email && profileId) {
        return `[Auth] Token decoded: email=${String(email)} → profile=${String(profileId)}`;
      }
      if (email) {
        return `[Auth] Token decoded: email=${String(email)} (profile not found)`;
      }
      return '[Auth] No valid token in request';
    }
    case 'routing_decision': {
      if (entry.sessionKey != null) {
        const workspaceInfo = entry.workspacePath
          ? `workspace=${String(entry.workspacePath)}`
          : 'workspace=none';
        return `[Routing] session=${String(entry.sessionKey)} ${workspaceInfo} → upstream=${String(entry.upstreamId)} (${String(entry.reason)})`;
      }
      const profileInfo = entry.profileId
        ? `profile=${String(entry.profileId)}`
        : 'profile=unknown';
      const workspaceInfo = entry.workspace
        ? `workspace=${String(entry.workspace)}`
        : 'workspace=none';
      return `[Routing] ${profileInfo} ${workspaceInfo} → upstream=${String(entry.upstreamId)} (${String(entry.reason)})`;
    }
    case 'settings_modified':
      return `[Settings] Applied proxy ${String(entry.proxyUrl)} to ${String(entry.userDataDir)}`;
    case 'settings_restored':
      return `[Settings] Restored proxy settings for ${String(entry.userDataDir)}`;
    case 'error':
      return `[Error] ${String(entry.message ?? 'Unknown error')}${
        entry.error ? `: ${String(entry.error)}` : ''
      }`;
    case 'api_request':
      return `[API] ${String(entry.method ?? '?')} ${String(entry.endpoint ?? '?')} → ${String(entry.statusCode ?? '?')}`;
    case 'api_error':
      return `[API Error] ${String(entry.endpoint ?? '?')}: ${String(entry.error ?? 'Unknown error')}`;
    case 'api_websocket_connected':
      return `[API] WebSocket client connected (total=${String(entry.clientCount ?? '?')})`;
    case 'api_websocket_disconnected':
      return `[API] WebSocket client disconnected (total=${String(entry.clientCount ?? '?')})`;
    default:
      return `[Multiplexer] ${entry.event}`;
  }
}
