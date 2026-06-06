import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { FileConfigLoader } from '../../../../proxy/multiplexer/storage/fileConfigLoader';

describe('FileConfigLoader', () => {
  it('returns defaults when config file is missing', async () => {
    const loader = new FileConfigLoader(
      path.join(os.tmpdir(), `missing-multiplexer-${Date.now()}.json`)
    );
    const config = await loader.load();
    assert.equal(config.router.port, 9999);
    assert.equal(config.routing.strategy, 'sticky-session');
  });

  it('merges and validates persisted config', async () => {
    const configPath = path.join(
      os.tmpdir(),
      `multiplexer-config-${Date.now()}.json`
    );
    const loader = new FileConfigLoader(configPath);
    await loader.save({
      router: { port: 10001, host: '127.0.0.1' },
      upstreams: [{ id: 'u1', host: '127.0.0.1', port: 8080 }],
      routing: { strategy: 'workspace-path' },
      health: {
        checkIntervalMs: 10_000,
        timeoutMs: 2_000,
        unhealthyThreshold: 2,
      },
    });

    const raw = await fs.readFile(configPath, 'utf8');
    assert.match(raw, /workspace-path/);
    const loaded = await loader.load();
    assert.equal(loaded.router.port, 10001);
    assert.equal(loaded.routing.strategy, 'workspace-path');
  });
});
