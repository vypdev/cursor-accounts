import '../registerVscodeMock';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InstanceInfo, ToWebviewMessage } from '@cursor-accounts/types';
import type { IInstanceDetector } from '../../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../../domain/ports/IProfileDetector';
import type { ProfileWorkspaceService } from '../../application/services/profileWorkspaceService';
import { AccountsPanelWorkspaceStateCoordinator } from '../../ui/accountsPanelWorkspaceStateCoordinator';

const INSTANCE: InstanceInfo = {
  profileId: 'p1',
  pid: 123,
  userDataDir: '/tmp/cursor-user',
  detectedAt: 1,
};

function createCoordinator(options: {
  active?: boolean;
  detectError?: Error;
  workspaceError?: Error;
} = {}) {
  const postedMessages: ToWebviewMessage[] = [];
  const profileDetector = {
    detectCurrentProfile: async () => null,
  } as unknown as IProfileDetector;
  const instanceDetector = {
    detectRunningInstances: async () => {
      if (options.detectError) {
        throw options.detectError;
      }
      return new Map([['p1', INSTANCE]]);
    },
    getLastDetection: () => new Map([['p1', INSTANCE]]),
  } as unknown as IInstanceDetector;
  const profileWorkspaceService = {
    getProfilesWithWorkspaces: async () => {
      if (options.workspaceError) {
        throw options.workspaceError;
      }
      return [];
    },
  } as unknown as ProfileWorkspaceService;
  const coordinator = new AccountsPanelWorkspaceStateCoordinator(
    { profileDetector, instanceDetector, profileWorkspaceService },
    {
      postMessage: async (message) => {
        postedMessages.push(message);
      },
      hasActiveWebview: () => options.active ?? true,
    }
  );

  return { coordinator, postedMessages };
}

describe('AccountsPanelWorkspaceStateCoordinator', () => {
  it('does not query or post while the webview is inactive', async () => {
    const { coordinator, postedMessages } = createCoordinator({ active: false });

    await coordinator.refreshOpenWorkspaces();
    await coordinator.refreshInstances();
    await coordinator.postRunningInstances(new Map([['p1', INSTANCE]]));

    assert.deepEqual(postedMessages, []);
  });

  it('publishes open workspace state from the last instance detection', async () => {
    const { coordinator, postedMessages } = createCoordinator();

    await coordinator.refreshOpenWorkspaces();

    assert.deepEqual(postedMessages, [
      {
        type: 'openWorkspaces',
        data: { paths: [], profileWorkspaces: {} },
      },
    ]);
  });

  it('detects and publishes current running instances', async () => {
    const { coordinator, postedMessages } = createCoordinator();

    await coordinator.refreshInstances();

    assert.deepEqual(postedMessages, [
      { type: 'runningInstances', data: { p1: INSTANCE } },
    ]);
  });

  it('publishes an explicitly supplied instance projection', async () => {
    const { coordinator, postedMessages } = createCoordinator();

    await coordinator.postRunningInstances(new Map([['p1', INSTANCE]]));

    assert.deepEqual(postedMessages, [
      { type: 'runningInstances', data: { p1: INSTANCE } },
    ]);
  });

  it('contains workspace and instance detection failures', async () => {
    const workspace = createCoordinator({ workspaceError: new Error('workspace') });
    const instances = createCoordinator({ detectError: new Error('instances') });

    await workspace.coordinator.refreshOpenWorkspaces();
    await instances.coordinator.refreshInstances();

    assert.deepEqual(workspace.postedMessages, []);
    assert.deepEqual(instances.postedMessages, []);
  });
});
