import type { Profile, ToWebviewMessage } from '../profiles/types';
import { t } from '../l10n';
import { generateProfileDisplayName } from '../domain/policies/profileDisplayName';

export const generateDisplayNameFromEmail = generateProfileDisplayName;

export function buildSuggestedProfileResponse(
  detectedEmail: string | undefined,
  existingProfile: Profile | undefined
): Extract<ToWebviewMessage, { type: 'suggestedProfile' }> {
  if (!detectedEmail) {
    return {
      type: 'suggestedProfile',
      email: undefined,
      displayName: undefined,
    };
  }

  if (existingProfile) {
    return {
      type: 'suggestedProfile',
      notice: t('suggestedProfile.accountAlreadyConfigured', {
        email: detectedEmail,
      }),
    };
  }

  return {
    type: 'suggestedProfile',
    email: detectedEmail,
    displayName: generateDisplayNameFromEmail(detectedEmail),
  };
}
