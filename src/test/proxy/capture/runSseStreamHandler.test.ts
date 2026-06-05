import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RunSseStreamHandler } from '../../../proxy/capture/runSseStreamHandler';

describe('RunSseStreamHandler', () => {
  it('emits live token update summary', () => {
    const summaries: unknown[] = [];
    const handler = new RunSseStreamHandler((s) => summaries.push(s));

    handler.emitLiveTokenUpdate(
      {
        accumulatedTokens: 100,
        latestDelta: 50,
        agent: { streamingTokens: 100, usageEvent: 'token_delta' },
      },
      {
        url: 'https://api2.cursor.sh/RunSSE',
        host: 'api2.cursor.sh',
        httpRequestId: 'http-1',
        bidiRequestId: 'bidi-1',
        isCursorHost: true,
      }
    );

    assert.equal(summaries.length, 1);
    const summary = summaries[0] as { isLiveTokenUpdate?: boolean };
    assert.equal(summary.isLiveTokenUpdate, true);
  });
});
