import type * as vscode from 'vscode';
import type { ProfileCommandDeps } from './profileCommandDeps';
import { registerProfileExportCommand } from './registerProfileExportCommand';
import { registerProfileImportCommand } from './registerProfileImportCommand';

/** Registers profile export and import commands. */
export function registerProfileImportExportCommands(
  context: vscode.ExtensionContext,
  deps: ProfileCommandDeps
): void {
  registerProfileExportCommand(context, deps);
  registerProfileImportCommand(context, deps);
}
