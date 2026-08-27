import type { ConversationContext } from '../../application/types/proxyInsights';
import { asNumber } from './fieldNormalization';

function extractFilePath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const filePath = (value as Record<string, unknown>).path;
  return typeof filePath === 'string' ? filePath : undefined;
}

function extractMessageFilePaths(message: unknown): string[] {
  if (!message || typeof message !== 'object') {
    return [];
  }
  const userContext = (message as Record<string, unknown>).user_context;
  if (!userContext || typeof userContext !== 'object') {
    return [];
  }
  const files = (userContext as Record<string, unknown>).files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .map(extractFilePath)
    .filter((filePath): filePath is string => filePath !== undefined);
}

/** Extract conversation context from composer/chat requests. */
export function extractConversationContext(
  decoded: Record<string, unknown> | null | undefined
): ConversationContext | null {
  if (!decoded) {
    return null;
  }

  const messages = decoded.conversation_messages ?? decoded.conversationMessages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const files = new Set(
    messages.flatMap((message) => extractMessageFilePaths(message))
  );

  return {
    conversationId:
      (decoded.conversation_id as string | undefined) ??
      (decoded.conversationId as string | undefined),
    messageCount: messages.length,
    totalContextTokens: asNumber(decoded.total_context_tokens),
    includedFiles: files.size > 0 ? [...files] : undefined,
  };
}
