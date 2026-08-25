import type * as vscode from 'vscode';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { InstanceDetector } from '../profiles/instanceDetector';
import type { ProfileLauncher } from '../profiles/profileLauncher';
import type { IProfileManager } from '../domain/ports/IProfileManager';
import type { ProfileCommandDeps } from './profileCommandDeps';
import { registerProfileCrudCommands } from './registerProfileCrudCommands';
import { registerProfileImportExportCommands } from './registerProfileImportExportCommands';
import { registerProfileLaunchCommands } from './registerProfileLaunchCommands';

export function registerProfileCommands(
  context: vscode.ExtensionContext,
  profileManager: IProfileManager,
  profileLauncher: ProfileLauncher,
  profileDetector: IProfileDetector,
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
