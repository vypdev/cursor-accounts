import type { NextFunction, Request, Response } from 'express';

export interface ApiErrorResponse {
  error: string;
}

/** Express error middleware for the proxy API server. */
export function apiErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message } satisfies ApiErrorResponse);
}
