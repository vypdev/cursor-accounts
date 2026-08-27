import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as vscode from 'vscode';
import {
  clearProxyVscodeConfiguration,
  syncProxyVscodeConfiguration,
} from '../proxy/syncProxyVscodeConfiguration';
import { VscodeProxyWindowConfiguration } from '../proxy/vscodeProxyWindowConfiguration';

type Update = [key: string, value: unknown, target: unknown];

const originalGetConfiguration = vscode.workspace.getConfiguration;

afterEach(() => {
  vscode.workspace.getConfiguration = originalGetConfiguration;
});

function captureUpdates(): Update[] {
  const updates: Update[] = [];
  vscode.workspace.getConfiguration = (() => ({
    update: async (key: string, value: unknown, target: unknown) => {
      updates.push([key, value, target]);
    },
  })) as unknown as typeof vscode.workspace.getConfiguration;
  return updates;
}

describe('VS Code proxy window configuration adapter', () => {
  it('synchronizes all temporary proxy settings through the global target', async () => {
    const updates = captureUpdates();

    await syncProxyVscodeConfiguration('http://127.0.0.1:8080');

    assert.deepEqual(updates, [
      ['proxy', 'http://127.0.0.1:8080', vscode.ConfigurationTarget.Global],
      ['proxySupport', 'override', vscode.ConfigurationTarget.Global],
      ['proxyStrictSSL', false, vscode.ConfigurationTarget.Global],
    ]);
  });

  it('clears all temporary proxy settings through the global target', async () => {
    const updates = captureUpdates();

    await clearProxyVscodeConfiguration();

    assert.deepEqual(updates, [
      ['proxy', undefined, vscode.ConfigurationTarget.Global],
      ['proxySupport', undefined, vscode.ConfigurationTarget.Global],
      ['proxyStrictSSL', undefined, vscode.ConfigurationTarget.Global],
    ]);
  });

  it('exposes the domain port through the VS Code adapter', async () => {
    const updates = captureUpdates();
    const adapter = new VscodeProxyWindowConfiguration();

    await adapter.syncProxy('http://127.0.0.1:8081');
    await adapter.clearProxy();

    assert.equal(updates.length, 6);
    assert.equal(updates[0]?.[1], 'http://127.0.0.1:8081');
    assert.equal(updates[3]?.[1], undefined);
  });
});
