export class ServiceError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code); }
}
