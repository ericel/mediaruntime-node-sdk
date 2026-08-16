import { JobWaitTimeoutError, ValidationError } from "./errors.js";
import type {
  CreateJobParams,
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
  parseJobPage,
  parseJobReceipt,
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
  if ((params.outputs?.length ?? 0) === 0 && params.moderation?.enabled !== true) {
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
  readonly message: string;

  constructor(data: JobReceiptData, jobs: JobsClient) {
    this.#jobs = jobs;
    this.id = data.id;
    this.status = data.status;
    this.tier = data.tier;
    this.requiredTier = data.requiredTier;
    this.outputs = data.outputs;
    this.message = data.message;
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
      message: this.message,
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
    let resolved: { source?: string; inputs?: ResolvedBatchInput[] };
    if ("source" in params && params.source !== undefined) {
      resolved = { source: await this.#uploads.resolveSource(params.source, params.signal) };
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

    const idempotencyKey = params.idempotencyKey?.trim();
    const value = await this.#transport.request<unknown>({
      method: "POST",
      path: "/jobs",
      body: serializeCreateJob(params, resolved),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      retry: idempotencyKey ? "idempotent-submit" : "never",
      signal: params.signal,
      operation: "create-job",
    });
    return new Job(parseJobReceipt(value), this);
  }

  async get(jobId: string, options: { signal?: AbortSignal } = {}): Promise<JobDetails> {
    const id = jobPathId(jobId);
    const value = await this.#transport.request<unknown>({
      method: "GET",
      path: `/jobs/${id}`,
      retry: "safe",
      signal: options.signal,
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

    const deadline = Date.now() + timeoutMs;
    let nextDelay = initialDelayMs;
    let lastJob: JobDetails | null = null;
    while (true) {
      lastJob = await this.get(jobId, { signal: options.signal });
      if (TERMINAL_STATUSES.has(String(lastJob.status).toUpperCase())) return lastJob;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new JobWaitTimeoutError(timeoutMs, lastJob);
      const jittered = Math.floor(nextDelay * (0.85 + Math.random() * 0.3));
      await delay(Math.min(remaining, jittered), options.signal);
      nextDelay = Math.min(maxDelayMs, Math.max(1, nextDelay * 1.5));
    }
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
    return parseMediaReport(value);
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
