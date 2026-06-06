import type { ActiveConversationState } from '../application/types/activeConversation';
import { COMPOSER_WORKSPACE_DATA_KEY } from '../application/types/activeConversation';
import type { IActiveConversationRepository } from '../domain/ports/IActiveConversationRepository';
import { readItemTableKey } from '../modelEfficiency/stateDbReader';
import {
  parseComposerWorkspaceData,
  toActiveConversationState,
} from './composerWorkspaceDataParse';

export class SqliteActiveConversationRepository
  implements IActiveConversationRepository
{
  constructor(private readonly extensionPath: string) {}

  async read(workspaceStateDbPath: string): Promise<ActiveConversationState | null> {
    const raw = await readItemTableKey(
      workspaceStateDbPath,
      COMPOSER_WORKSPACE_DATA_KEY,
      this.extensionPath
    );
    const parsed = parseComposerWorkspaceData(raw);
    if (!parsed) {
      return null;
    }

    return toActiveConversationState(parsed);
  }
}
