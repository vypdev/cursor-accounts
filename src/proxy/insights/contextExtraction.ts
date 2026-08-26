import type { ConversationContext } from '../../application/types/proxyInsights';
import { asNumber } from './fieldNormalization';

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

  const files = new Set<string>();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') {
      continue;
    }
    const userContext = (msg as Record<string, unknown>).user_context as
      | Record<string, unknown>
      | undefined;
    const fileList = userContext?.files;
    if (Array.isArray(fileList)) {
      for (const file of fileList) {
        if (file && typeof file === 'object') {
          const path = (file as Record<string, unknown>).path;
          if (typeof path === 'string') {
            files.add(path);
          }
        }
      }
    }
  }

  return {
    conversationId:
      (decoded.conversation_id as string | undefined) ??
      (decoded.conversationId as string | undefined),
    messageCount: messages.length,
    totalContextTokens: asNumber(decoded.total_context_tokens),
    includedFiles: files.size > 0 ? [...files] : undefined,
  };
}
