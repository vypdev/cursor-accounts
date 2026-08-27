import * as path from 'path';
import * as extensionLog from '../logging/extensionLog';
import type { IProfileReader } from '../domain/ports/IProfileReader';
import {
  emailToSlug,
  generateUniqueSlug,
  validateSlug,
} from '../utils/emailToSlug';
import { PROFILE_DIR_PREFIX } from './types';

export interface ProfilePathResolution {
  slug: string;
  userDataDir: string;
  collisionSlug?: string;
}

export class ProfilePathResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfilePathResolutionError';
  }
}

/** Resolve a collision-safe profile directory without mutating profile state. */
export async function resolveProfilePath(
  email: string,
  profileRootDir: string,
  profileReader: Pick<IProfileReader, 'findProfileByPath'>
): Promise<ProfilePathResolution> {
  const slug = emailToSlug(email);
  if (!validateSlug(slug)) {
    throw new ProfilePathResolutionError(`Generated slug "${slug}" is invalid`);
  }

  const basePath = path.join(profileRootDir, `${PROFILE_DIR_PREFIX}${slug}`);
  const existingPath = await profileReader.findProfileByPath(basePath);
  if (!existingPath) {
    return { slug, userDataDir: basePath };
  }

  const collisionSlug = generateUniqueSlug(email, true);
  const collisionPath = path.join(
    profileRootDir,
    `${PROFILE_DIR_PREFIX}${collisionSlug}`
  );
  const stillExists = await profileReader.findProfileByPath(collisionPath);
  if (stillExists) {
    throw new ProfilePathResolutionError(
      `Unable to generate unique path for email ${email}. ` +
        `Both ${slug} and ${collisionSlug} already exist.`
    );
  }

  extensionLog.info(
    `[ProfileManager] Path collision resolved: ${slug} → ${collisionSlug}`
  );
  return {
    slug,
    userDataDir: collisionPath,
    collisionSlug,
  };
}
