export function formatProxyCertificateError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
