import type * as vscode from 'vscode';
import { buildWorkosSessionCookie } from '../auth/sessionCookie';
import * as extensionLog from '../logging/extensionLog';
import { EFFICIENCY_API_KEY_NAME } from './types';
import { getEfficiencyApiKeySecretKey } from './paths';

const CREATE_API_KEY_URL =
  'https://cursor.com/api/dashboard/create-user-api-key';

export class ApiKeyManagerError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ApiKeyManagerError';
  }
}

interface CreateApiKeyResponse {
  apiKey?: string;
}

export class ApiKeyManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async createApiKey(
    profileId: string,
    accessToken: string
  ): Promise<string> {
    const sessionCookie = buildWorkosSessionCookie(accessToken);

    const response = await fetch(CREATE_API_KEY_URL, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
        Origin: 'https://cursor.com',
        Referer: 'https://cursor.com/dashboard',
      },
      body: JSON.stringify({ name: EFFICIENCY_API_KEY_NAME }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiKeyManagerError(
        `Failed to create API key (${response.status}): ${body.slice(0, 200)}`,
        response.status
      );
    }

    const data = (await response.json()) as CreateApiKeyResponse;
    const apiKey = data.apiKey?.trim();
    if (!apiKey) {
      throw new ApiKeyManagerError('API key response missing apiKey field');
    }

    await this.context.secrets.store(
      getEfficiencyApiKeySecretKey(profileId),
      apiKey
    );

    extensionLog.info(
      `[ApiKeyManager] Stored efficiency API key for profile ${profileId}`
    );

    return apiKey;
  }

  async getApiKey(profileId: string): Promise<string | undefined> {
    return this.context.secrets.get(getEfficiencyApiKeySecretKey(profileId));
  }

  async deleteApiKey(profileId: string): Promise<void> {
    await this.context.secrets.delete(getEfficiencyApiKeySecretKey(profileId));
    extensionLog.info(
      `[ApiKeyManager] Removed efficiency API key for profile ${profileId}`
    );
  }
}
