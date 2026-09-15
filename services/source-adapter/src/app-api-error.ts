export class AppApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`APP_API_REQUEST_FAILED:${status}:${body.slice(0, 200)}`);
    this.name = "AppApiRequestError";
    this.status = status;
  }
}

export function isAppApiNotFound(error: unknown): boolean {
  return error instanceof AppApiRequestError && error.status === 404;
}
