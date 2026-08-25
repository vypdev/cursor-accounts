/** Describes a cleanup operation that removed some data before failing. */
export class PartialCleanupError extends Error {
  constructor(
    message: string,
    readonly bytesReclaimed: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PartialCleanupError';
  }
}
