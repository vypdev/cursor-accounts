import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseJsonc, type ParseError } from 'jsonc-parser';
import type {
  IProfileSettingsManager,
  ProxyBackupInfo,
} from '../domain/ports/IProfileSettingsManager';
import { validateUserDataPath } from '../utils/pathUtils';
import { resolveProfileSettingsPaths } from './applicationSettingsPath';
import * as extensionLog from '../logging/extensionLog';

export class ProfileSettingsError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProfileSettingsError';
  }
}

const PROXY_BACKUP_KEY = 'http.proxy.backup';
const PROXY_KEY = 'http.proxy';
const PROXY_SUPPORT_KEY = 'http.proxySupport';
const PROXY_SSL_KEY = 'http.proxyStrictSSL';
/** Force HTTP/1.1 so Agent streams route through MITM (HTTP/2 often bypasses proxy). */
export const DISABLE_HTTP2_KEY = 'cursor.general.disableHttp2';

const PROXY_SUPPORT_OVERRIDE = 'override';
const PROXY_STRICT_SSL_OFF = false;

/**
 * Reads/writes profile User/settings.json and applies temporary MITM proxy overrides.
 */
export class ProfileSettingsManager implements IProfileSettingsManager {
  async readSettings(
    userDataDir: string,
    settingsPath?: string
  ): Promise<Record<string, unknown> | null> {
    this.assertValidUserDataDir(userDataDir);
    const resolvedPath =
      settingsPath ?? (await this.getApplicationSettingsPath(userDataDir));

    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      // Use jsonc-parser to handle comments and trailing commas (same as VS Code)
      const errors: ParseError[] = [];
      const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
      
      // Check for parse errors after allowing trailing commas
      if (errors.length > 0) {
        throw new Error(`Invalid JSON: ${errors.length} parse error(s)`);
      }
      
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (this.isENOENT(error)) {
        return null;
      }
      throw new ProfileSettingsError(
        `Failed to read settings at ${resolvedPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async writeSettings(
    userDataDir: string,
    settings: Record<string, unknown>,
    settingsPath?: string
  ): Promise<void> {
    this.assertValidUserDataDir(userDataDir);
    const targetPath =
      settingsPath ?? (await this.getApplicationSettingsPath(userDataDir));
    const userDir = path.dirname(targetPath);
    await fs.mkdir(userDir, { recursive: true });

    const tmpPath = `${targetPath}.${process.pid}.tmp`;
    const json = `${JSON.stringify(settings, null, 2)}\n`;

    try {
      await fs.writeFile(tmpPath, json, 'utf-8');
      await fs.rename(tmpPath, targetPath);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw new ProfileSettingsError(
        `Failed to write settings at ${targetPath}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async applyProxySettings(
    userDataDir: string,
    proxyUrl: string
  ): Promise<void> {
    const settings = (await this.readSettings(userDataDir)) ?? {};
    const currentProxy = this.asString(settings[PROXY_KEY]);

    if (
      currentProxy === proxyUrl &&
      !this.hasMeaningfulBackup(settings) &&
      settings[DISABLE_HTTP2_KEY] === true
    ) {
      return;
    }

    if (
      currentProxy != null &&
      currentProxy.length > 0 &&
      currentProxy !== proxyUrl &&
      settings[PROXY_BACKUP_KEY] === undefined
    ) {
      settings[PROXY_BACKUP_KEY] = currentProxy;
    }

    settings[PROXY_KEY] = proxyUrl;
    settings[PROXY_SUPPORT_KEY] = PROXY_SUPPORT_OVERRIDE;
    settings[PROXY_SSL_KEY] = PROXY_STRICT_SSL_OFF;
    settings[DISABLE_HTTP2_KEY] = true;

    const applicationPath = await this.getApplicationSettingsPath(userDataDir);
    await this.writeSettings(userDataDir, settings, applicationPath);
    extensionLog.info(
      `[ProfileSettings] Applied proxy to application settings: ${applicationPath}`
    );
  }

  async restoreProxySettings(userDataDir: string): Promise<void> {
    const applicationPath = await this.getApplicationSettingsPath(userDataDir);
    const settings = await this.readSettings(userDataDir, applicationPath);
    if (settings == null) {
      return;
    }

    const backup = settings[PROXY_BACKUP_KEY];
    if (backup !== undefined) {
      settings[PROXY_KEY] = backup;
      delete settings[PROXY_BACKUP_KEY];
      delete settings[PROXY_SUPPORT_KEY];
      delete settings[PROXY_SSL_KEY];
      delete settings[DISABLE_HTTP2_KEY];
      await this.writeSettings(userDataDir, settings, applicationPath);
      return;
    }

    if (!this.hasAppliedProxyKeys(settings)) {
      return;
    }

    delete settings[PROXY_KEY];
    delete settings[PROXY_SUPPORT_KEY];
    delete settings[PROXY_SSL_KEY];
    delete settings[DISABLE_HTTP2_KEY];
    await this.writeSettings(userDataDir, settings, applicationPath);
  }

  async getProxyBackupInfo(userDataDir: string): Promise<ProxyBackupInfo> {
    try {
      const applicationPath = await this.getApplicationSettingsPath(userDataDir);
      const settings = await this.readSettings(userDataDir, applicationPath);
      if (settings == null) {
        return { hasBackup: false };
      }

      const backupProxyUrl = this.asString(settings[PROXY_BACKUP_KEY]);
      const hasBackup = backupProxyUrl !== undefined;

      return {
        hasBackup,
        currentProxyUrl: this.asString(settings[PROXY_KEY]),
        backupProxyUrl,
      };
    } catch {
      return { hasBackup: false };
    }
  }

  private async getApplicationSettingsPath(userDataDir: string): Promise<string> {
    const paths = await resolveProfileSettingsPaths(userDataDir);
    return paths.applicationSettingsPath;
  }

  private assertValidUserDataDir(userDataDir: string): void {
    const validation = validateUserDataPath(userDataDir);
    if (!validation.valid) {
      throw new ProfileSettingsError(
        validation.error ?? 'Invalid user data directory'
      );
    }
  }

  private hasMeaningfulBackup(settings: Record<string, unknown>): boolean {
    return settings[PROXY_BACKUP_KEY] !== undefined;
  }

  private hasAppliedProxyKeys(settings: Record<string, unknown>): boolean {
    return (
      settings[PROXY_KEY] !== undefined ||
      settings[PROXY_SUPPORT_KEY] === PROXY_SUPPORT_OVERRIDE ||
      settings[PROXY_SSL_KEY] === PROXY_STRICT_SSL_OFF ||
      settings[DISABLE_HTTP2_KEY] === true
    );
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private isENOENT(error: unknown): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    );
  }
}
