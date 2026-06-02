import type * as vscode from 'vscode';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileDetector } from '../profiles/profileDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { ProfileManager } from '../profiles/profileManager';
import type { ProfileCommandDeps } from './profileCommandDeps';
import { registerProfileCrudCommands } from './registerProfileCrudCommands';
import { registerProfileImportExportCommands } from './registerProfileImportExportCommands';
import { registerProfileLaunchCommands } from './registerProfileLaunchCommands';

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileManager: ProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: ProfileDetector,
  instanceDetector?: InstanceDetector
): void {
  const deps: ProfileCommandDeps = {
    profileManager,
    profileLauncher,
    profileDetector,
    instanceDetector,
  };

  registerProfileCrudCommands(context, deps);
  registerProfileLaunchCommands(context, deps);
  registerProfileImportExportCommands(context, deps);
}
