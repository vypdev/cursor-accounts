import { buildTrafficSummary } from './trafficSummaryBuilder';
import { toTrafficSummary } from './proxyTrafficSummary';
import type {
  ProxyTrafficCorrelationEvent,
  ProxyTrafficSummary,
} from '../domain/types/proxyTraffic';
import type { ProxyLogEntry } from '../domain/types/proxyLog';
import type { BuildTrafficSummaryOptions } from './trafficSummaryBuilder';

export interface ProxyTrafficSummaryCorrelation {
  bidiRequestId?: string;
  httpRequestId?: string;
  incrementalTurnsAlreadyPersisted?: boolean;
}

export interface ProxyTrafficSessionTracker {
  track(summary: ProxyTrafficCorrelationEvent): void;
  dispatch(summary: ProxyTrafficSummary, headers?: Record<string, string>): void;
}

export interface ProxyTrafficSummaryDispatcherDependencies {
  enabled: boolean;
  onTraffic: (summary: ProxyTrafficSummary) => void;
  sessionCoordinator: ProxyTrafficSessionTracker;
  buildSummary?: (
    entry: ProxyLogEntry,
    durationMs?: number,
    options?: BuildTrafficSummaryOptions
  ) => Promise<ProxyTrafficSummary>;
  writeDebugLog?: (message: string) => void;
}

export type ProxyTrafficSummaryDispatcher = (
  entry: ProxyLogEntry,
  durationMs?: number,
  correlation?: ProxyTrafficSummaryCorrelation
) => void;

/**
 * Builds and publishes decoded traffic summaries outside the MITM transport
 * adapter. The dispatcher is intentionally asynchronous so response streams
 * are never blocked by protobuf decoding or persistence listeners.
 */
export function createProxyTrafficSummaryDispatcher(
  dependencies: ProxyTrafficSummaryDispatcherDependencies
): ProxyTrafficSummaryDispatcher {
  const buildSummary = dependencies.buildSummary ?? buildTrafficSummary;
  const writeDebugLog =
    dependencies.writeDebugLog ?? ((message) => process.stderr.write(message));

  return (entry, durationMs, correlation) => {
    if (!dependencies.enabled) {
      return;
    }

    void buildSummary(entry, durationMs, correlation)
      .then((summary) => {
        const enrichedSummary = markIncrementalPersistence(
          summary,
          correlation
        );
        dependencies.sessionCoordinator.track(enrichedSummary);
        writeAgentTrackingDebugLog(
          writeDebugLog,
          entry,
          enrichedSummary,
          correlation
        );
        dependencies.sessionCoordinator.dispatch(
          enrichedSummary,
          entry.headers
        );
      })
      .catch(() => {
        dependencies.onTraffic(toTrafficSummary(entry, durationMs));
      });
  };
}

function markIncrementalPersistence(
  summary: ProxyTrafficSummary,
  correlation: ProxyTrafficSummaryCorrelation | undefined
): ProxyTrafficSummary {
  if (!correlation?.incrementalTurnsAlreadyPersisted) {
    return summary;
  }

  const insights = {
    ...summary.insights,
    streamingTurnsAlreadyPersisted: true,
  };
  if (insights.allTokenFrames) {
    delete insights.allTokenFrames;
  }

  return { ...summary, insights };
}

function writeAgentTrackingDebugLog(
  writeDebugLog: (message: string) => void,
  entry: ProxyLogEntry,
  summary: ProxyTrafficSummary,
  correlation: ProxyTrafficSummaryCorrelation | undefined
): void {
  const agent = summary.insights?.agent;
  if (
    agent?.usageEvent !== 'token_delta' &&
    (summary.insights?.allTokenFrames?.length ?? 0) === 0 &&
    !entry.url.includes('BidiAppend')
  ) {
    return;
  }

  writeDebugLog(
    `[AgentTracking] emitTrafficSummary ${entry.direction} ` +
      `${entry.url.includes('BidiAppend') ? 'BidiAppend' : entry.url.includes('RunSSE') ? 'RunSSE' : 'agent'} ` +
      `bidi=${(correlation?.bidiRequestId ?? agent?.requestId)?.slice(0, 8) ?? '(none)'}… ` +
      `conv=${(agent?.conversationId ?? summary.insights?.context?.conversationId)?.slice(0, 8) ?? '(none)'}… ` +
      `usage=${agent?.usageEvent ?? '(none)'} ` +
      `frames=${summary.insights?.allTokenFrames?.length ?? 0} ` +
      `incrPersisted=${correlation?.incrementalTurnsAlreadyPersisted === true}\n`
  );
}
