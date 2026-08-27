import type { ExtensionContext } from 'vscode';
import type { ProfileCommandDeps } from './profileCommandDeps';
import { registerProfileAddCommand } from './registerProfileAddCommand';
import { registerProfileCurrentCommand } from './registerProfileCurrentCommand';
import { registerProfileDeleteCommand } from './registerProfileDeleteCommand';
import { registerProfileListCommand } from './registerProfileListCommand';

/** Registers add, delete, list, and show-current profile commands. */
export function registerProfileCrudCommands(
  context: ExtensionContext,
  deps: ProfileCommandDeps
): void {
  registerProfileAddCommand(context, deps);
  registerProfileListCommand(context, deps);
  registerProfileDeleteCommand(context, deps);
  registerProfileCurrentCommand(context, deps);
}
