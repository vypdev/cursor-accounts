import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { describe, it } from 'node:test';
import { decodeProtoEntry } from '../proxy/proxyDecode';

const RUNSSE_FIXTURE = path.join(
  os.homedir(),
  '.cursor-accounts/proxy/logs/proxy-2026-06-03-1780530421985.jsonl'
);

describe('decodeProtoEntry RunSSE', () => {
  it('extracts token_delta from recorded RunSSE responses when fixture exists', async () => {
    if (!fs.existsSync(RUNSSE_FIXTURE)) {
      return;
    }

    const logDir = path.dirname(RUNSSE_FIXTURE);
    let checked = 0;
    let withTokens = 0;

    const rl = createInterface({
      input: createReadStream(RUNSSE_FIXTURE),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.includes('RunSSE') || !line.includes('"response"')) {
        continue;
      }

      let entry: Parameters<typeof decodeProtoEntry>[0];
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.timestamp < '2026-06-04T00:13:00.000Z') {
        continue;
      }

      checked += 1;
      const { insights, error } = await decodeProtoEntry(entry, { logDir });
      assert.equal(error, undefined);
      if (insights?.agent?.usageEvent === 'token_delta') {
        withTokens += 1;
        assert.ok((insights.agent.streamingTokens ?? 0) > 0);
      }

      if (checked >= 3) {
        break;
      }
    }

    assert.ok(checked > 0, 'expected at least one RunSSE fixture entry');
    assert.ok(withTokens > 0, 'expected RunSSE stream token_delta extraction');
  });
});
