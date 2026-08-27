import type { IProfileAuthReader } from '../domain/ports/IProfileAuthReader';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import * as extensionLog from '../logging/extensionLog';
import { buildSuggestedProfileResponse } from './suggestedProfile';
import type { ToWebviewMessage } from '../profiles/types';

export interface AccountsPanelSuggestedProfileHandlerDependencies {
  profileDetector: Pick<IProfileDetector, 'getCurrentUserDataDir'>;
  authReader: Pick<IProfileAuthReader, 'readTokens'>;
  profileManager: Pick<IProfileManager, 'findProfileByEmail'>;
}

export interface AccountsPanelSuggestedProfileHandlerCallbacks {
  postMessage(message: ToWebviewMessage): Promise<void>;
  hasActiveWebview(): boolean;
}

/** Handles current-session account suggestions for the Accounts panel. */
export class AccountsPanelSuggestedProfileHandlers {
  constructor(
    private readonly dependencies: AccountsPanelSuggestedProfileHandlerDependencies,
    private readonly callbacks: AccountsPanelSuggestedProfileHandlerCallbacks
  ) {}

  async request(): Promise<void> {
    if (!this.callbacks.hasActiveWebview()) {
      return;
    }

    try {
      const userDataDir = this.dependencies.profileDetector.getCurrentUserDataDir();
      const tokens = await this.dependencies.authReader.readTokens(userDataDir);
      const existing = tokens?.email
        ? await this.dependencies.profileManager.findProfileByEmail(tokens.email)
        : undefined;

      await this.callbacks.postMessage(
        buildSuggestedProfileResponse(tokens?.email, existing)
      );
    } catch (error) {
      extensionLog.error(
        `[AccountsPanel] Failed to detect current profile email: ${extensionLog.formatError(error)}`
      );

      if (this.callbacks.hasActiveWebview()) {
        await this.callbacks.postMessage({
          type: 'suggestedProfile',
          email: undefined,
          displayName: undefined,
        });
      }
    }
  }
}
