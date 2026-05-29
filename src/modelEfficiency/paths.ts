export function getEfficiencyApiKeySecretKey(profileId: string): string {
  return `cursorAccounts.efficiency.apiKey.${profileId}`;
}
