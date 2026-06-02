import type { IInstanceDetector } from '../domain/ports/IInstanceDetector';
import type { IProfileDetector } from '../domain/ports/IProfileDetector';
import type { IProfileLauncher } from '../domain/ports/IProfileLauncher';
import type { IProfileManager } from '../domain/ports/IProfileManager';

/** Dependencies shared by profile-related VS Code commands. */
export interface ProfileCommandDeps {
  profileManager: IProfileManager;
  profileLauncher: IProfileLauncher;
  profileDetector: IProfileDetector;
  instanceDetector?: IInstanceDetector;
}
