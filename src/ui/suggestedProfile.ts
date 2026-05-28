import { Profile, ToWebviewMessage } from '../profiles/types';

export function generateDisplayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  return localPart
    .replace(/[._]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

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
      notice: `La cuenta ${detectedEmail} ya está configurada. Introduce el email y nombre de la nueva cuenta.`,
    };
  }

  return {
    type: 'suggestedProfile',
    email: detectedEmail,
    displayName: generateDisplayNameFromEmail(detectedEmail),
  };
}
