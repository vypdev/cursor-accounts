import type * as vscode from 'vscode';
import { fetchCurrentUser } from '../api/userClient';
import type { ProfileAccountView } from '../api/types';
import { getProfileStateDbPath } from '../auth/cursorPaths';
import { readAuthFromStateDb } from '../auth/tokenReader';
import type { Profile } from '../profiles/types';
import { validateUserDataPath } from '../utils/pathUtils';

export class ProfileAccountFetcher {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Fetch live account info for all configured profiles (parallel). */
  async fetchAllProfileAccounts(
    profiles: Profile[]
  ): Promise<Map<string, ProfileAccountView>> {
    if (profiles.length === 0) {
      return new Map();
    }

    const results = await Promise.allSettled(
      profiles.map((profile) => this.fetchAccountForProfile(profile))
    );

    const accountMap = new Map<string, ProfileAccountView>();

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const result = results[i];
      if (!profile || !result) {
        continue;
      }

      if (result.status === 'fulfilled') {
        accountMap.set(profile.id, result.value);
      } else {
        const reason: unknown = result.reason;
        accountMap.set(profile.id, {
          profileId: profile.id,
          error:
            reason instanceof Error
              ? reason.message
              : 'Failed to fetch account info',
          fetchedAt: Date.now(),
        });
      }
    }

    return accountMap;
  }

  /** Fetch live account info for the active Cursor window user data dir. */
  async fetchActiveWindowAccount(
    userDataDir: string,
    profileId?: string
  ): Promise<ProfileAccountView | null> {
    const id = profileId ?? '__active__';

    try {
      const pathValidation = validateUserDataPath(userDataDir);
      if (!pathValidation.valid) {
        return {
          profileId: id,
          error: pathValidation.error ?? 'Invalid profile path',
          fetchedAt: Date.now(),
        };
      }

      const stateDbPath = getProfileStateDbPath(userDataDir);
      const tokens = await readAuthFromStateDb(
        stateDbPath,
        this.context.extensionPath
      );

      if (!tokens?.accessToken) {
        return {
          profileId: id,
          error: 'No authentication tokens found.',
          fetchedAt: Date.now(),
        };
      }

      return await this.fetchFromToken(id, tokens.accessToken);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        profileId: id,
        error: this.toAuthErrorMessage(message),
        fetchedAt: Date.now(),
      };
    }
  }

  private async fetchAccountForProfile(
    profile: Profile
  ): Promise<ProfileAccountView> {
    try {
      const pathValidation = validateUserDataPath(profile.userDataDir);
      if (!pathValidation.valid) {
        return {
          profileId: profile.id,
          error: pathValidation.error ?? 'Invalid profile path',
          fetchedAt: Date.now(),
        };
      }

      const stateDbPath = getProfileStateDbPath(profile.userDataDir);
      const tokens = await readAuthFromStateDb(
        stateDbPath,
        this.context.extensionPath
      );

      if (!tokens?.accessToken) {
        return {
          profileId: profile.id,
          error: 'No authentication tokens found. Launch profile to sign in.',
          fetchedAt: Date.now(),
        };
      }

      return await this.fetchFromToken(profile.id, tokens.accessToken);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        profileId: profile.id,
        error: this.toAuthErrorMessage(message),
        fetchedAt: Date.now(),
      };
    }
  }

  private async fetchFromToken(
    profileId: string,
    accessToken: string
  ): Promise<ProfileAccountView> {
    const info = await fetchCurrentUser(accessToken);

    return {
      profileId,
      accountName: info.name,
      pictureUrl: info.picture,
      fetchedAt: Date.now(),
    };
  }

  private toAuthErrorMessage(message: string): string {
    const lower = message.toLowerCase();
    if (
      lower.includes('401') ||
      lower.includes('expired') ||
      lower.includes('unauthorized')
    ) {
      return 'Authentication expired. Launch profile to sign in again.';
    }
    return message;
  }
}

/** Convert account Map to JSON-safe Record for webview messaging. */
export function accountMapToRecord(
  accounts: Map<string, ProfileAccountView>
): Record<string, ProfileAccountView> {
  return Object.fromEntries(accounts.entries());
}
