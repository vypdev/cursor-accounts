import {
  bubbleCreatedAtMs,
  extractPlainTextFromRichText,
  USER_BUBBLE_TYPE,
} from './composerDbParse';
import type { BubbleRow } from './types';
import type { PromptMetadata } from './types';

export interface ComposerPromptContext {
  composerId: string;
  profileEmail: string;
  model: string;
  modelResolved: boolean;
  workspaceRoots: string[];
  gitBranch?: string;
  lastUpdated: number;
  enabledAtMs: number;
}

/** Converts a validated Composer bubble into analysis input, if eligible. */
export function buildPromptMetadata(
  bubble: BubbleRow | null,
  context: ComposerPromptContext
): PromptMetadata | undefined {
  if (!bubble || bubble.type !== USER_BUBBLE_TYPE) {
    return undefined;
  }

  const createdAtMs = bubbleCreatedAtMs(bubble);
  if (
    createdAtMs !== undefined &&
    !Number.isNaN(context.enabledAtMs) &&
    createdAtMs < context.enabledAtMs
  ) {
    return undefined;
  }

  let prompt = typeof bubble.text === 'string' ? bubble.text.trim() : '';
  if (!prompt && bubble.richText) {
    prompt = extractPlainTextFromRichText(bubble.richText);
  }
  if (!prompt) {
    return undefined;
  }

  return {
    timestamp: createdAtMs ?? context.lastUpdated,
    prompt,
    model: context.model,
    modelResolved: context.modelResolved,
    attachments: [],
    conversationId: context.composerId,
    workspaceRoots: context.workspaceRoots,
    gitBranch: context.gitBranch,
    userEmail: context.profileEmail,
  };
}
