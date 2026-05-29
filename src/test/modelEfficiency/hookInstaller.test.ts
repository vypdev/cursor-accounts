import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  getHookScriptPath,
  installEfficiencyHook,
  isEfficiencyHookInstalled,
} from '../../modelEfficiency/hookInstaller';
import { getEfficiencyMetadataDir } from '../../modelEfficiency/paths';

describe('hookInstaller', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cursor-hooks-'));
    process.env.HOME = tempHome;

    const extensionPath = path.join(tempHome, 'ext');
    const hookOut = path.join(extensionPath, 'out', 'hooks');
    await fs.mkdir(hookOut, { recursive: true });
    await fs.writeFile(
      path.join(hookOut, 'capture-prompt.js'),
      '#!/usr/bin/env node\n',
      'utf8'
    );
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('installEfficiencyHook writes beforeSubmitPrompt entry', async () => {
    const extensionPath = path.join(tempHome, 'ext');
    const globalStorage = path.join(tempHome, 'global-storage');
    const context = {
      extensionPath,
      globalStorageUri: { fsPath: globalStorage },
    } as never;

    await installEfficiencyHook(context);

    const hooksPath = path.join(tempHome, '.cursor', 'hooks.json');
    const raw = await fs.readFile(hooksPath, 'utf8');
    const config = JSON.parse(raw) as {
      hooks: { beforeSubmitPrompt: Array<{ command: string; env?: Record<string, string> }> };
    };

    assert.ok(config.hooks.beforeSubmitPrompt.length >= 1);
    const entry = config.hooks.beforeSubmitPrompt.find((e) =>
      e.command.includes('capture-prompt.js')
    );
    assert.ok(entry);
    assert.equal(
      entry?.env?.CURSOR_ACCOUNTS_METADATA_DIR,
      getEfficiencyMetadataDir(context)
    );

    const installed = await isEfficiencyHookInstalled(extensionPath);
    assert.equal(installed, true);
    assert.equal(
      getHookScriptPath(extensionPath),
      path.join(extensionPath, 'out', 'hooks', 'capture-prompt.js')
    );
  });
});
