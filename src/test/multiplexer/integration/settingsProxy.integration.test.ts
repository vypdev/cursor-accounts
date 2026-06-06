import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProfileSettingsManager } from '../../../profiles/profileSettingsManager';

describe('Settings proxy integration', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('applies and restores global multiplexer proxy in settings.json', async () => {
    tempDir = path.join(
      os.homedir(),
      `.cursor-accounts-test-settings-${process.pid}`
    );
    const userDir = path.join(tempDir, 'User');
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(userDir, { recursive: true });

    const manager = new ProfileSettingsManager();
    const proxyUrl = 'http://127.0.0.1:9000';

    await manager.applyProxySettings(tempDir, proxyUrl);

    const settings = await manager.readSettings(tempDir);
    assert.equal(settings?.['http.proxy'], proxyUrl);
    assert.equal(settings?.['http.proxySupport'], 'override');

    await manager.restoreProxySettings(tempDir);

    const restored = await manager.readSettings(tempDir);
    assert.equal(restored?.['http.proxy'], undefined);
  });
});
