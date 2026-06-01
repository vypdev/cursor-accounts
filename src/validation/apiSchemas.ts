import { z } from 'zod';

const planUsageRawSchema = z
  .object({
    totalSpend: z.number().optional(),
    includedSpend: z.number().optional(),
    bonusSpend: z.number().optional(),
    remaining: z.number().optional(),
    limit: z.number().optional(),
    autoPercentUsed: z.number().optional(),
    apiPercentUsed: z.number().optional(),
    totalPercentUsed: z.number().optional(),
  })
  .passthrough();

const spendLimitUsageRawSchema = z
  .object({
    totalSpend: z.number().optional(),
    pooledLimit: z.number().optional(),
    pooledUsed: z.number().optional(),
    pooledRemaining: z.number().optional(),
    individualLimit: z.number().optional(),
    individualUsed: z.number().optional(),
    individualRemaining: z.number().optional(),
    limitType: z.enum(['user', 'team']).optional(),
  })
  .passthrough();

export const getCurrentPeriodUsageResponseSchema = z
  .object({
    billingCycleStart: z.string().optional(),
    billingCycleEnd: z.string().optional(),
    planUsage: planUsageRawSchema.optional(),
    spendLimitUsage: spendLimitUsageRawSchema.optional(),
    displayMessage: z.string().optional(),
    autoModelSelectedDisplayMessage: z.string().optional(),
    namedModelSelectedDisplayMessage: z.string().optional(),
  })
  .passthrough();

export const oauthTokenResponseSchema = z
  .object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .passthrough();

export const profileExportSchema = z.object({
  version: z.string(),
  exportedAt: z.string(),
  exportedBy: z.string().optional(),
  profiles: z.array(
    z
      .object({
        email: z.string(),
        displayName: z.string(),
        theme: z.string().optional(),
        color: z.string().optional(),
        emoji: z.string().optional(),
        settings: z.record(z.unknown()).optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .passthrough()
  ),
});

export function parseJsonWithSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: string
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
}
