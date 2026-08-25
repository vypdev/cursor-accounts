import type { NextFunction, Request, Response } from 'express';

export interface ApiErrorResponse {
  error: string;
}

export const PUBLIC_API_ERROR_MESSAGE = 'Proxy API request failed';

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

  // Error messages can contain paths, parser input, or dependency details.
  // Keep diagnostics in the trusted child-process stderr path and expose only
  // a stable, text-safe response to local API clients.
  void error;
  res
    .status(500)
    .json({ error: PUBLIC_API_ERROR_MESSAGE } satisfies ApiErrorResponse);
}
