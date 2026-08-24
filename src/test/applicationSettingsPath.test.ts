import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import { resolveProfileSettingsPaths } from '../profiles/applicationSettingsPath';

describe('resolveProfileSettingsPaths', () => {
  let tempRoot: string;

  before(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-test-app-settings-')
    );
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('returns User/settings.json as application settings path', async () => {
    const userDataDir = path.join(tempRoot, 'profile');
    const paths = await resolveProfileSettingsPaths(userDataDir);
    assert.equal(
      paths.applicationSettingsPath,
      path.join(userDataDir, 'User', 'settings.json')
    );
    assert.deepEqual(paths.profileSettingsPaths, []);
  });

  it('lists profile-specific settings under User/profiles', async () => {
    const userDataDir = path.join(tempRoot, 'with-profiles');
    const profilesDir = path.join(userDataDir, 'User', 'profiles', 'abc-123');
    await fs.mkdir(profilesDir, { recursive: true });
    await fs.writeFile(path.join(profilesDir, 'settings.json'), '{}', 'utf-8');

    const paths = await resolveProfileSettingsPaths(userDataDir);
    assert.equal(paths.profileSettingsPaths.length, 1);
    assert.equal(
      paths.profileSettingsPaths[0],
      path.join(profilesDir, 'settings.json')
    );
  });
});
