import { serializeSecurity, parseSecurityReport, parseInspectionQuote, type SecurityOptions, type InspectionQuote, type SecurityReportResult } from "./security.js";
import { randomUUID } from "node:crypto";
import { JobWaitTimeoutError, ValidationError } from "./errors.js";
import { withDeadline } from "./deadline.js";
import type {
  CreateJobParams,
  ClipCandidatesResult,
  CompatibilityReportResult,
  CodeDetectionResult,
  JobDetails,
  JobPage,
  JobReceiptData,
  ListJobsParams,
  MediaReportResult,
  ModerationResult,
  RetryWebhookResult,
  WaitForJobOptions,
} from "./types.js";
import type { Transport } from "./transport.js";
import type { UploadsClient } from "./uploads.js";
import {
  parseJobDetails,
  parseClipCandidates,
  parseJobPage,
  parseJobReceipt,
  parseCompatibilityReport,
  parseCodeDetections,
  parseMediaReport,
  parseModeration,
  parseRetryWebhook,
  serializeCreateJob,
  type ResolvedBatchInput,
} from "./wire.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "REJECTED", "PARTIAL"]);

function jobPathId(jobId: string): string {
  const value = jobId.trim();
  if (!value) {
    throw new ValidationError("jobId must not be empty", { status: 400, field: "jobId" });
  }
  // Treat every caller-provided ID as one path segment, even if it contains delimiters.
  return encodeURIComponent(value);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
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

function validateCreate(params: CreateJobParams): void {
  if (params.security !== undefined) {
    serializeSecurity(params.security);
    if (params.recipe !== undefined || (params.security.enabled && (params.inputs !== undefined || params.moderation !== undefined || params.watermark !== undefined ||
      Boolean(params.outputs?.length) !== (params.security.mode === 'enforce')))) {
      throw new ValidationError('Invalid inspection/processing combination', { status: 400, field: 'security' });
    }
  }
  if (params.deliverWebhook !== undefined && typeof params.deliverWebhook !== "boolean") {
    throw new ValidationError("deliverWebhook must be a boolean", { status: 400, field: "deliverWebhook" });
  }
  const hasSource = "source" in params && params.source !== undefined;
  const hasInputs = "inputs" in params && params.inputs !== undefined;
  if (hasSource === hasInputs) {
    throw new ValidationError("Provide exactly one of source or inputs", {
      status: 400,
      field: "source",
    });
  }
  if (hasInputs && (params.inputs.length < 1 || params.inputs.length > 25)) {
    throw new ValidationError("inputs must contain between 1 and 25 items", {
      status: 400,
      field: "inputs",
    });
  }
  if ((params.outputs?.length ?? 0) > 10) {
    throw new ValidationError("outputs must not contain more than 10 items", {
      status: 400,
      field: "outputs",
    });
  }
  if (params.recipe !== undefined) {
    if (!/^[a-z][a-z0-9-]{2,63}(?:@[1-9][0-9]*)?$/.test(params.recipe)) {
      throw new ValidationError("recipe must be a valid name or name@version", {
        status: 400,
        field: "recipe",
      });
    }
    if ((params.outputs?.length ?? 0) > 0 || params.moderation !== undefined || params.watermark !== undefined) {
      throw new ValidationError("recipe cannot be combined with outputs, moderation, or watermark", {
        status: 400,
        field: "recipe",
      });
    }
  }
  if (params.recipe === undefined && (params.outputs?.length ?? 0) === 0 && params.moderation?.enabled !== true && params.security?.enabled !== true) {
    throw new ValidationError(
      "Provide at least one output, or enable moderation for an analysis-only job",
      { status: 400, field: "outputs" },
    );
  }
  if (params.idempotencyKey !== undefined) {
    const key = params.idempotencyKey.trim();
    if (!key || key.length > 255) {
      throw new ValidationError("idempotencyKey must contain between 1 and 255 characters", {
        status: 400,
        field: "idempotencyKey",
      });
    }
  }
}

export class Job {
  readonly #jobs: JobsClient;
  readonly id: string;
  readonly status: JobReceiptData["status"];
  readonly tier: string;
  readonly requiredTier: string | null;
  readonly outputs: JobReceiptData["outputs"];
  readonly recipe: JobReceiptData["recipe"];
  readonly message: string;
  readonly inspectionQuote?: InspectionQuote;

  constructor(data: JobReceiptData, jobs: JobsClient) {
    this.#jobs = jobs;
    this.id = data.id;
    this.status = data.status;
    this.tier = data.tier;
    this.requiredTier = data.requiredTier;
    this.outputs = data.outputs;
    this.recipe = data.recipe;
    this.message = data.message;
    this.inspectionQuote = data.inspectionQuote;
  }

  refresh(options: { signal?: AbortSignal } = {}): Promise<JobDetails> {
    return this.#jobs.get(this.id, options);
  }

  wait(options: WaitForJobOptions = {}): Promise<JobDetails> {
    return this.#jobs.wait(this.id, options);
  }

  toJSON(): JobReceiptData {
    return {
      id: this.id,
      status: this.status,
      tier: this.tier,
      requiredTier: this.requiredTier,
      outputs: this.outputs,
      recipe: this.recipe,
      message: this.message,
      ...(this.inspectionQuote ? { inspectionQuote: this.inspectionQuote } : {}),
    };
  }
}

export class JobsClient {
  readonly #transport: Transport;
  readonly #uploads: UploadsClient;

  constructor(transport: Transport, uploads: UploadsClient) {
    this.#transport = transport;
    this.#uploads = uploads;
  }

  async create(params: CreateJobParams): Promise<Job> {
    validateCreate(params);
    // This key exists only for the lifetime of this invocation. It makes transport
    // retries safe without pretending to replace a caller's durable business key.
    const idempotencyKey = params.idempotencyKey?.trim() ?? randomUUID();
    let resolved: { source?: string; inputs?: ResolvedBatchInput[] };
    if ("source" in params && params.source !== undefined) {
      // Local files upload transparently; HTTP(S), signed, and gs:// sources pass through.
      resolved = { source: await this.#uploads.resolveSource(params.source, params.signal, params.security?.enabled) };
    } else {
      const inputs: ResolvedBatchInput[] = [];
      for (const input of params.inputs) {
        inputs.push({
          source: await this.#uploads.resolveSource(input.source, params.signal),
          ...(input.inputId !== undefined ? { inputId: input.inputId } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        });
      }
      resolved = { inputs };
    }

    const value = await this.#transport.request<unknown>({
      method: "POST",
      path: "/jobs",
      body: serializeCreateJob(params, resolved),
      headers: { "Idempotency-Key": idempotencyKey },
      retry: "idempotent-submit",
      signal: params.signal,
      operation: "create-job",
    });
    return new Job(parseJobReceipt(value), this);
  }

  async get(jobId: string, options: { signal?: AbortSignal } = {}): Promise<JobDetails> {
    return this.#get(jobId, options);
  }

  async #get(
    jobId: string,
    options: { signal?: AbortSignal; checkActive?: () => void },
  ): Promise<JobDetails> {
    const id = jobPathId(jobId);
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${id}`,
      retry: "safe",
      signal: options.signal,
      checkActive: options.checkActive,
    });
    return parseJobDetails(value);
  }

  async list(params: ListJobsParams = {}): Promise<JobPage> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: "/jobs",
      query: { status: params.status, limit: params.limit, cursor: params.cursor },
      retry: "safe",
      signal: params.signal,
    });
    return parseJobPage(value);
  }

  async wait(jobId: string, options: WaitForJobOptions = {}): Promise<JobDetails> {
    const timeoutMs = options.timeoutMs ?? 300_000;
    const initialDelayMs = options.initialDelayMs ?? 1_000;
    const maxDelayMs = options.maxDelayMs ?? 10_000;
    if (timeoutMs <= 0 || initialDelayMs < 0 || maxDelayMs < 0) {
      throw new TypeError("wait timing options must be non-negative and timeoutMs must be positive");
    }

    let lastJob: JobDetails | null = null;
    return withDeadline(timeoutMs, options.signal, () => new JobWaitTimeoutError(timeoutMs, lastJob),
      async (signal, checkActive) => {
        let nextDelay = initialDelayMs;
        while (true) {
          checkActive();
          const job = await this.#get(jobId, { signal, checkActive });
          // A late result must neither complete the wait nor replace its last
          // successfully decoded, pre-deadline snapshot.
          checkActive();
          lastJob = job;
          if (TERMINAL_STATUSES.has(String(job.status).toUpperCase())) return job;
          const jittered = Math.floor(nextDelay * (0.85 + Math.random() * 0.3));
          await delay(jittered, signal);
          nextDelay = Math.min(maxDelayMs, Math.max(1, nextDelay * 1.5));
        }
      });
  }

  async estimateSecurity(options: SecurityOptions, request: { signal?: AbortSignal } = {}): Promise<InspectionQuote> {
    return parseInspectionQuote(await this.#transport.request<unknown>({ method: 'POST', path: '/security/estimate',
      body: serializeSecurity(options), signal: request.signal, retry: 'safe' }));
  }

  async getSecurityReport(jobId: string, options: { signal?: AbortSignal } = {}): Promise<SecurityReportResult> {
    return parseSecurityReport(await this.#transport.request<unknown>({ method: 'GET', path: `/jobs/${jobPathId(jobId)}/security-report`,
      signal: options.signal, retry: 'safe' }));
  }

  async cancelSecurityInspection(jobId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    await this.#transport.request({ method: 'POST', path: `/jobs/${jobPathId(jobId)}/security-cancel`, signal: options.signal, retry: 'safe' });
  }

  async getSecurityDerivative(jobId: string, options: { signal?: AbortSignal } = {}): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const value = await this.#transport.request<{ download_url: string; expires_in_seconds: number }>({ method: 'GET', path: `/jobs/${jobPathId(jobId)}/security-derivative`, signal: options.signal, retry: 'safe' });
    const url = typeof value.download_url === 'string' ? URL.parse(value.download_url) : null;
    if (!url || url.protocol !== 'https:' || url.username || url.password || !Number.isSafeInteger(value.expires_in_seconds) || value.expires_in_seconds < 1 || value.expires_in_seconds > 300) {
      throw new ValidationError('Invalid derivative response', { status: 502, field: 'security' });
    }
    return { downloadUrl: value.download_url, expiresInSeconds: value.expires_in_seconds };
  }

  async getModeration(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ModerationResult> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${jobPathId(jobId)}/moderation`,
      retry: "safe",
      signal: options.signal,
    });
    return parseModeration(value);
  }

  async getMediaReport(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<MediaReportResult> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${jobPathId(jobId)}/media-report`,
      retry: "safe",
      signal: options.signal,
    });
    // The parsed report is durable; any returned download URL is signed and time-limited.
    return parseMediaReport(value);
  }

  async getCompatibilityReport(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<CompatibilityReportResult> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${jobPathId(jobId)}/compatibility-report`,
      retry: "safe",
      signal: options.signal,
    });
    return parseCompatibilityReport(value);
  }

  async getClipCandidates(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ClipCandidatesResult> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${jobPathId(jobId)}/clip-candidates`,
      retry: "safe",
      signal: options.signal,
    });
    return parseClipCandidates(value);
  }

  async getCodeDetections(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<CodeDetectionResult> {
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${jobPathId(jobId)}/codes`,
      retry: "safe",
      signal: options.signal,
    });
    return parseCodeDetections(value);
  }

  async retryWebhook(
    jobId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<RetryWebhookResult> {
    const value = await this.#transport.request<unknown>({
      method: "POST",
      path: `/jobs/${jobPathId(jobId)}/retry-webhook`,
      retry: "never",
      signal: options.signal,
    });
    return parseRetryWebhook(value);
  }
}
