import {
  BubbleRow,
  ComposerDataRow,
  ComposerHeaderEntry,
  ComposerHeadersPayload,
  ConversationBubbleHeader,
} from './types';

export const USER_BUBBLE_TYPE = 1;

export function parseComposerHeaders(
  raw: string | null
): ComposerHeadersPayload | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ComposerHeadersPayload;
    if (!Array.isArray(parsed.allComposers)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseComposerData(raw: string | null): ComposerDataRow | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as ComposerDataRow;
  } catch {
    return null;
  }
}

export function parseBubbleRow(raw: string | null): BubbleRow | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as BubbleRow;
  } catch {
    return null;
  }
}

export function getUserBubbleHeaders(
  data: ComposerDataRow | null
): ConversationBubbleHeader[] {
  if (!data?.fullConversationHeadersOnly) {
    return [];
  }
  return data.fullConversationHeadersOnly.filter(
    (h) => h.type === USER_BUBBLE_TYPE && typeof h.bubbleId === 'string'
  );
}

export function extractWorkspaceRoots(
  header: ComposerHeaderEntry | undefined
): string[] {
  const repos = header?.trackedGitRepos;
  if (!Array.isArray(repos)) {
    return [];
  }
  return repos
    .map((r) => r?.repoPath)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/** Best-effort plain text from Lexical richText JSON when `text` is empty. */
export function extractPlainTextFromRichText(richText: string | undefined): string {
  if (!richText?.trim()) {
    return '';
  }
  try {
    const root = JSON.parse(richText) as {
      root?: { children?: Array<{ children?: Array<{ text?: string }> }> };
    };
    const parts: string[] = [];
    const walk = (nodes: unknown): void => {
      if (!Array.isArray(nodes)) {
        return;
      }
      for (const node of nodes) {
        if (node && typeof node === 'object') {
          const n = node as { text?: string; children?: unknown };
          if (typeof n.text === 'string' && n.text) {
            parts.push(n.text);
          }
          if (n.children) {
            walk(n.children);
          }
        }
      }
    };
    walk(root.root?.children);
    return parts.join('').trim();
  } catch {
    return '';
  }
}

export function bubbleCreatedAtMs(bubble: BubbleRow): number | undefined {
  if (typeof bubble.createdAt === 'string') {
    const parsed = Date.parse(bubble.createdAt);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}
