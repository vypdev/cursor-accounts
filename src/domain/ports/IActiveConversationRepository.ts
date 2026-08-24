import type { ActiveConversationState } from '../types/activeConversation';

/**
 * Port for reading which Composer chat tab is focused in the active window.
 * Backed by Cursor workspace `state.vscdb`, not extension-owned storage.
 */
export interface IActiveConversationRepository {
  /**
   * Read the current active conversation snapshot.
   * @param workspaceStateDbPath Absolute path to workspace `state.vscdb`.
   */
  read(workspaceStateDbPath: string): Promise<ActiveConversationState | null>;
}
