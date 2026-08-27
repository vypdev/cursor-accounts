import type { CreateProfileOptions, Profile } from '@cursor-accounts/types';

export interface ProfileCreationValues {
  id: string;
  created: string;
  color: string;
  slug: string;
  displayName: string;
}

/** Build a profile record from validated options and generated values. */
export function buildProfileRecord(
  options: CreateProfileOptions,
  userDataDir: string,
  values: ProfileCreationValues
): Profile {
  return {
    id: values.id,
    email: options.email,
    slug: values.slug,
    displayName: values.displayName,
    userDataDir,
    created: values.created,
    color: options.color ?? values.color,
    proxyEnabled: true,
    metadata: {
      source: 'manual',
      notes: options.notes,
      tags: options.tags,
    },
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.emoji === undefined ? {} : { emoji: options.emoji }),
  };
}
