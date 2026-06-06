/** Thrown when no upstream can be selected for routing. */
export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly sessionKey?: string
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}
