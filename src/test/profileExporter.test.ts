import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ProfileExporter,
  ProfileExporterError,
} from '../profiles/profileExporter';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import { PROFILE_EXPORT_VERSION } from '../profiles/types';

describe('ProfileExporter', () => {
  let tempDir: string;
  let manager: ProfileManager;
  let exporter: ProfileExporter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-export-test-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
    exporter = new ProfileExporter(manager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('exports profile metadata without settings', async () => {
    const profile = await manager.createProfile({
      email: 'export@example.com',
      displayName: 'Export Test',
      theme: 'Dark+',
      color: '#3b82f6',
      notes: 'Team profile',
      tags: ['work'],
    });

    const exportData = await exporter.exportProfiles([profile.id], false);

    assert.equal(exportData.version, PROFILE_EXPORT_VERSION);
    assert.ok(exportData.exportedAt);
    assert.equal(exportData.profiles.length, 1);

    const exported = exportData.profiles[0];
    assert.equal(exported.email, 'export@example.com');
    assert.equal(exported.displayName, 'Export Test');
    assert.equal(exported.theme, 'Dark+');
    assert.equal(exported.color, '#3b82f6');
    assert.equal(exported.metadata?.notes, 'Team profile');
    assert.equal(exported.metadata?.tags?.[0], 'work');
    assert.equal(exported.settings, undefined);

    assert.equal('id' in exported, false);
    assert.equal('userDataDir' in exported, false);
    assert.equal('slug' in exported, false);
  });

  it('exports profile with settings.json when requested', async () => {
    const profile = await manager.createProfile({
      email: 'settings@example.com',
      displayName: 'Settings Test',
    });

    const settingsDir = path.join(profile.userDataDir, 'User');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, 'settings.json'),
      `{
        // comment
        "editor.fontSize": 14,
        "cursor.apiToken": "secret-value"
      }`,
      'utf-8'
    );

    const exportData = await exporter.exportProfiles([profile.id], true);
    const settings = exportData.profiles[0].settings;

    assert.ok(settings);
    assert.equal(settings['editor.fontSize'], 14);
    assert.equal(settings['cursor.apiToken'], undefined);
  });

  it('exports multiple profiles', async () => {
    const first = await manager.createProfile({
      email: 'first@example.com',
    });
    const second = await manager.createProfile({
      email: 'second@example.com',
    });

    const exportData = await exporter.exportProfiles(
      [first.id, second.id],
      false
    );

    assert.equal(exportData.profiles.length, 2);
    assert.deepEqual(
      exportData.profiles.map((p) => p.email).sort(),
      ['first@example.com', 'second@example.com']
    );
  });

  it('writes export file to disk', async () => {
    const profile = await manager.createProfile({
      email: 'file@example.com',
    });
    const exportPath = path.join(tempDir, 'export.json');

    await exporter.exportToFile([profile.id], exportPath, false);

    const content = await fs.readFile(exportPath, 'utf-8');
    const parsed = JSON.parse(content);

    assert.equal(parsed.version, PROFILE_EXPORT_VERSION);
    assert.equal(parsed.profiles.length, 1);
  });

  it('throws when no profiles are selected', async () => {
    await assert.rejects(
      () => exporter.exportProfiles(['missing-id'], false),
      ProfileExporterError
    );
  });

  it('strips JSON comments from settings', () => {
    const json = `{
      // line comment
      "editor.fontSize": 16,
      /* block comment */
      "editor.tabSize": 2
    }`;

    const stripped = exporter.stripJsonComments(json);
    const parsed = JSON.parse(stripped);

    assert.equal(parsed['editor.fontSize'], 16);
    assert.equal(parsed['editor.tabSize'], 2);
  });

  it('validates export format', () => {
    assert.equal(
      ProfileExporter.validateExport({
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        profiles: [{ email: 'a@b.com', displayName: 'A' }],
      }),
      true
    );

    assert.equal(ProfileExporter.validateExport({ version: '1.0.0' }), false);
    assert.equal(
      ProfileExporter.validateExport({
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        profiles: [{ email: 'a@b.com' }],
      }),
      false
    );
  });
});
