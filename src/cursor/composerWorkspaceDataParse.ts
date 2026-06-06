import type { ActiveConversationState } from '../application/types/activeConversation';
import { COMPOSER_WORKSPACE_DATA_KEY } from '../application/types/activeConversation';

export interface ComposerWorkspaceData {
  selectedComposerIds?: string[];
  lastFocusedComposerIds?: string[];
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function parseComposerWorkspaceData(
  raw: string | null
): ComposerWorkspaceData | null {
  if (!raw?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ComposerWorkspaceData;
    return {
      selectedComposerIds: normalizeIdList(parsed.selectedComposerIds),
      lastFocusedComposerIds: normalizeIdList(parsed.lastFocusedComposerIds),
    };
  } catch {
    return null;
  }
}

export function toActiveConversationState(
  data: ComposerWorkspaceData
): ActiveConversationState {
  const lastFocusedComposerId =
    data.lastFocusedComposerIds?.[0] ?? data.selectedComposerIds?.[0] ?? null;

  return {
    lastFocusedComposerId,
    selectedComposerIds: data.selectedComposerIds ?? [],
    sourceKey: COMPOSER_WORKSPACE_DATA_KEY,
  };
}
