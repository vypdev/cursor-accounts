import { decodeJwtPayload } from './tokenReader';

export class SessionCookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionCookieError';
  }
}

/** Build WorkOS session cookie required by cursor.com web endpoints. */
export function buildWorkosSessionCookie(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const sub = payload?.sub;
  if (typeof sub !== 'string' || !sub) {
    throw new SessionCookieError('Access token missing sub claim');
  }

  const userId = sub.includes('|') ? sub.split('|').pop()! : sub;
  return `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`;
}
