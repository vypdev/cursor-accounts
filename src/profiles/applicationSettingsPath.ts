import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Paths where VS Code/Cursor store settings for a --user-data-dir instance.
 *
 * Application-scoped keys (e.g. http.proxy) are read from the default profile
 * settings file, not from User/profiles/<id>/settings.json. The Settings UI label
 * "Applies to all profiles" refers to VS Code Settings Profiles inside that instance.
 */
export interface ProfileSettingsPaths {
  /** Default / application settings (http.proxy belongs here). */
  applicationSettingsPath: string;
  /** Optional per-profile overrides under User/profiles/<id>/settings.json. */
  profileSettingsPaths: string[];
}

/**
 * Resolve settings.json paths for a Cursor user data directory.
 */
export async function resolveProfileSettingsPaths(
  userDataDir: string
): Promise<ProfileSettingsPaths> {
  const userDir = path.join(userDataDir, 'User');
  const applicationSettingsPath = path.join(userDir, 'settings.json');
  const profileSettingsPaths: string[] = [];

  const profilesDir = path.join(userDir, 'profiles');
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      profileSettingsPaths.push(
        path.join(profilesDir, entry.name, 'settings.json')
      );
    }
  } catch {
    // No VS Code Settings Profiles folder — only application settings apply.
  }

  return { applicationSettingsPath, profileSettingsPaths };
}
