import {
  AuthenticationError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  MediaRuntimeApiError,
  MediaRuntimeConnectionError,
  MediaRuntimeTimeoutError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  ValidationError,
} from "./errors.js";
import type { FetchImplementation } from "./types.js";

type RetryMode = "safe" | "idempotent-submit" | "never";

export interface TransportOptions {
  apiKey?: string;
  bearerToken?: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: FetchImplementation;
}

export interface TransportRequest {
  // Include the full mutation set used by collection lifecycle endpoints.
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  authenticated?: boolean;
  retry?: RetryMode;
  signal?: AbortSignal;
  operation?: "create-job" | string;
}

function normalizeApiBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new TypeError("MediaRuntime baseUrl must not be empty");
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("MediaRuntime baseUrl must use http or https");
  }
  // Accept a caller-supplied /v1 suffix while keeping internal endpoint construction canonical.
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function normalizedError(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object") return undefined;
  const error = (details as Record<string, unknown>).error;
  return error && typeof error === "object" ? error as Record<string, unknown> : undefined;
}


function structuredDetail(details: unknown): Record<string, unknown> | undefined {
  // FastAPI may place an application error object directly under `detail` rather
  // than the gateway's canonical `error` envelope.
  if (!details || typeof details !== "object") return undefined;
  const detail = (details as Record<string, unknown>).detail;
  return detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : undefined;
}

function errorMessage(details: unknown, status: number): string {
  // Normalize canonical envelopes and common framework validation shapes for consumers.
  if (typeof details === "string" && details) return details;
  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;
    const error = normalizedError(details);
    const detail = structuredDetail(details);
    if (typeof error?.message === "string") return error.message;
    if (typeof detail?.message === "string") return detail.message;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return record.msg;
    if (Array.isArray(record.detail)) {
      const messages = record.detail
        .map((item) =>
          item && typeof item === "object" && typeof (item as Record<string, unknown>).msg === "string"
            ? String((item as Record<string, unknown>).msg)
            : "",
        )
        .filter(Boolean);
      if (messages.length) return messages.join("; ");
    }
  }
  return `MediaRuntime API request failed with status ${status}`;
}

function errorField(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const normalized = normalizedError(details);
  const detail = normalized && "details" in normalized
    ? normalized.details
    : (details as Record<string, unknown>).detail;
  if (!Array.isArray(detail) || detail.length === 0) return undefined;
  const first = detail[0];
  if (!first || typeof first !== "object") return undefined;
  const loc = (first as Record<string, unknown>).loc;
  return Array.isArray(loc) && loc.length ? String(loc[loc.length - 1]) : undefined;
}

async function responseDetails(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function apiError(
  response: Response,
  details: unknown,
  request: TransportRequest,
): MediaRuntimeApiError {
  const message = errorMessage(details, response.status);
  const normalized = normalizedError(details);
  const detail = structuredDetail(details);
  const code = typeof normalized?.code === "string"
    ? normalized.code
    : typeof detail?.code === "string"
    ? detail.code
    : "api_error";
  const normalizedDetails = normalized && "details" in normalized
    ? normalized.details
    : detail ?? details;
  const requestId = (
    typeof normalized?.request_id === "string" ? normalized.request_id : undefined
  ) ?? response.headers.get("X-Request-Id") ?? undefined;
  const options = {
    status: response.status,
    code,
    retryable: typeof normalized?.retryable === "boolean" ? normalized.retryable : false,
    requestId,
    details: normalizedDetails,
    responseBody: details,
    field: errorField(details),
    headers: response.headers,
  };
  if (response.status === 401) return new AuthenticationError(message, options);
  if (response.status === 403) return new PermissionDeniedError(message, options);
  if (response.status === 404) return new NotFoundError(message, options);
  if (response.status === 429) return new RateLimitError(message, options);
  if (
    code === "idempotency_in_progress" || (
      response.status === 409 &&
      request.operation === "create-job" &&
      request.headers?.["Idempotency-Key"] &&
      message.toLowerCase().includes("idempotency-key") &&
      message.toLowerCase().includes("progress")
    )
  ) {
    return new IdempotencyInProgressError(message, options);
  }
  if (
    code === "idempotency_conflict" || (
      response.status === 422 &&
      request.operation === "create-job" &&
      message.toLowerCase().includes("idempotency-key") &&
      message.toLowerCase().includes("different")
    )
  ) {
    return new IdempotencyConflictError(message, options);
  }
  if (response.status === 400 || response.status === 413 || response.status === 422) {
    return new ValidationError(message, options);
  }
  return new MediaRuntimeApiError(message, options);
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function backoffMs(attempt: number): number {
  const base = Math.min(5_000, 250 * 2 ** attempt);
  return Math.floor(base * (0.75 + Math.random() * 0.5));
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function attemptSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  // Compose the caller's cancellation with a fresh timeout for each retry attempt.
  const controller = new AbortController();
  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
    timedOut: () => timeoutTriggered,
  };
}

function canRetry(request: TransportRequest): boolean {
  return request.retry === "safe" || request.retry === "idempotent-submit";
}

export class Transport {
  readonly #apiKey?: string;
  readonly #bearerToken?: string;
  readonly #apiBase: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: FetchImplementation;

  constructor(options: TransportOptions) {
    this.#apiKey = options.apiKey?.trim() || undefined;
    this.#bearerToken = options.bearerToken?.trim() || undefined;
    if (this.#apiKey && this.#bearerToken) {
      // Sending both credentials creates ambiguous server authorization and risks
      // accidentally exposing the master key from a client-token integration.
      throw new TypeError("Use either a MediaRuntime API key or bearer token, not both");
    }
    this.#apiBase = normalizeApiBase(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#maxRetries = options.maxRetries;
    this.#fetch = options.fetch;
  }

  get fetch(): FetchImplementation {
    return this.#fetch;
  }

  async request<T>(request: TransportRequest): Promise<T> {
    const authenticated = request.authenticated !== false;
    if (authenticated && !this.#apiKey && !this.#bearerToken) {
      throw new AuthenticationError("A MediaRuntime API key or bearer token is required for this operation", {
        status: 401,
        code: "authentication_error",
      });
    }

    const url = new URL(`${this.#apiBase}${request.path.startsWith("/") ? request.path : `/${request.path}`}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const headers = new Headers(request.headers);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", "mediaruntime-node/0.1.0");
    if (authenticated && this.#apiKey) headers.set("X-API-Key", this.#apiKey);
    if (authenticated && this.#bearerToken) {
      // Scoped Sticker Runtime clients use the standard bearer header and never
      // receive or synthesize an X-API-Key value.
      headers.set("Authorization", `Bearer ${this.#bearerToken}`);
    }
    let body: string | undefined;
    if (request.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(request.body);
    }

    // Call sites declare retry safety explicitly; it is never inferred from the HTTP verb.
    const retryable = canRetry(request);
    const attempts = retryable ? this.#maxRetries + 1 : 1;
    let lastConnectionError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const attemptAbort = attemptSignal(request.signal, this.#timeoutMs);
      try {
        const response = await this.#fetch(url, {
          method: request.method,
          headers,
          body,
          signal: attemptAbort.signal,
          // Authenticated data-plane routes are not expected to redirect. Refusing a
          // redirect prevents a custom X-API-Key from ever following to another origin.
          redirect: "error",
        });

        if (response.ok) {
          if (response.status === 204) return undefined as T;
          const text = await response.text();
          return (text ? JSON.parse(text) : undefined) as T;
        }

        const details = await responseDetails(response);
        const error = apiError(response, details, request);
        const shouldRetryResponse = response.status === 429 ||
          response.status >= 500 ||
          (response.status === 409 && error instanceof IdempotencyInProgressError);
        if (retryable && shouldRetryResponse && attempt + 1 < attempts) {
          // Respect server backpressure before falling back to jittered exponential delay.
          const delay = retryAfterMs(response) ?? backoffMs(attempt);
          await sleep(delay, request.signal);
          continue;
        }

        throw error;
      } catch (error) {
        if (error instanceof MediaRuntimeApiError) throw error;
        if (request.signal?.aborted) throw request.signal.reason ?? error;
        if (attemptAbort.timedOut()) {
          lastConnectionError = new MediaRuntimeTimeoutError(
            `MediaRuntime request timed out after ${this.#timeoutMs}ms`,
            this.#timeoutMs,
            { cause: error },
          );
        } else {
          lastConnectionError = new MediaRuntimeConnectionError(
            "Could not connect to the MediaRuntime API",
            { cause: error },
          );
        }
        if (!retryable || attempt + 1 >= attempts) throw lastConnectionError;
        await sleep(backoffMs(attempt), request.signal);
      } finally {
        attemptAbort.cleanup();
      }
    }

    throw lastConnectionError ?? new MediaRuntimeConnectionError("MediaRuntime request failed");
  }
}
