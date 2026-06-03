/**
 * Shared insight helpers for verify/analyze scripts (Connect JSON uses camelCase).
 */

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
export function extractBillingInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const hasSnake =
    obj.billing_cycle_start != null || obj.plan_usage != null;
  const hasCamel =
    obj.billingCycleStart != null || obj.planUsage != null;
  if (!hasSnake && !hasCamel) {
    return null;
  }
  return {
    billingCycleStart: obj.billingCycleStart ?? obj.billing_cycle_start,
    billingCycleEnd: obj.billingCycleEnd ?? obj.billing_cycle_end,
    planUsage: obj.planUsage ?? obj.plan_usage,
    spendLimit: obj.spendLimitUsage ?? obj.spend_limit_usage,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
export function extractTokenInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const usage =
    obj.metadata?.token_usage ??
    obj.metadata?.tokenUsage ??
    obj.token_usage ??
    obj.tokenUsage ??
    obj.usage;
  if (!usage) {
    return null;
  }
  return {
    modelName: obj.metadata?.model_name ?? obj.metadata?.modelName ?? obj.model_name,
    ...usage,
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} obj
 */
export function extractContextInsight(obj) {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const messages = obj.conversation_messages ?? obj.conversationMessages;
  if (Array.isArray(messages) && messages.length > 0) {
    return { messageCount: messages.length };
  }
  return null;
}
