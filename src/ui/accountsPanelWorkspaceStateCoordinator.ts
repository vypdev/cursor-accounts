import type { InstanceInfo, ToWebviewMessage } from '@cursor-accounts/types';
import * as extensionLog from '../logging/extensionLog';
import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { ProfileWorkspaceService } from '../application/services/profileWorkspaceService';
import { instanceMapToRecord } from '../profiles/instanceDetector';
import { getOpenWorkspacePaths } from '../services/activeWorkspaceService';
import { buildProfileWorkspaceMap } from './presentation/profileWorkspacePresentation';

interface AccountsPanelWorkspaceStateCoordinatorDependencies {
  profileDetector: IProfileDetector;
  instanceDetector: IInstanceDetector;
  profileWorkspaceService: ProfileWorkspaceService;
}

interface AccountsPanelWorkspaceStateCoordinatorCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  hasActiveWebview(): boolean;
}

/** Coordinates workspace and running-instance projections for the accounts panel. */
export class AccountsPanelWorkspaceStateCoordinator {
  constructor(
    private readonly dependencies: AccountsPanelWorkspaceStateCoordinatorDependencies,
    private readonly callbacks: AccountsPanelWorkspaceStateCoordinatorCallbacks
  ) {}

  async refreshOpenWorkspaces(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const openPaths = getOpenWorkspacePaths();
      const currentProfile =
        await this.dependencies.profileDetector.detectCurrentProfile();
      const profilesWithWorkspaces =
        await this.dependencies.profileWorkspaceService.getProfilesWithWorkspaces();
      const runningInstances = instanceMapToRecord(
        this.dependencies.instanceDetector.getLastDetection()
      );
      const profileWorkspaces = buildProfileWorkspaceMap(
        profilesWithWorkspaces,
        currentProfile,
        openPaths,
        runningInstances
      );

      await this.callbacks.postMessage({
        type: 'openWorkspaces',
        data: { paths: openPaths, profileWorkspaces },
      });
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh open workspaces: ${extensionLog.formatError(error)}`
      );
    }
  }

  async refreshInstances(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const runningInstances =
        await this.dependencies.instanceDetector.detectRunningInstances();
      await this.postRunningInstances(runningInstances);
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to refresh instances: ${extensionLog.formatError(error)}`
      );
    }
  }

  async postRunningInstances(
    instances: Map<string, InstanceInfo>
  ): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    await this.callbacks.postMessage({
      type: 'runningInstances',
      data: instanceMapToRecord(instances),
    });
  }
}
