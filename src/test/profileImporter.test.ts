import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ProfileExporter } from '../profiles/profileExporter';
import {
  ProfileImporter,
  ProfileImporterError,
} from '../profiles/profileImporter';
import { ProfileManager } from '../profiles/profileManager';
import { ProfileStorage } from '../profiles/profileStorage';
import {
  PROFILE_EXPORT_VERSION,
  ProfileExport,
} from '../profiles/types';

describe('ProfileImporter', () => {
  let tempDir: string;
  let manager: ProfileManager;
  let exporter: ProfileExporter;
  let importer: ProfileImporter;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cursor-accounts-import-test-')
    );
    const storage = new ProfileStorage(tempDir);
    manager = new ProfileManager(storage);
    await manager.initialize();
    exporter = new ProfileExporter(manager);
    importer = new ProfileImporter(manager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function buildExport(
    profiles: ProfileExport['profiles'],
    version = PROFILE_EXPORT_VERSION
  ): ProfileExport {
    return {
      version,
      exportedAt: new Date().toISOString(),
      profiles,
    };
  }

  it('imports a valid profile', async () => {
    const exportData = buildExport([
      {
        email: 'new@example.com',
        displayName: 'New Profile',
        theme: 'Light+',
        color: '#ef4444',
        metadata: { notes: 'Imported note' },
      },
    ]);

    const result = await importer.importProfiles(exportData);

    assert.equal(result.success, true);
    assert.equal(result.imported.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(result.imported[0].email, 'new@example.com');
    assert.equal(result.imported[0].metadata?.source, 'imported');
    assert.equal(result.imported[0].metadata?.notes, 'Imported note');
  });

  it('skips duplicate profiles by default', async () => {
    await manager.createProfile({ email: 'dup@example.com' });

    const exportData = buildExport([
      {
        email: 'dup@example.com',
        displayName: 'Duplicate',
      },
    ]);

    const result = await importer.importProfiles(exportData);

    assert.equal(result.success, true);
    assert.equal(result.imported.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.errors.length, 0);
  });

  it('imports settings when requested', async () => {
    const exportData = buildExport([
      {
        email: 'settings-import@example.com',
        displayName: 'Settings Import',
        settings: {
          'editor.fontSize': 18,
        },
      },
    ]);

    const result = await importer.importProfiles(exportData, {
      importSettings: true,
    });

    assert.equal(result.imported.length, 1);

    const settingsPath = path.join(
      result.imported[0].userDataDir,
      'User',
      'settings.json'
    );
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    assert.equal(settings['editor.fontSize'], 18);
  });

  it('continues importing after individual failures', async () => {
    const exportData = buildExport([
      {
        email: 'valid@example.com',
        displayName: 'Valid',
      },
      {
        email: 'not-an-email',
        displayName: 'Invalid',
      },
      {
        email: 'also-valid@example.com',
        displayName: 'Also Valid',
      },
    ]);

    const result = await importer.importProfiles(exportData, {
      strictValidation: false,
    });

    assert.equal(result.success, false);
    assert.equal(result.imported.length, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].profile.email, 'not-an-email');
  });

  it('throws on incompatible export version', async () => {
    const exportData = buildExport(
      [{ email: 'old@example.com', displayName: 'Old' }],
      '0.9.0'
    );

    await assert.rejects(
      () => importer.importProfiles(exportData),
      ProfileImporterError
    );
  });

  it('validates import data and reports warnings', async () => {
    await manager.createProfile({ email: 'existing@example.com' });

    const validation = await importer.validateImport(
      buildExport([
        { email: 'existing@example.com', displayName: 'Existing' },
        { email: 'fresh@example.com', displayName: 'Fresh' },
      ])
    );

    assert.equal(validation.valid, true);
    assert.equal(validation.warnings.length, 1);
    assert.match(validation.warnings[0], /already exist/);
  });

  it('round-trips export to import', async () => {
    const profile = await manager.createProfile({
      email: 'roundtrip@example.com',
      displayName: 'Round Trip',
      theme: 'Dark+',
      color: '#10b981',
      notes: 'Round trip note',
      tags: ['team'],
    });

    const settingsDir = path.join(profile.userDataDir, 'User');
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({ 'editor.wordWrap': 'on' }),
      'utf-8'
    );

    const exportData = await exporter.exportProfiles([profile.id], true);
    const importManager = new ProfileManager(
      new ProfileStorage(path.join(tempDir, 'import-config'))
    );
    await importManager.initialize();
    const importImporter = new ProfileImporter(importManager);

    const result = await importImporter.importProfiles(exportData, {
      importSettings: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.imported.length, 1);

    const imported = result.imported[0];
    assert.equal(imported.email, 'roundtrip@example.com');
    assert.equal(imported.displayName, 'Round Trip');
    assert.equal(imported.theme, 'Dark+');
    assert.equal(imported.color, '#10b981');
    assert.equal(imported.metadata?.notes, 'Round trip note');
    assert.equal(imported.metadata?.tags?.[0], 'team');
    assert.equal(imported.metadata?.source, 'imported');

    const settingsPath = path.join(imported.userDataDir, 'User', 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(settings['editor.wordWrap'], 'on');
  });

  it('imports from JSON string', async () => {
    const exportData = buildExport([
      {
        email: 'string@example.com',
        displayName: 'From String',
      },
    ]);

    const result = await importer.importFromString(JSON.stringify(exportData));

    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0].email, 'string@example.com');
  });
});
