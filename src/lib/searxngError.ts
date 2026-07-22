export class SearxngUnavailableError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SearxngUnavailableError';
    this.cause = cause;
  }
}
