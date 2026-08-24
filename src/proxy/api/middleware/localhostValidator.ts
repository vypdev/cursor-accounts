import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

const LOCALHOST_IPV4 = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const LOCALHOST_IPV6 = '::1';

function normalizeRemoteAddress(req: Request): string | undefined {
  // The API binds to loopback. Forwarding headers are client-controlled and
  // must never be used to grant access to a non-local connection.
  return req.socket.remoteAddress ?? undefined;
}

/** Reject non-localhost callers. The proxy API must never be exposed beyond loopback. */
export function localhostOnly(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const remote = normalizeRemoteAddress(req);
  if (
    remote == null ||
    (!LOCALHOST_IPV4.has(remote) && remote !== LOCALHOST_IPV6)
  ) {
    res.status(403).json({ error: 'Forbidden: localhost only' });
    return;
  }
  next();
}

export function isValidApiToken(
  authorizationHeader: string | undefined,
  expectedToken: string | undefined
): boolean {
  if (!expectedToken) {
    return true;
  }
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return false;
  }
  const received = Buffer.from(authorizationHeader.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Require the per-process capability token when the proxy was configured with one. */
export function apiTokenRequired(expectedToken?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isValidApiToken(req.header('authorization'), expectedToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
