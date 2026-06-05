import type { ProxyTrafficSummary } from '../types/proxyTraffic';
import { estimateTokenCostUsd } from '../../proxy/proxyInsightExtractor';

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
