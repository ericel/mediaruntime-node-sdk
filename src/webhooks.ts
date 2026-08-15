import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type {
  ExpressNextFunction,
  ExpressRequestLike,
  ExpressResponseLike,
  ExpressWebhookHandler,
  HeaderValue,
  VerifyWebhookOptions,
  WebhookEvent,
  WebhookHeaders,
  WebhookPayload,
} from "./types.js";

function headerValue(headers: WebhookHeaders, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== expected) continue;
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return "";
}

function bodyBuffer(rawBody: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  throw new WebhookVerificationError(
    "invalid_body",
    "Webhook body must be the original Buffer, Uint8Array, or UTF-8 string",
  );
}

function signatureParts(value: string): { timestamp: string; signatures: string[] } {
  let timestamp = "";
  const signatures: string[] = [];
  for (const rawPart of value.split(",")) {
    const part = rawPart.trim();
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (key === "t" && !timestamp) timestamp = item;
    if (key === "v1" && item) signatures.push(item);
  }
  return { timestamp, signatures };
}

function eventType(status: string): WebhookEvent["type"] {
  return `job.${status.toLowerCase()}` as WebhookEvent["type"];
}

export class WebhooksClient {
  readonly #defaultSecret?: string;

  constructor(defaultSecret?: string) {
    this.#defaultSecret = defaultSecret?.trim() || undefined;
  }

  verify<TPayload extends WebhookPayload = WebhookPayload>(
    rawBody: Buffer | Uint8Array | string,
    headers: WebhookHeaders,
    options: VerifyWebhookOptions = {},
  ): WebhookEvent<TPayload> {
    const secret = options.secret?.trim() || this.#defaultSecret;
    if (!secret) {
      throw new WebhookVerificationError(
        "missing_secret",
        "A MediaRuntime webhook secret is required for verification",
      );
    }

    const eventId = headerValue(headers, "X-Transcoder-Id").trim();
    const timestampHeader = headerValue(headers, "X-Transcoder-Timestamp").trim();
    const signatureHeader = headerValue(headers, "X-Transcoder-Signature").trim();
    if (!eventId || !timestampHeader || !signatureHeader) {
      throw new WebhookVerificationError(
        "missing_headers",
        "Missing one or more X-Transcoder webhook headers",
      );
    }

    const timestamp = Number(timestampHeader);
    if (!/^\d+$/.test(timestampHeader) || !Number.isSafeInteger(timestamp)) {
      throw new WebhookVerificationError(
        "malformed_timestamp",
        "Webhook timestamp must be an integer Unix timestamp",
      );
    }

    const parts = signatureParts(signatureHeader);
    if (!parts.timestamp || parts.signatures.length === 0) {
      throw new WebhookVerificationError(
        "malformed_signature",
        "Webhook signature must contain t=<timestamp> and v1=<hex digest>",
      );
    }
    if (parts.timestamp !== timestampHeader) {
      throw new WebhookVerificationError(
        "timestamp_mismatch",
        "Webhook signature timestamp does not match X-Transcoder-Timestamp",
      );
    }

    const toleranceSeconds = options.toleranceSeconds ?? 300;
    const now = options.now ?? Date.now() / 1000;
    if (toleranceSeconds < 0 || Math.abs(now - timestamp) > toleranceSeconds) {
      throw new WebhookVerificationError(
        "timestamp_outside_tolerance",
        "Webhook timestamp is outside the allowed tolerance",
      );
    }

    const body = bodyBuffer(rawBody);
    const expected = createHmac("sha256", secret)
      .update(`${timestampHeader}.${eventId}.`, "utf8")
      .update(body)
      .digest();
    const valid = parts.signatures.some((signature) => {
      if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
      const received = Buffer.from(signature, "hex");
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
    if (!valid) {
      throw new WebhookVerificationError(
        "invalid_signature",
        "Webhook signature verification failed",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8")) as unknown;
    } catch (error) {
      throw new WebhookVerificationError(
        "invalid_json",
        "Verified webhook body is not valid JSON",
        { cause: error },
      );
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new WebhookVerificationError(
        "invalid_json",
        "Verified webhook JSON must be an object",
      );
    }

    const data = payload as TPayload;
    const status = String(data.status ?? "UNKNOWN").toUpperCase();
    return {
      id: eventId,
      jobId: String(data.job_id ?? ""),
      accountId: typeof data.account_id === "string" ? data.account_id : null,
      status,
      type: eventType(status),
      data,
      rawBody: body,
    };
  }

  express<TPayload extends WebhookPayload = WebhookPayload>(
    handler: ExpressWebhookHandler<TPayload>,
    options: VerifyWebhookOptions = {},
  ): (
    request: ExpressRequestLike,
    response: ExpressResponseLike,
    next?: ExpressNextFunction,
  ) => Promise<void> {
    return async (request, response, next) => {
      if (!Buffer.isBuffer(request.body) && !(request.body instanceof Uint8Array)) {
        response.sendStatus(401);
        return;
      }
      try {
        const event = this.verify<TPayload>(request.body, request.headers, options);
        await handler(event, request, response);
      } catch (error) {
        if (error instanceof WebhookVerificationError) {
          response.sendStatus(401);
          return;
        }
        if (next) next(error);
        else throw error;
      }
    };
  }
}

export function webhookHeadersFromNode(
  headers: Record<string, HeaderValue>,
): Record<string, HeaderValue> {
  return headers;
}
