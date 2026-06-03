import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG_DIR } from '@cursor-accounts/types';
import { getSharedProxyStorageDir } from '../proxy/sharedProxyPaths';

describe('getSharedProxyStorageDir', () => {
  it('uses ~/.cursor-accounts/proxy so all windows share state', () => {
    const dir = getSharedProxyStorageDir();
    assert.equal(
      dir,
      path.join(os.homedir(), DEFAULT_CONFIG_DIR, 'proxy')
    );
  });
});
