import type { ProxyTrafficSummary } from '../application/types/proxyTraffic';
import { estimateTokenCostUsd } from './proxyInsightExtractor';

export function createProxyCostEnricher(
  getRate: () => number
): (summary: ProxyTrafficSummary) => ProxyTrafficSummary {
  return (summary) => {
    const agent = summary.insights?.agent;
    if (!agent) {
      return summary;
    }
    const cost = estimateTokenCostUsd(agent, getRate());
    if (cost == null) {
      return summary;
    }
    return {
      ...summary,
      insights: {
        ...summary.insights,
        agent: { ...agent, estimatedCostUsd: cost },
      },
    };
  };
}
