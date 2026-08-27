import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import * as extensionLog from '../logging/extensionLog';
import { getEfficiencyWrongWindowMessage } from '../modelEfficiency/efficiencyService';
import type { Profile, ToWebviewMessage } from '../profiles/types';

export interface AccountsPanelEfficiencyService {
  setEfficiencyEnabled(
    profileId: string,
    enabled: boolean
  ): Promise<{ profile: Profile; message: string }>;
}

export interface AccountsPanelEfficiencyHandlerDependencies {
  profileDetector: Pick<IProfileDetector, 'detectCurrentProfile'>;
  efficiencyService: AccountsPanelEfficiencyService;
}

export interface AccountsPanelEfficiencyHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  refresh(): Promise<void>;
}

/** Handles the Accounts panel's efficiency toggle presentation workflow. */
export class AccountsPanelEfficiencyHandlers {
  constructor(
    private readonly dependencies: AccountsPanelEfficiencyHandlerDependencies,
    private readonly callbacks: AccountsPanelEfficiencyHandlerCallbacks
  ) {}

  async toggle(profileId: string, enabled: boolean): Promise<void> {
    const current = await this.dependencies.profileDetector.detectCurrentProfile();
    if (!current || current.id !== profileId) {
      throw new Error(getEfficiencyWrongWindowMessage());
    }

    extensionLog.info(
      `[AccountsPanel] Toggle efficiency ${enabled ? 'on' : 'off'} for ${profileId}`
    );

    const result = await this.dependencies.efficiencyService.setEfficiencyEnabled(
      profileId,
      enabled
    );

    await this.callbacks.postMessage({
      type: 'success',
      message: result.message,
    });
    await this.callbacks.refresh();
  }
}
