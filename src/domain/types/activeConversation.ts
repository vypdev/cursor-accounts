/** Cursor workspace `composer.composerData` key in `state.vscdb` ItemTable. */
export const COMPOSER_WORKSPACE_DATA_KEY = 'composer.composerData';

/** Active chat tab state read from workspace-scoped Cursor storage. */
export interface ActiveConversationState {
  /** Primary focused composer UUID (= Agent `conversation_id`). */
  lastFocusedComposerId: string | null;
  /** Tab(s) currently selected in the Composer panel. */
  selectedComposerIds: string[];
  /** SQLite key the snapshot was read from. */
  sourceKey: typeof COMPOSER_WORKSPACE_DATA_KEY;
}
