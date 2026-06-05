import * as vscode from 'vscode';
import { t } from '../../l10n';
import type { AgentSessionInfo } from '../../application/types/agentTracking';
import type { ProxyTrafficSummary } from '../../application/types/proxyTraffic';

export const TOKEN_DETECTOR_TAG = '[TokenDetector]';

export interface TokenDetectorOutputConfig {
  logTokenDetectorToOutput: boolean;
  autoShowTokenDetectorChannel: boolean;
}

export function getTokenDetectorOutputConfig(): TokenDetectorOutputConfig {
  const cfg = vscode.workspace.getConfiguration('cursorAccounts.proxy');
  return {
    logTokenDetectorToOutput: cfg.get<boolean>('logTokenDetectorToOutput', true),
    autoShowTokenDetectorChannel: cfg.get<boolean>(
      'autoShowTokenDetectorChannel',
      false
    ),
  };
}

function shortId(value: string | undefined, length = 8): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= length ? value : value.slice(0, length);
}

function formatTokenParts(agent: AgentSessionInfo | undefined): string[] {
  if (!agent) {
    return [];
  }

  const parts: string[] = [];
  if (agent.usageEvent) {
    parts.push(`event=${agent.usageEvent}`);
  }
  if (agent.streamingTokens != null) {
    parts.push(`stream=${agent.streamingTokens}`);
  }
  if (agent.inputTokens != null) {
    parts.push(`in=${agent.inputTokens}`);
  }
  if (agent.outputTokens != null) {
    parts.push(`out=${agent.outputTokens}`);
  }
  if (agent.cacheReadTokens != null) {
    parts.push(`cacheR=${agent.cacheReadTokens}`);
  }
  if (agent.cacheWriteTokens != null) {
    parts.push(`cacheW=${agent.cacheWriteTokens}`);
  }
  if (agent.estimatedCostUsd != null && agent.estimatedCostUsd > 0) {
    parts.push(`~$${agent.estimatedCostUsd.toFixed(3)}`);
  }
  if (agent.eof) {
    parts.push('eof');
  }
  return parts;
}

/**
 * Format IPC proxy traffic for the token/agent detector channel.
 * Returns null when the event has nothing useful for token or agent tracking.
 */
export function formatTokenDetectorLine(
  summary: ProxyTrafficSummary,
  profileId?: string
): string | null {
  const agent = summary.insights?.agent;
  const tokens = summary.insights?.tokens;
  const context = summary.insights?.context;
  const rpc = summary.rpcPath ?? summary.endpoint;

  const isAgentRpc =
    /AgentService|BidiService|BidiAppend|BidiPoll|RunPoll|RunSSE|StreamBidi/i.test(
      rpc
    );

  const hasInsights = Boolean(
    agent?.requestId ||
      agent?.conversationId ||
      agent?.conversationGroupId ||
      agent?.parentRequestId ||
      agent?.subagentRequestId ||
      agent?.streamingTokens != null ||
      agent?.inputTokens != null ||
      agent?.usageEvent ||
      tokens?.totalTokens != null ||
      tokens?.modelName ||
      context?.conversationId ||
      context?.conversationGroupId
  );

  if (!hasInsights && !isAgentRpc) {
    return null;
  }

  const time = new Date(summary.timestamp).toLocaleTimeString(undefined, {
    hour12: false,
  });

  const fields: string[] = [];
  if (profileId) {
    fields.push(`profile=${shortId(profileId, 8)}`);
  }
  if (rpc) {
    fields.push(`rpc=${rpc.replace(/^\/+/, '')}`);
  }
  if (summary.kind !== 'error') {
    fields.push(summary.kind === 'request' ? '→ req' : '← resp');
  }

  const conversationId =
    agent?.conversationId ?? context?.conversationId;
  if (conversationId) {
    fields.push(`conv=${shortId(conversationId, 12)}`);
  }
  if (agent?.conversationGroupId ?? context?.conversationGroupId) {
    fields.push(
      `group=${shortId(agent?.conversationGroupId ?? context?.conversationGroupId, 12)}`
    );
  }
  if (agent?.requestId) {
    fields.push(`agent=${shortId(agent.requestId, 12)}`);
  }
  if (agent?.parentRequestId) {
    fields.push(`parent=${shortId(agent.parentRequestId, 12)}`);
  }
  if (agent?.subagentRequestId) {
    fields.push(`subagent=${shortId(agent.subagentRequestId, 12)}`);
  }

  const model = tokens?.modelName ?? agent?.modelName;
  if (model) {
    fields.push(`model=${model}`);
  }

  fields.push(...formatTokenParts(agent));

  if (
    tokens?.totalTokens != null &&
    agent?.streamingTokens == null &&
    agent?.inputTokens == null
  ) {
    fields.push(`total=${tokens.totalTokens}`);
  }

  if (summary.decodeError) {
    fields.push(`decodeErr=${summary.decodeError}`);
  }

  if (fields.length <= (profileId ? 3 : 2) && !hasInsights) {
    return null;
  }

  return `[${time}] ${TOKEN_DETECTOR_TAG} ${fields.join(' ')}`;
}

/**
 * Output channel for live agent/token detection from proxy IPC (no JSONL tail required).
 */
export class TokenDetectorOutputPresenter {
  private readonly channel: vscode.OutputChannel;
  private autoShowPending = false;

  constructor() {
    this.channel = vscode.window.createOutputChannel(
      t('tokenDetector.output.channelName')
    );
  }

  dispose(): void {
    this.channel.dispose();
  }

  show(): void {
    this.channel.show(true);
  }

  appendInitialized(profileId: string): void {
    this.appendLine(
      t('tokenDetector.output.trackingInitialized', {
        profileId: shortId(profileId, 8) ?? profileId,
      })
    );
  }

  appendTraffic(summary: ProxyTrafficSummary, profileId?: string): void {
    const settings = getTokenDetectorOutputConfig();
    if (!settings.logTokenDetectorToOutput) {
      return;
    }

    const line = formatTokenDetectorLine(summary, profileId);
    if (!line) {
      return;
    }

    this.channel.appendLine(line);

    if (settings.autoShowTokenDetectorChannel && !this.autoShowPending) {
      this.autoShowPending = true;
      this.channel.show(true);
    }
  }

  appendNote(message: string): void {
    const settings = getTokenDetectorOutputConfig();
    if (!settings.logTokenDetectorToOutput) {
      return;
    }
    this.appendLine(message);
  }

  private appendLine(message: string): void {
    this.channel.appendLine(
      `[${new Date().toLocaleTimeString(undefined, { hour12: false })}] ${TOKEN_DETECTOR_TAG} ${message}`
    );
  }
}
