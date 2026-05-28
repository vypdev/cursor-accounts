import { decodeJwtPayload } from '../auth/tokenReader';
import { CursorAccountInfo } from './types';

const AUTH_ME_ENDPOINT = 'https://cursor.com/api/auth/me';

export class UserApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = 'UserApiError';
  }
}

/** Build WorkOS session cookie required by cursor.com web endpoints. */
export function buildWorkosSessionCookie(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const sub = payload?.sub;
  if (typeof sub !== 'string' || !sub) {
    throw new UserApiError('Access token missing sub claim');
  }

  const userId = sub.includes('|') ? sub.split('|').pop()! : sub;
  return `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`;
}

export function mapAccountInfoResponse(
  response: CursorAccountInfo
): Pick<CursorAccountInfo, 'name' | 'picture' | 'email'> {
  return {
    name: response.name,
    picture: response.picture,
    email: response.email,
  };
}

export async function fetchCurrentUser(
  accessToken: string,
  signal?: AbortSignal
): Promise<CursorAccountInfo> {
  const cookie = buildWorkosSessionCookie(accessToken);

  const response = await fetch(AUTH_ME_ENDPOINT, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new UserApiError(
      text || `Auth me API returned ${response.status}`,
      response.status
    );
  }

  return (await response.json()) as CursorAccountInfo;
}
