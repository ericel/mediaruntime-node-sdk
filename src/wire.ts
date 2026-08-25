import type {
  BatchInput,
  AnimationOptions,
  AudiogramOptions,
  ContactSheetOptions,
  PlaceholderOptions,
  PrivacyRedactionOptions,
  Capabilities,
  CreateJobParams,
  GifPreviewOptions,
  ImageRendition,
  JobBilling,
  JobBundle,
  JobDetails,
  JobMedia,
  JobMediaAudio,
  JobMediaVideo,
  OutputAlias,
  JobOutput,
  JobPage,
  JobReceiptData,
  JobStatus,
  JobSummary,
  JobTier,
  JobUsage,
  MediaReportResult,
  CompatibilityReportResult,
  CodeDetectionResult,
  Metadata,
  ModerationResult,
  RecipeAcknowledgement,
  RetryWebhookResult,
  SubtitleOptions,
  ThumbnailOptions,
  VideoOptions,
  AudioOptions,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

export interface ResolvedBatchInput extends Omit<BatchInput, "source"> {
  source: string;
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function setDefined(target: UnknownRecord, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function serializeVideo(value: VideoOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "codec", value.codec);
  setDefined(output, "height", value.height);
  setDefined(output, "bitrate_bps", value.bitrateBps);
  setDefined(output, "preset", value.preset);
  setDefined(output, "fps", value.fps);
  setDefined(output, "two_pass", value.twoPass);
  return output;
}

function serializeAudio(value: AudioOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "codec", value.codec);
  setDefined(output, "bitrate_bps", value.bitrateBps);
  setDefined(output, "channels", value.channels);
  return output;
}

function serializeThumbnails(value: ThumbnailOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "enabled", value.enabled);
  setDefined(output, "format", value.format);
  setDefined(output, "interval_sec", value.intervalSec);
  setDefined(output, "tile_width", value.tileWidth);
  setDefined(output, "tile_height", value.tileHeight);
  setDefined(output, "cols", value.cols);
  setDefined(output, "rows", value.rows);
  setDefined(output, "max_sheets", value.maxSheets);
  return output;
}

function serializeSubtitles(value: SubtitleOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "enabled", value.enabled);
  setDefined(output, "format", value.format);
  setDefined(output, "languages", value.languages);
  setDefined(output, "model", value.model);
  setDefined(output, "translate_to_english", value.translateToEnglish);
  setDefined(output, "max_audio_minutes", value.maxAudioMinutes);
  return output;
}

function serializeGifPreview(value: GifPreviewOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "enabled", value.enabled);
  setDefined(output, "width", value.width);
  setDefined(output, "fps", value.fps);
  setDefined(output, "start_time", value.startTime);
  setDefined(output, "duration", value.duration);
  return output;
}

function serializeImage(value: ImageRendition): UnknownRecord {
  const output: UnknownRecord = {
    width: value.width,
    height: value.height,
    format: value.format,
  };
  setDefined(output, "mode", value.mode);
  setDefined(output, "quality", value.quality);
  setDefined(output, "max_bytes", value.maxBytes);
  setDefined(output, "min_quality", value.minQuality);
  return output;
}

function serializeAnimation(value: AnimationOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "width", value.width);
  setDefined(output, "fps", value.fps);
  setDefined(output, "start_time", value.startTime);
  setDefined(output, "duration", value.duration);
  setDefined(output, "loop", value.loop);
  setDefined(output, "quality", value.quality);
  return output;
}

function serializePlaceholders(value: PlaceholderOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "max_dimension", value.maxDimension);
  setDefined(output, "source_time_sec", value.sourceTimeSec);
  setDefined(output, "lqip_quality", value.lqipQuality);
  setDefined(output, "lqip_max_bytes", value.lqipMaxBytes);
  return output;
}

function serializeContactSheet(value: ContactSheetOptions): UnknownRecord {
  const output: UnknownRecord = {};
  setDefined(output, "columns", value.columns);
  setDefined(output, "rows", value.rows);
  setDefined(output, "tile_width", value.tileWidth);
  setDefined(output, "tile_height", value.tileHeight);
  setDefined(output, "interval_sec", value.intervalSec);
  setDefined(output, "start_time_sec", value.startTimeSec);
  setDefined(output, "duration_sec", value.durationSec);
  setDefined(output, "max_sheets", value.maxSheets);
  setDefined(output, "format", value.format);
  setDefined(output, "quality", value.quality);
  return output;
}

function serializeAudiogram(value: AudiogramOptions): UnknownRecord {
  const output: UnknownRecord = { artwork_source: value.artworkSource };
  setDefined(output, "captions_source", value.captionsSource);
  setDefined(output, "layout", value.layout);
  setDefined(output, "artwork_fit", value.artworkFit);
  setDefined(output, "background_color", value.backgroundColor);
  setDefined(output, "waveform_color", value.waveformColor);
  setDefined(output, "waveform_gain", value.waveformGain);
  setDefined(output, "start_time_sec", value.startTimeSec);
  setDefined(output, "duration_sec", value.durationSec);
  setDefined(output, "fps", value.fps);
  setDefined(output, "burn_captions", value.burnCaptions);
  setDefined(output, "caption_position", value.captionPosition);
  setDefined(output, "caption_font_scale", value.captionFontScale);
  setDefined(output, "normalize_audio", value.normalizeAudio);
  setDefined(output, "loudness_target_lufs", value.loudnessTargetLufs);
  return output;
}

function serializePrivacyRedaction(value: PrivacyRedactionOptions): UnknownRecord {
  const output: UnknownRecord = { detectors: value.detectors };
  setDefined(output, "style", value.style);
  setDefined(output, "failure_mode", value.failureMode);
  setDefined(output, "min_confidence", value.minConfidence);
  setDefined(output, "sample_interval_sec", value.sampleIntervalSec);
  setDefined(output, "max_frames", value.maxFrames);
  setDefined(output, "box_padding_ratio", value.boxPaddingRatio);
  setDefined(output, "solid_color", value.solidColor);
  setDefined(output, "pixel_block_size", value.pixelBlockSize);
  setDefined(output, "privacy_strength", value.privacyStrength);
  setDefined(output, "include_debug_observations", value.includeDebugObservations);
  return output;
}

export function serializeOutput(value: JobOutput | OutputAlias): UnknownRecord | OutputAlias {
  if (typeof value === "string") return value;
  const output: UnknownRecord = { type: value.type };
  setDefined(output, "preset", value.preset);
  setDefined(output, "path_suffix", value.pathSuffix);
  setDefined(output, "remove_bg", value.removeBg);
  setDefined(output, "smart_crop", value.smartCrop);
  if (value.video) output.video = serializeVideo(value.video);
  if (value.audio) output.audio = serializeAudio(value.audio);
  if (value.thumbnails) output.thumbnails = serializeThumbnails(value.thumbnails);
  if (value.subtitles) output.subtitles = serializeSubtitles(value.subtitles);
  if (value.gifPreview) output.gif_preview = serializeGifPreview(value.gifPreview);
  if (value.animation) output.animation = serializeAnimation(value.animation);
  if (value.placeholders) output.placeholders = serializePlaceholders(value.placeholders);
  if (value.contactSheet) output.contact_sheet = serializeContactSheet(value.contactSheet);
  if (value.audiogram) output.audiogram = serializeAudiogram(value.audiogram);
  if (value.privacyRedaction) output.privacy_redaction = serializePrivacyRedaction(value.privacyRedaction);
  if (value.images) output.images = value.images.map(serializeImage);
  setDefined(output, "poster_time_sec", value.posterTimeSec);
  setDefined(output, "poster_format", value.posterFormat);
  return output;
}

export function serializeCreateJob(
  params: CreateJobParams,
  resolved: { source?: string; inputs?: ResolvedBatchInput[] },
): UnknownRecord {
  const body: UnknownRecord = {};
  if (resolved.source !== undefined) body.source = resolved.source;
  if (resolved.inputs !== undefined) {
    body.inputs = resolved.inputs.map((input) => {
      const wireInput: UnknownRecord = { source: input.source };
      setDefined(wireInput, "input_id", input.inputId);
      if (input.metadata !== undefined) wireInput.metadata = input.metadata;
      return wireInput;
    });
  }
  if (params.outputs !== undefined) body.outputs = params.outputs.map(serializeOutput);
  setDefined(body, "recipe", params.recipe);
  setDefined(body, "webhook_url", params.webhookUrl);
  if (params.metadata !== undefined) body.metadata = params.metadata;
  if (params.moderation !== undefined) {
    const moderation: UnknownRecord = {};
    setDefined(moderation, "enabled", params.moderation.enabled);
    setDefined(moderation, "mode", params.moderation.mode);
    setDefined(moderation, "checks", params.moderation.checks);
    body.moderation = moderation;
  }
  if (params.watermark !== undefined) {
    const watermark: UnknownRecord = {};
    setDefined(watermark, "enabled", params.watermark.enabled);
    body.watermark = watermark;
  }
  return body;
}

function status(value: unknown): JobStatus {
  return String(value ?? "UNKNOWN").toUpperCase() as JobStatus;
}

export function parseJobReceipt(value: unknown): JobReceiptData {
  const data = record(value);
  const outputs = Array.isArray(data.outputs)
    ? data.outputs.map((item) => {
      const output = record(item);
      return {
        alias: stringOrNull(output.alias),
        type: String(output.type ?? "") as JobReceiptData["outputs"][number]["type"],
        preset: String(output.preset ?? ""),
      };
    })
    : [];
  return {
    id: String(data.job_id ?? ""),
    status: status(data.status),
    tier: String(data.tier ?? ""),
    requiredTier: stringOrNull(data.required_tier),
    outputs,
    recipe: parseRecipeAcknowledgement(data.recipe),
    message: String(data.msg ?? ""),
  };
}

export function parseRecipeAcknowledgement(value: unknown): RecipeAcknowledgement | null {
  if (value === null || value === undefined) return null;
  const data = record(value);
  const name = stringOrNull(data.name);
  const version = numberOrNull(data.version);
  const reference = stringOrNull(data.reference);
  const sha256 = stringOrNull(data.sha256);
  if (!name || version === null || !reference || !sha256) return null;
  const requestedReference = stringOrNull(data.requested_reference);
  return {
    name,
    version,
    reference,
    builtIn: data.built_in === true,
    sha256,
    ...(requestedReference ? { requestedReference } : {}),
  };
}

function parseTier(value: unknown): JobTier {
  const data = record(value);
  return {
    requested: stringOrNull(data.requested),
    required: stringOrNull(data.required),
    effective: stringOrNull(data.effective),
    billed: stringOrNull(data.billed),
    reasons: stringArray(data.reasons),
  };
}

function parseUsage(value: unknown): JobUsage {
  const data = record(value);
  return { unitsTotal: numberOrNull(data.units_total) };
}

function parseBilling(value: unknown): JobBilling {
  const data = record(value);
  return {
    status: stringOrNull(data.status),
    currency: stringOrNull(data.currency),
    unitPriceCents: numberOrNull(data.unit_price_cents),
    finalUnits: numberOrNull(data.final_units),
    finalAmountCents: numberOrNull(data.final_amount_cents),
    estimatedUnits: numberOrNull(data.estimated_units),
    estimatedAmountCents: numberOrNull(data.estimated_amount_cents),
  };
}

function parseBundle(value: unknown): JobBundle {
  const data = record(value);
  return {
    available: data.available === true,
    downloadUrl: stringOrNull(data.download_url),
    expiresAt: stringOrNull(data.expires_at),
    sizeBytes: numberOrNull(data.size_bytes),
    sha256: stringOrNull(data.sha256),
    retentionDays: numberOrNull(data.retention_days),
  };
}

function parseMediaVideo(value: unknown): JobMediaVideo | null {
  if (value === null || value === undefined) return null;
  const data = record(value);
  return {
    codec: stringOrNull(data.codec),
    profile: stringOrNull(data.profile),
    width: numberOrNull(data.width),
    height: numberOrNull(data.height),
    encodedWidth: numberOrNull(data.encoded_width),
    encodedHeight: numberOrNull(data.encoded_height),
    fps: numberOrNull(data.fps),
    bitRate: numberOrNull(data.bit_rate),
    rotationDeg: numberOrNull(data.rotation_deg),
    isRotated: booleanOrNull(data.is_rotated),
    displayAspectRatio: stringOrNull(data.display_aspect_ratio),
    orientation: stringOrNull(data.orientation),
  };
}

function parseMediaAudio(value: unknown): JobMediaAudio | null {
  if (value === null || value === undefined) return null;
  const data = record(value);
  return {
    codec: stringOrNull(data.codec),
    profile: stringOrNull(data.profile),
    sampleRateHz: numberOrNull(data.sample_rate_hz),
    channels: numberOrNull(data.channels),
    bitRate: numberOrNull(data.bit_rate),
    layout: stringOrNull(data.layout),
  };
}

function parseMedia(value: unknown): JobMedia | null {
  if (value === null || value === undefined) return null;
  const data = record(value);
  const streams = record(data.streams);
  return {
    format: stringOrNull(data.format),
    durationSec: numberOrNull(data.duration_sec),
    bitRate: numberOrNull(data.bit_rate),
    video: parseMediaVideo(data.video),
    audio: parseMediaAudio(data.audio),
    streams: {
      video: numberOrNull(streams.video) ?? 0,
      audio: numberOrNull(streams.audio) ?? 0,
      other: numberOrNull(streams.other) ?? 0,
    },
  };
}

export function parseJobDetails(value: unknown): JobDetails {
  const data = record(value);
  const metadata = record(data.metadata) as Metadata;
  return {
    id: String(data.job_id ?? ""),
    status: status(data.status),
    tier: parseTier(data.tier),
    usage: parseUsage(data.usage),
    billing: parseBilling(data.billing),
    bundle: parseBundle(data.bundle),
    media: parseMedia(data.media),
    metadata,
    recipe: parseRecipeAcknowledgement(data.recipe),
    error: stringOrNull(data.error),
    createdAt: stringOrNull(data.created_at),
    updatedAt: stringOrNull(data.updated_at),
    startedAt: stringOrNull(data.started_at),
    completedAt: stringOrNull(data.completed_at),
  };
}

function parseJobSummary(value: unknown): JobSummary {
  const data = record(value);
  return {
    id: String(data.job_id ?? ""),
    status: status(data.status),
    tierBilled: stringOrNull(data.tier_billed),
    unitsTotal: numberOrNull(data.units_total),
    amountCents: numberOrNull(data.amount_cents),
    currency: stringOrNull(data.currency),
    bundleAvailable: data.bundle_available === true,
    createdAt: stringOrNull(data.created_at),
    updatedAt: stringOrNull(data.updated_at),
  };
}

export function parseJobPage(value: unknown): JobPage {
  const data = record(value);
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs.map(parseJobSummary) : [],
    nextCursor: stringOrNull(data.next_cursor),
  };
}

export function parseModeration(value: unknown): ModerationResult {
  const data = record(value);
  const judgeValue = data.judge;
  const judge = judgeValue === null || judgeValue === undefined ? null : record(judgeValue);
  return {
    verdict: stringOrNull(data.verdict),
    mode: stringOrNull(data.mode),
    mediaType: stringOrNull(data.media_type),
    requestedChecks: stringArray(data.requested_checks),
    flaggedChecks: stringArray(data.flagged_checks),
    reviewOnlyChecks: stringArray(data.review_only_checks),
    checks: Array.isArray(data.checks)
      ? data.checks.map((value) => {
          const check = record(value);
          return {
            check: String(check.check ?? ""),
            decision: stringOrNull(check.decision),
            confidence: numberOrNull(check.confidence),
            reviewOnly: booleanOrNull(check.review_only),
          };
        })
      : [],
    judge: judge
      ? {
          escalated: booleanOrNull(judge.escalated),
          escalatedChecks: stringArray(judge.escalated_checks),
          likelihoods: Object.fromEntries(
            Object.entries(record(judge.likelihoods)).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          ok: booleanOrNull(judge.ok),
          error: stringOrNull(judge.error),
        }
      : null,
    ok: booleanOrNull(data.ok),
    error: stringOrNull(data.error),
  };
}

export function parseMediaReport(value: unknown): MediaReportResult {
  const data = record(value);
  const reportValue = data.report;
  return {
    jobId: String(data.job_id ?? ""),
    report:
      reportValue !== null && typeof reportValue === "object" && !Array.isArray(reportValue)
        ? (reportValue as Record<string, unknown>)
        : null,
    downloadUrl: stringOrNull(data.download_url),
    note: stringOrNull(data.note),
  };
}

export function parseCompatibilityReport(value: unknown): CompatibilityReportResult {
  const data = record(value);
  const reportValue = data.report;
  return {
    jobId: String(data.job_id ?? ""),
    report:
      reportValue !== null && typeof reportValue === "object" && !Array.isArray(reportValue)
        ? (reportValue as Record<string, unknown>)
        : null,
    downloadUrl: stringOrNull(data.download_url),
    note: stringOrNull(data.note),
  };
}

export function parseCodeDetections(value: unknown): CodeDetectionResult {
  const data = record(value);
  const reportValue = data.report;
  return {
    jobId: String(data.job_id ?? ""),
    report:
      reportValue !== null && typeof reportValue === "object" && !Array.isArray(reportValue)
        ? (reportValue as CodeDetectionResult["report"])
        : null,
    downloadUrl: stringOrNull(data.download_url),
    note: stringOrNull(data.note),
  };
}

export function parseRetryWebhook(value: unknown): RetryWebhookResult {
  const data = record(value);
  return {
    status: String(data.status ?? ""),
    message: String(data.msg ?? ""),
    attempts: numberOrNull(data.attempts) ?? 0,
    httpStatus: numberOrNull(data.http_status),
  };
}

export function parseCapabilities(value: unknown): Capabilities {
  const data = record(value);
  const arrayRecord = (input: unknown): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(record(input)).map(([key, item]) => [key, stringArray(item)]),
    );
  const stringRecord = (input: unknown): Record<string, string> =>
    Object.fromEntries(
      Object.entries(record(input)).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  const outputAliases = Object.fromEntries(
    Object.entries(record(data.output_aliases)).map(([alias, item]) => {
      const spec = record(item);
      return [alias, {
        type: String(spec.type ?? "") as Capabilities["outputAliases"][string]["type"],
        preset: String(spec.preset ?? ""),
        tier: String(spec.tier ?? "standard") as Capabilities["outputAliases"][string]["tier"],
        artifacts: stringArray(spec.artifacts),
        output: record(spec.output),
      }];
    }),
  );
  const presets = Object.fromEntries(
    Object.entries(record(data.presets)).map(([name, item]) => {
      const spec = record(item);
      const parsed: Capabilities["presets"][string] = {
        outputType: String(spec.output_type ?? "") as Capabilities["presets"][string]["outputType"],
        sourceKinds: stringArray(spec.source_kinds),
        baseTier: String(spec.base_tier ?? "standard") as Capabilities["presets"][string]["baseTier"],
        description: String(spec.description ?? ""),
        artifacts: stringArray(spec.artifacts),
      };
      if (typeof spec.codec === "string") parsed.codec = spec.codec;
      if (typeof spec.container === "string") parsed.container = spec.container;
      if (typeof spec.parameterized === "boolean") parsed.parameterized = spec.parameterized;
      if (typeof spec.example === "string") parsed.example = spec.example;
      return [name, parsed];
    }),
  );
  return {
    capabilities: stringRecord(data.capabilities),
    outputTypes: arrayRecord(data.output_types),
    presetOverrides: arrayRecord(data.preset_overrides),
    publicPresets: stringArray(data.public_presets),
    presets,
    features: Object.fromEntries(
      Object.entries(record(data.features)).map(([name, item]) => [name, record(item)]),
    ),
    outputAliases,
    notes: stringArray(data.notes),
  };
}
