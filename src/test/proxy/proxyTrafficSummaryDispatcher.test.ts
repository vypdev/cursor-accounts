import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProxyLogEntry } from '../../domain/types/proxyLog';
import type { ProxyTrafficSummary } from '../../domain/types/proxyTraffic';
import {
  createProxyTrafficSummaryDispatcher,
  type ProxyTrafficSummaryDispatcherDependencies,
} from '../../proxy/proxyTrafficSummaryDispatcher';

const entry: ProxyLogEntry = {
  timestamp: '2026-08-26T00:00:00.000Z',
  direction: 'response',
  url: 'https://api2.cursor.sh/agent.v1.AgentService/RunSSE',
  host: 'api2.cursor.sh',
  headers: {},
  body: 'response',
};

function createSessionCoordinatorSpies(): {
  tracked: ProxyTrafficSummary[];
  dispatched: Array<{
    summary: ProxyTrafficSummary;
    headers?: Record<string, string>;
  }>;
  dependencies: Pick<
    ProxyTrafficSummaryDispatcherDependencies,
    'sessionCoordinator'
  >;
} {
  const tracked: ProxyTrafficSummary[] = [];
  const dispatched: Array<{
    summary: ProxyTrafficSummary;
    headers?: Record<string, string>;
  }> = [];
  return {
    tracked,
    dispatched,
    dependencies: {
      sessionCoordinator: {
        track(summary) {
          tracked.push(summary as ProxyTrafficSummary);
        },
        dispatch(summary, headers) {
          dispatched.push({ summary, headers });
        },
      },
    },
  };
}

async function flushDispatcher(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('ProxyTrafficSummaryDispatcher', () => {
  it('marks incrementally persisted streams before tracking and dispatching', async () => {
    const spies = createSessionCoordinatorSpies();
    const output: ProxyTrafficSummary[] = [];
    const debugLogs: string[] = [];
    const summary: ProxyTrafficSummary = {
      timestamp: entry.timestamp,
      kind: 'response',
      url: entry.url,
      host: entry.host,
      endpoint: '/agent.v1.AgentService/RunSSE',
      insights: { allTokenFrames: [] },
    };
    const dispatcher = createProxyTrafficSummaryDispatcher({
      enabled: true,
      onTraffic: (value) => output.push(value),
      ...spies.dependencies,
      writeDebugLog: (message) => debugLogs.push(message),
      buildSummary: async (_entry, _durationMs, options) => {
        assert.equal(options?.bidiRequestId, 'bidi-1');
        assert.equal(options?.httpRequestId, 'http-1');
        return summary;
      },
    });

    dispatcher(entry, 42, {
      bidiRequestId: 'bidi-1',
      httpRequestId: 'http-1',
      incrementalTurnsAlreadyPersisted: true,
    });
    await flushDispatcher();

    assert.equal(output.length, 0);
    assert.equal(spies.tracked.length, 1);
    assert.equal(spies.dispatched.length, 1);
    assert.equal(
      spies.tracked[0]?.insights?.streamingTurnsAlreadyPersisted,
      true
    );
    assert.equal('allTokenFrames' in (spies.tracked[0]?.insights ?? {}), false);
    assert.equal(spies.dispatched[0]?.headers, entry.headers);
    assert.deepEqual(debugLogs, []);
  });

  it('publishes a basic summary when decoding fails', async () => {
    const output: ProxyTrafficSummary[] = [];
    const dispatcher = createProxyTrafficSummaryDispatcher({
      enabled: true,
      onTraffic: (value) => output.push(value),
      ...createSessionCoordinatorSpies().dependencies,
      buildSummary: async () => {
        throw new Error('synthetic decode failure');
      },
    });

    dispatcher(entry, 12);
    await flushDispatcher();

    assert.equal(output.length, 1);
    assert.equal(output[0]?.kind, 'response');
    assert.equal(output[0]?.durationMs, 12);
    assert.equal(output[0]?.url, entry.url);
  });
});
