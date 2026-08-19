export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Metadata = Record<string, JsonValue>;

export type OutputType = "mp4" | "webm" | "hls" | "dash" | "audio" | "image" | "social" | "gif" | "frames";
export type OutputAlias =
  | "video.web"
  | "video.streaming"
  | "video.social"
  | "audio.web"
  | "audio.transcription"
  | "image.web";
export type ImageFormat = "jpg" | "png" | "webp" | "avif";
export type SubtitleFormat = "srt" | "vtt" | "both";
export type ModerationMode = "report" | "block";
export type ModerationCheck = "sexual" | "violence" | "dangerous";
export type WatermarkPosition =
  | "bottom_right"
  | "bottom_left"
  | "top_right"
  | "top_left"
  | "center";

export type KnownJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED"
  | "PARTIAL";

export type JobStatus = KnownJobStatus | (string & {});
export type Source = string | URL;

export interface VideoOptions {
  codec?: string;
  height?: number;
  bitrateBps?: number;
  preset?: string;
  fps?: number;
  twoPass?: boolean;
}

export interface AudioOptions {
  codec?: string;
  bitrateBps?: number;
  channels?: number;
}

export interface ThumbnailOptions {
  enabled?: boolean;
  format?: ImageFormat;
  intervalSec?: number;
  tileWidth?: number;
  tileHeight?: number;
  cols?: number;
  rows?: number;
  maxSheets?: number;
}

export interface SubtitleOptions {
  enabled?: boolean;
  format?: SubtitleFormat;
  languages?: string[];
  model?: string;
  translateToEnglish?: boolean;
  maxAudioMinutes?: number;
}

export interface GifPreviewOptions {
  enabled?: boolean;
  width?: number;
  fps?: number;
  startTime?: number;
  duration?: number;
}

export interface ImageRendition {
  width: number;
  height: number;
  mode?: string;
  format: ImageFormat;
  quality?: number;
}

export interface JobOutput {
  type: OutputType;
  preset?: string;
  pathSuffix?: string;
  removeBg?: boolean;
  smartCrop?: boolean;
  video?: VideoOptions;
  audio?: AudioOptions;
  thumbnails?: ThumbnailOptions;
  subtitles?: SubtitleOptions;
  gifPreview?: GifPreviewOptions;
  images?: ImageRendition[];
  posterTimeSec?: number;
  posterFormat?: ImageFormat;
}

export interface ModerationOptions {
  enabled?: boolean;
  mode?: ModerationMode;
  checks?: ModerationCheck[];
}

export interface WatermarkOptions {
  enabled?: boolean;
}

export interface RecipeAcknowledgement {
  name: string;
  version: number;
  reference: string;
  builtIn: boolean;
  sha256: string;
  requestedReference?: string;
}

export interface RecipeTemplate {
  outputs?: Array<JobOutput | OutputAlias>;
  moderation?: ModerationOptions;
  watermark?: WatermarkOptions;
}

export interface HostedRecipe extends RecipeAcknowledgement {
  description: string;
  status: "active" | "archived" | (string & {});
  template?: RecipeTemplate;
}

export interface CreateRecipeParams {
  name: string;
  description?: string;
  template: RecipeTemplate;
  signal?: AbortSignal;
}

export interface CreateRecipeVersionParams {
  expectedLatestVersion: number;
  description?: string;
  template: RecipeTemplate;
  signal?: AbortSignal;
}

interface CreateJobCommon {
  /** Frozen gateway aliases and explicit output recipes may be mixed in one job. */
  outputs?: Array<JobOutput | OutputAlias>;
  webhookUrl?: string;
  metadata?: Metadata;
  moderation?: ModerationOptions;
  watermark?: WatermarkOptions;
  /** Hosted processing policy, optionally pinned as name@version. */
  recipe?: string;
  /** Caller-controlled durable key. When omitted, the SDK generates one for this invocation. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface BatchInput {
  source: Source;
  inputId?: string;
  metadata?: Metadata;
}

export type CreateJobParams = CreateJobCommon &
  (
    | {
        source: Source;
        inputs?: never;
      }
    | {
        source?: never;
        inputs: BatchInput[];
      }
  );

export interface JobReceiptData {
  id: string;
  status: JobStatus;
  tier: string;
  requiredTier: string | null;
  outputs: Array<{
    alias: string | null;
    type: OutputType;
    preset: string;
  }>;
  recipe: RecipeAcknowledgement | null;
  message: string;
}

export interface JobTier {
  requested: string | null;
  required: string | null;
  effective: string | null;
  billed: string | null;
  reasons: string[];
}

export interface JobUsage {
  unitsTotal: number | null;
}

export interface JobBilling {
  status: string | null;
  currency: string | null;
  unitPriceCents: number | null;
  finalUnits: number | null;
  finalAmountCents: number | null;
  estimatedUnits: number | null;
  estimatedAmountCents: number | null;
}

export interface JobBundle {
  available: boolean;
  downloadUrl: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  retentionDays: number | null;
}

export interface JobMediaVideo {
  codec: string | null;
  profile: string | null;
  width: number | null;
  height: number | null;
  encodedWidth: number | null;
  encodedHeight: number | null;
  fps: number | null;
  bitRate: number | null;
  rotationDeg: number | null;
  isRotated: boolean | null;
  displayAspectRatio: string | null;
  orientation: string | null;
}

export interface JobMediaAudio {
  codec: string | null;
  profile: string | null;
  sampleRateHz: number | null;
  channels: number | null;
  bitRate: number | null;
  layout: string | null;
}

export interface JobMedia {
  format: string | null;
  durationSec: number | null;
  bitRate: number | null;
  video: JobMediaVideo | null;
  audio: JobMediaAudio | null;
  streams: {
    video: number;
    audio: number;
    other: number;
  };
}

export interface JobDetails {
  id: string;
  status: JobStatus;
  tier: JobTier;
  usage: JobUsage;
  billing: JobBilling;
  bundle: JobBundle;
  media: JobMedia | null;
  metadata: Metadata;
  recipe: RecipeAcknowledgement | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  tierBilled: string | null;
  unitsTotal: number | null;
  amountCents: number | null;
  currency: string | null;
  bundleAvailable: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface JobPage {
  jobs: JobSummary[];
  nextCursor: string | null;
}

export interface ListJobsParams {
  status?: JobStatus;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface WaitForJobOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export interface ModerationResult {
  verdict: string | null;
  mode: string | null;
  mediaType: string | null;
  requestedChecks: string[];
  flaggedChecks: string[];
  reviewOnlyChecks: string[];
  checks: Array<{
    check: string;
    decision: string | null;
    confidence: number | null;
    reviewOnly: boolean | null;
  }>;
  judge: {
    escalated: boolean | null;
    escalatedChecks: string[];
    likelihoods: Record<string, string>;
    ok: boolean | null;
    error: string | null;
  } | null;
  ok: boolean | null;
  error: string | null;
}

export interface MediaReportResult {
  jobId: string;
  report: Record<string, unknown> | null;
  downloadUrl: string | null;
  note: string | null;
}

export interface RetryWebhookResult {
  status: string;
  message: string;
  attempts: number;
  httpStatus: number | null;
}

export interface UploadTarget {
  uploadUrl: string;
  fileUri: string;
  uploadHeaders: Record<string, string>;
}

export interface UploadFileResult extends UploadTarget {
  filename: string;
  contentType: string;
}

export interface WatermarkLogoConfirmParams {
  fileUri: string;
  position?: WatermarkPosition;
  opacityPct?: number;
  scalePct?: number;
  signal?: AbortSignal;
}

export interface WatermarkLogoUploadOptions {
  position?: WatermarkPosition;
  opacityPct?: number;
  scalePct?: number;
  signal?: AbortSignal;
}

export interface WatermarkLogo {
  logoUrl: string;
  position: WatermarkPosition;
  opacityPct: number;
  scalePct: number;
}

export interface Capabilities {
  capabilities: Record<string, string>;
  outputTypes: Record<string, string[]>;
  presetOverrides: Record<string, string[]>;
  /** Ordered preset IDs that the gateway intentionally exposes to API consumers. */
  publicPresets: string[];
  presets: Record<
    string,
    {
      outputType: OutputType;
      sourceKinds: string[];
      baseTier: "standard" | "premium";
      description: string;
      artifacts: string[];
      codec?: string;
      container?: string;
      parameterized?: boolean;
      example?: string;
    }
  >;
  features: Record<string, Record<string, unknown>>;
  outputAliases: Record<
    string,
    {
      type: OutputType;
      preset: string;
      tier: "standard" | "premium";
      artifacts: string[];
      output: Record<string, unknown>;
    }
  >;
  notes: string[];
}

export interface WebhookBundleDownload {
  url: string;
  expiresAt?: string;
}

export interface WebhookBundle {
  type: "zip" | (string & {});
  filename: string;
  size_bytes: number;
  sha256?: string;
  download: WebhookBundleDownload;
}

export interface WebhookDelivery {
  mode: "PULL" | "NONE" | (string & {});
  retentionDays?: number;
  expiresAt?: string;
  bundle?: WebhookBundle;
  layout?: string;
  deliverables?: unknown[];
  manifests?: Record<string, unknown>;
}

export interface WebhookJobError {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface WebhookMeta {
  request_metadata?: Metadata;
  bundle?: {
    gs?: string;
    url?: string;
    sha256?: string;
    size_bytes?: number;
  };
  [key: string]: unknown;
}

export interface WebhookPayload {
  event_id?: string;
  job_id?: string;
  account_id?: string;
  status?: JobStatus;
  delivery?: WebhookDelivery;
  error?: WebhookJobError | string;
  meta?: WebhookMeta;
  recipe?: {
    name: string;
    version: number;
    reference: string;
    built_in: boolean;
    sha256: string;
  };
  [key: string]: unknown;
}

export type WebhookEventType =
  | "job.queued"
  | "job.processing"
  | "job.completed"
  | "job.failed"
  | "job.rejected"
  | `job.${string}`;

export interface WebhookEvent<TPayload extends WebhookPayload = WebhookPayload> {
  id: string;
  jobId: string;
  accountId: string | null;
  status: JobStatus;
  type: WebhookEventType;
  data: TPayload;
  rawBody: Buffer;
}

export type HeaderValue = string | string[] | undefined;
export type WebhookHeaders = Headers | Record<string, HeaderValue>;

export interface VerifyWebhookOptions {
  secret?: string;
  toleranceSeconds?: number;
  /** Unix timestamp in seconds, primarily for deterministic tests. */
  now?: number;
}

export interface ExpressRequestLike {
  body?: unknown;
  headers: Record<string, HeaderValue>;
  get?: (name: string) => string | undefined;
}

export interface ExpressResponseLike {
  sendStatus: (status: number) => unknown;
}

export type ExpressNextFunction = (error?: unknown) => void;
export type ExpressWebhookHandler<TPayload extends WebhookPayload = WebhookPayload> = (
  event: WebhookEvent<TPayload>,
  request: ExpressRequestLike,
  response: ExpressResponseLike,
) => void | Promise<void>;

export interface FastifyRequestLike {
  body?: unknown;
  /** Raw bytes supplied by a raw-body plugin; preferred over `body` when present. */
  rawBody?: unknown;
  headers: Record<string, HeaderValue>;
}

export interface FastifyReplyLike {
  code: (statusCode: number) => FastifyReplyLike;
  send: (payload?: unknown) => unknown;
}

export type FastifyWebhookHandler<TPayload extends WebhookPayload = WebhookPayload> = (
  event: WebhookEvent<TPayload>,
  request: FastifyRequestLike,
  reply: FastifyReplyLike,
) => void | Promise<void>;

export type FetchImplementation = typeof globalThis.fetch;

export interface MediaRuntimeOptions {
  apiKey?: string;
  baseUrl?: string;
  webhookSecret?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchImplementation;
}
