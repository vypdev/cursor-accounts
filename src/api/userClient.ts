import { buildWorkosSessionCookie } from '../auth/sessionCookie';
import { CursorAccountInfo } from './types';

export { buildWorkosSessionCookie };

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
