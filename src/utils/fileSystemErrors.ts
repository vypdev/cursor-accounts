/** Known Node.js filesystem error codes used by storage operations. */
export type FileSystemErrorCode = 'ENOENT' | 'EACCES' | 'EPERM' | 'EBUSY';

/** Returns the errno code when present on an unknown error value. */
export function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

/** True when the error indicates a missing path (ENOENT). */
export function isNotFoundError(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT';
}

/** True when the error indicates permission denied (EACCES/EPERM). */
export function isPermissionError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 'EACCES' || code === 'EPERM';
}

/** True when the error indicates a file is locked (EBUSY). */
export function isBusyError(error: unknown): boolean {
  return getErrorCode(error) === 'EBUSY';
}

/**
 * Re-throw permission and busy errors with actionable context;
 * swallow ENOENT and return the fallback value.
 */
export function handleFileSystemError<T>(
  error: unknown,
  fallback: T,
  context: string
): T {
  if (isNotFoundError(error)) {
    return fallback;
  }
  if (isPermissionError(error)) {
    throw new Error(
      `${context}: permission denied. Close all Cursor windows for this profile and try again.`
    );
  }
  if (isBusyError(error)) {
    throw new Error(
      `${context}: file is in use. Close all Cursor windows for this profile and try again.`
    );
  }
  throw error;
}
