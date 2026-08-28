import type { JobDetails } from "./types.js";

export interface MediaRuntimeErrorOptions {
  cause?: unknown;
}

export class MediaRuntimeError extends Error {
  override readonly name: string = "MediaRuntimeError";

  constructor(message: string, options?: MediaRuntimeErrorOptions) {
    super(message);
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: options.cause,
        writable: true,
      });
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface ApiErrorOptions {
  status: number;
  code?: string;
  retryable?: boolean;
  requestId?: string;
  details?: unknown;
  responseBody?: unknown;
  field?: string;
  headers?: Headers;
}

export class MediaRuntimeApiError extends MediaRuntimeError {
  override readonly name: string = "MediaRuntimeApiError";
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly details: unknown;
  readonly responseBody: unknown;
  readonly field?: string;
  readonly headers?: Headers;

  constructor(message: string, options: ApiErrorOptions) {
    // Preserve request metadata so callers can log support IDs without parsing messages.
    super(message);
    this.status = options.status;
    this.code = options.code ?? "api_error";
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.details = options.details;
    this.responseBody = options.responseBody;
    this.field = options.field;
    this.headers = options.headers;
  }
}

export class AuthenticationError extends MediaRuntimeApiError {
  override readonly name: string = "AuthenticationError";
}

export class PermissionDeniedError extends MediaRuntimeApiError {
  override readonly name: string = "PermissionDeniedError";
}

export class NotFoundError extends MediaRuntimeApiError {
  override readonly name: string = "NotFoundError";
}

export class RateLimitError extends MediaRuntimeApiError {
  override readonly name: string = "RateLimitError";
}

export class ValidationError extends MediaRuntimeApiError {
  override readonly name: string = "ValidationError";
}

export class IdempotencyInProgressError extends MediaRuntimeApiError {
  override readonly name: string = "IdempotencyInProgressError";
}

export class IdempotencyConflictError extends ValidationError {
  override readonly name: string = "IdempotencyConflictError";
}

export class MediaRuntimeConnectionError extends MediaRuntimeError {
  override readonly name: string = "MediaRuntimeConnectionError";
}

export class MediaRuntimeTimeoutError extends MediaRuntimeConnectionError {
  override readonly name: string = "MediaRuntimeTimeoutError";
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, options?: MediaRuntimeErrorOptions) {
    super(message, options);
    this.timeoutMs = timeoutMs;
  }
}

export class JobWaitTimeoutError extends MediaRuntimeError {
  override readonly name: string = "JobWaitTimeoutError";
  readonly timeoutMs: number;
  readonly lastJob: JobDetails | null;

  constructor(timeoutMs: number, lastJob: JobDetails | null) {
    super(`Job did not reach a terminal state within ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
    this.lastJob = lastJob;
  }
}

export type WebhookVerificationReason =
  | "missing_secret"
  | "missing_headers"
  | "malformed_timestamp"
  | "timestamp_mismatch"
  | "timestamp_outside_tolerance"
  | "malformed_signature"
  | "invalid_signature"
  | "invalid_body"
  | "invalid_json";

export class WebhookVerificationError extends MediaRuntimeError {
  override readonly name: string = "WebhookVerificationError";
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string, options?: MediaRuntimeErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}
