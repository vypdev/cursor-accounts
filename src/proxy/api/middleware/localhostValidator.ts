import type { NextFunction, Request, Response } from 'express';

const LOCALHOST_IPV4 = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const LOCALHOST_IPV6 = '::1';

function normalizeRemoteAddress(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
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
