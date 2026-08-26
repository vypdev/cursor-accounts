import type { ProxyAgentSignalCounts } from '@cursor-accounts/types';
import { isAgentIncrementalStreamUrl } from './agentStreamUrls';

export interface AgentSignalUpdate {
  signals: ProxyAgentSignalCounts;
  touched: boolean;
}

type AgentSignalCounter = Exclude<
  keyof ProxyAgentSignalCounts,
  'liveTokenUpdates'
>;

interface AgentSignalRule {
  marker: string;
  requestCounter: AgentSignalCounter;
  responseCounter: AgentSignalCounter;
  requiresIncrementalStream?: boolean;
}

const AGENT_SIGNAL_RULES: readonly AgentSignalRule[] = [
  {
    marker: 'BidiAppend',
    requestCounter: 'bidiAppendRequests',
    responseCounter: 'bidiAppendResponses',
  },
  {
    marker: 'RunPoll',
    requestCounter: 'runPollRequests',
    responseCounter: 'runPollResponses',
  },
  {
    marker: 'StreamBidiSSE',
    requestCounter: 'streamBidiSseRequests',
    responseCounter: 'streamBidiSseResponses',
  },
  {
    marker: 'RunSSE',
    requestCounter: 'runSseRequests',
    responseCounter: 'runSseResponses',
    requiresIncrementalStream: true,
  },
];

export function createAgentSignalCounts(): ProxyAgentSignalCounts {
  return {
    bidiAppendRequests: 0,
    bidiAppendResponses: 0,
    runSseRequests: 0,
    runSseResponses: 0,
    streamBidiSseRequests: 0,
    streamBidiSseResponses: 0,
    runPollRequests: 0,
    runPollResponses: 0,
    liveTokenUpdates: 0,
  };
}

/** Classifies one MITM-visible URL without mutating the collector state. */
export function recordAgentSignals(
  current: ProxyAgentSignalCounts,
  url: string,
  direction: 'request' | 'response'
): AgentSignalUpdate {
  const signals = { ...current };
  let touched = false;

  for (const rule of AGENT_SIGNAL_RULES) {
    if (!matchesRule(rule, url)) {
      continue;
    }
    const counter =
      direction === 'request' ? rule.requestCounter : rule.responseCounter;
    signals[counter] += 1;
    touched = true;
  }

  return { signals, touched };
}

function matchesRule(rule: AgentSignalRule, url: string): boolean {
  return (
    url.includes(rule.marker) &&
    (!rule.requiresIncrementalStream || isAgentIncrementalStreamUrl(url))
  );
}
