# `@mediaruntime/node`

[![CI](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml)

Official Node.js SDK for the MediaRuntime asynchronous media API.

Status: stable `1.2.0`. The SDK is validated against the production API from a Node.js 22
Firebase Functions consumer, including job submission, terminal webhook verification,
artifact reconciliation, and moderation persistence.

The documented `1.x` public API follows semantic versioning. Breaking changes to public
exports, request options, error types, or documented response projections require a new
major version; compatible fields and capabilities may be added in minor releases.

## Install

```bash
npm install @mediaruntime/node
```

Node.js 22 or newer is required.

## Submit, wait, and get the bundle

```ts
import { MediaRuntime } from "@mediaruntime/node";

const media = new MediaRuntime({
  apiKey: process.env.MEDIARUNTIME_API_KEY,
});

const job = await media.jobs.create({
  source: "./video.mp4",
  outputs: ["video.web"],
  metadata: { video_id: "vid_123" },
  idempotencyKey: "video:vid_123:v1",
});

console.log(job.id);

// Polling is convenient for scripts, tests, and first-run verification.
const result = await job.wait({ timeoutMs: 300_000 });
if (result.status !== "COMPLETED" || !result.bundle.downloadUrl) {
  throw new Error(`MediaRuntime job ended with ${result.status}`);
}
console.log(result.bundle.downloadUrl);
```

Every `jobs.create()` call carries an idempotency key. If you omit `idempotencyKey`, the
SDK generates an opaque key for that invocation and reuses it only for automatic retries
inside the same live call. That protects against a response being lost after acceptance.
It does not survive a restart, queue redelivery, or a later `create()` call. Supply a
stable business key, as shown above, whenever those attempts must resolve to one job.

`result.bundle.downloadUrl` is a short-lived URL for the canonical ZIP containing every
requested deliverable. One job can place a video, poster, subtitles, multiple renditions,
or a complete HLS directory tree in that bundle; the SDK does not model those files as
separate delivery URLs.

In production, persist `job.id` and complete the workflow from the signed terminal
webhook sent to the destination configured under Account → Webhooks. Redeem
`delivery.bundle.download.url` from that event for the same ZIP. A job submission does
not supply or override the webhook URL.

HTTP(S) and `gs://` sources are submitted directly. Other strings and `file://` URLs are
treated as local files and transparently uploaded through MediaRuntime's signed-upload
flow.

Aliases are frozen gateway contracts: `video.web`, `video.streaming`, `video.social`,
`audio.web`, `audio.transcription`, and `image.web`. The gateway materializes them before
validation, estimation, billing, and persistence. Explicit `{ type, preset, ... }` output
objects remain supported and may be mixed with aliases.

## Hosted recipes

Hosted recipes are immutable, account-scoped versions of a complete outputs, moderation,
and watermark policy. They are useful when several services or teammates must run the
same policy without copying request configuration.

```ts
const available = await media.recipes.list();

const created = await media.recipes.create({
  name: "team-video",
  description: "Default web playback policy",
  template: { outputs: ["video.web"] },
});

const job = await media.jobs.create({
  source: "./launch.mp4",
  recipe: created.reference, // team-video@1
  metadata: { asset_id: "launch-01" },
});
```

Use `media.recipes.get(name, { version })`, `createVersion(name, { expectedLatestVersion,
template })`, and `archive(name)` to manage custom policies. Versions are immutable and
optimistically locked. Built-ins `web-video@1`, `social-video@1`, and
`ai-transcription@1` are always available. A `recipe` job cannot also supply inline
`outputs`, `moderation`, or `watermark`; resolution happens in the gateway before
validation, estimation, billing, idempotency, and dispatch.

The production API URL is built in. Do not ask application users to configure it.
`baseUrl` is an optional override for local gateways, staging environments, and mock
servers:

```ts
const localMedia = new MediaRuntime({
  apiKey: process.env.MEDIARUNTIME_API_KEY,
  baseUrl: "http://localhost:8001",
});
```

## Batch inputs

Use `source` on every batch item. Each value accepts the same HTTP(S), `gs://`, local-path,
or `file://` forms as a single job; the SDK uploads local files before submission.

```ts
const batch = await media.jobs.create({
  inputs: [
    { source: "https://cdn.example.com/a.mp4", inputId: "asset-a" },
    { source: "./b.mp4", inputId: "asset-b", metadata: { position: 1 } },
  ],
  outputs: ["video.web"],
});
```

## Animated WebP and APNG

Animated images use `type: "image"` with a timeline-specific Premium preset. Controls are
bounded by the gateway; `loop: 0` repeats forever and `quality` applies only to WebP.

```ts
const animation = await media.jobs.create({
  source: "./launch.mp4",
  outputs: [{
    type: "image",
    preset: "image_animated_webp_v1",
    animation: {
      width: 720,
      fps: 15,
      startTime: 0,
      duration: 6,
      loop: 0,
      quality: 80,
    },
  }],
});
```

Use `image_animated_apng_v1` for lossless animated PNG. Watermarking these animation
presets is rejected until that combination is explicitly supported.

## BlurHash, ThumbHash, and LQIP

Create portable loading placeholders from an image or a selected video frame with one
Standard-tier output. The bundle contains `placeholders.json` with BlurHash and
base64-encoded ThumbHash values plus a bounded `lqip.webp` file.

```ts
const placeholders = await media.jobs.create({
  source: "./product-photo.png",
  outputs: [{
    type: "image",
    preset: "image_placeholders_v1",
    placeholders: {
      maxDimension: 32,
      sourceTimeSec: 0,
      lqipQuality: 50,
      lqipMaxBytes: 4096,
    },
  }],
});
```

The JSON also records explicit source and placeholder dimensions, source format, the
requested frame time, and a deterministic alpha-aware dominant colour. For video or
animated images, `sourceTimeSec` defaults to the first frame at `0`; it does not select a
representative frame automatically.

`maxDimension` is bounded to 8–100 pixels and `lqipMaxBytes` to 256–16384 bytes.
The job fails instead of silently exceeding the requested LQIP byte ceiling.
Watermarking this preset is rejected.

## Composite video contact sheets

Create bounded review grids from a video with the Standard-tier `contact_sheet_v1`
preset. The ZIP contains numbered images and `contact_sheet.json`, which maps every tile
to its exact source timestamp.

```ts
const sheets = await media.jobs.create({
  source: "./interview.mp4",
  outputs: [{
    type: "frames",
    preset: "contact_sheet_v1",
    contactSheet: {
      columns: 5,
      rows: 4,
      tileWidth: 240,
      tileHeight: 135,
      intervalSec: 12,
      startTimeSec: 0,
      durationSec: 0, // remaining video
      maxSheets: 3,
      format: "jpg",
      quality: 80,
    },
  }],
});
```

Billing is one flat processing unit per produced composite sheet. Watermarking this
preset is rejected; each numbered sheet is a primary deliverable in the canonical ZIP.
`quality` applies to JPG and WebP; PNG is lossless.

## Audiograms

Compose a timed audio track, supplied artwork, a generated waveform, and optional supplied
captions with the Premium `audiogram_v1` preset:

```ts
const job = await media.jobs.create({
  source: "./episode.mp3",
  outputs: [{
    type: "social",
    preset: "audiogram_v1",
    audiogram: {
      artworkSource: "https://cdn.example.com/podcast/cover.png",
      captionsSource: "https://cdn.example.com/podcast/episode.vtt",
      burnCaptions: true,
      layout: "square",
      artworkFit: "blurred_background",
      backgroundColor: "#101827",
      waveformColor: "#5B5CFF",
      waveformGain: 2,
      captionPosition: "bottom",
      captionFontScale: 1,
      normalizeAudio: true,
      loudnessTargetLufs: -16,
      durationSec: 60,
      fps: 30,
    },
  }],
});
```

Artwork must be PNG, JPEG, or WebP up to 10 MB; captions must be UTF-8 SRT or VTT up to
2 MB. Artwork can be contained, covered, or preserved over a blurred fill. Waveforms and
captions use separate regions in a reserved high-contrast safe band; `top` and `bottom`
select the caption strip and never place text over caller artwork. Multi-line cues scale down
adaptively, and the caption-free poster is sampled after waveform activity begins. Loudness
normalization is optional and reports its target plus measured input/output values. The
ZIP contains `audiogram.mp4`, a caption-free `poster.jpg`, `audiogram.json`, and
`audiogram.waveform.json`. Account watermarking and speech-generated subtitles cannot be
combined with this preset in v1.

For JPG and WebP renditions, `maxBytes` is a hard final-file ceiling. MediaRuntime searches
between `quality` and `minQuality`, verifies the encoded file on disk, and fails the job
instead of returning an oversized artifact:

```ts
const job = await media.jobs.create({
  source: "https://cdn.example.com/photo.jpg",
  outputs: [{
    type: "image",
    preset: "image_multi_v1",
    images: [{
      width: 1280,
      height: 720,
      mode: "cover",
      format: "webp",
      quality: 86,
      maxBytes: 200_000,
      minQuality: 35,
    }],
  }],
});
```

The bundle includes `image_size_limits.json` with the selected quality, final byte count,
and bounded attempt history. PNG and AVIF do not currently accept `maxBytes`.

## Privacy redaction

Privacy redaction is an explicit Premium Preview for still-image inputs and image outputs.
Video and animated-image requests are rejected before billing and execution.

```ts
const job = await media.jobs.create({
  source: "./team-photo.jpg",
  outputs: [{
    type: "image",
    preset: "image_multi_v1",
    images: [{ width: 1280, height: 720, mode: "fit", format: "png", quality: 80 }],
    privacyRedaction: {
      detectors: ["face", "license_plate", "text"],
      style: "blur",
      failureMode: "fail_closed",
      minConfidence: 0.65,
      sampleIntervalSec: 0.2,
      maxFrames: 1800,
      boxPaddingRatio: 0.15,
      privacyStrength: "strong",
      pixelBlockSize: 24,
      includeDebugObservations: false,
    },
  }],
});
```

Use `report_only` only when an unsafe or incomplete image is acceptable for review.
`fail_closed` stops on detector failure, unresolved ambiguity, bounded-limit truncation,
or a residual that remediation cannot eliminate. Recognizable residuals under blur or
pixelation may be escalated to bounded opaque masks and verified again. The ZIP includes
the redacted image and `privacy_redaction.json` schema v3. Public metadata reports stable
detector categories, counts, verification outcomes, and ZIP-relative `report_bundle_path`
and `output_bundle_paths`; it does not expose detector vendors, model identities, model or
worker paths, bucket names, or raw OCR text. Automated recall is not exhaustive, so
`coverage_verified` remains false and human review is required. Opt into
`includeDebugObservations` only when per-sample boxes are needed.

## Moderation

Choose observational `report` moderation or fail-closed `block` enforcement when creating
a visual-media job, then retrieve its typed result after completion. In block mode,
`review` or `block` ends the job as `REJECTED` before transcoding; `allow` continues.

```ts
const job = await media.jobs.create({
  source: "https://cdn.example.com/photo.jpg",
  outputs: [{ type: "image", preset: "image_multi_v1" }],
  moderation: {
    enabled: true,
    mode: "report",
    checks: ["sexual", "violence", "dangerous"],
  },
});

const result = await job.wait();
const moderation = await media.jobs.getModeration(result.id);
console.log(moderation.verdict, moderation.flaggedChecks);
```

For an actionable, versioned delivery verdict, request the compatibility sidecar and read
it directly after completion (it also remains in the ZIP bundle):

```ts
const job = await media.jobs.create({
  source: "https://cdn.example.com/video.webm",
  outputs: [{ type: "image", preset: "compatibility_report_v1" }],
});
const result = await job.wait();
const compatibility = await media.jobs.getCompatibilityReport(result.id);
console.log(compatibility.report?.profiles);
```

The five named profiles are conservative, versioned guidance rather than exhaustive
certification of every browser, device, editor, or social platform version.

To scan QR codes and barcodes in an image, video/animation, or embedded audio cover
artwork, use the bounded analysis preset and read the result directly:

```ts
const job = await media.jobs.create({
  source: "/srv/media/poster-with-qr.png",
  outputs: [{ type: "frames", preset: "code_detect_v1" }],
});
const result = await job.wait();
const codes = await media.jobs.getCodeDetections(result.id);

// Attacker-controlled data: render as text, never HTML, and do not auto-open URLs.
console.log(codes.report?.detections?.map((item) => item.decoded_text));
```

Audio is accepted only when it contains embedded cover artwork. The scan is capped at 12
frames from the opening 110 seconds and 16 unique codes per frame, and costs a flat two
processing units.

Explicit outputs include MPEG-DASH and VP9/WebM:

```ts
outputs: [
  { type: "dash", preset: "dash_ladder_v1" },
  { type: "webm", preset: "webm_vp9_1080p" },
]
```

`media.capabilities.retrieve()` returns the gateway's complete preset catalog and feature
contracts, including smart-crop semantics and moderation enforcement modes.

## Verify webhooks

```ts
import express from "express";
import { MediaRuntime } from "@mediaruntime/node";

const media = new MediaRuntime();
const app = express();

app.post(
  "/webhooks/mediaruntime",
  express.raw({ type: "application/json" }),
  media.webhooks.express(async (event, _req, res) => {
    // Persist and deduplicate event.id in your own datastore before acknowledging.
    console.log(event.id, event.jobId, event.status);
    res.sendStatus(204);
  }),
);
```

Register the raw-body route before `express.json()`. Webhook verification cannot use a
JSON object that has already been parsed and reserialized.

Fastify can keep the raw parser scoped to the webhook route, so normal JSON routes are
unchanged:

```ts
import Fastify from "fastify";
import { MediaRuntime } from "@mediaruntime/node";

const media = new MediaRuntime();
const app = Fastify();

await app.register(async (webhookRoutes) => {
  webhookRoutes.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  webhookRoutes.post(
    "/webhooks/mediaruntime",
    media.webhooks.fastify(async (event, _request, reply) => {
      // Persist and deduplicate event.id before acknowledging.
      console.log(event.id, event.jobId, event.status);
      reply.code(204).send();
    }),
  );
});
```

If your application already uses a raw-body plugin, the adapter prefers
`request.rawBody` and falls back to a Buffer in `request.body`. Parsed JSON fails closed.

## Error handling

Every gateway response carries `X-Request-Id`. API errors expose the same correlation ID
alongside the gateway-owned error code and retry classification:

```ts
import { MediaRuntimeApiError } from "@mediaruntime/node";

try {
  await media.jobs.get("job_123");
} catch (error) {
  if (error instanceof MediaRuntimeApiError) {
    console.error(error.code, error.status, error.retryable, error.requestId, error.details);
  }
}
```

`responseBody` retains the complete compatibility response. Treat `retryable` as a
transport classification. The SDK makes retries inside one `jobs.create()` invocation
safe with one generated or caller-provided key; only a caller-provided business key can
deduplicate a later invocation.

## Configuration

Constructor options override environment variables:

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `MEDIARUNTIME_API_KEY` | required for authenticated calls |
| `baseUrl` | `MEDIARUNTIME_API_URL` | `https://mediaruntime.com` (normally leave unset) |
| `webhookSecret` | `MEDIARUNTIME_WEBHOOK_SECRET` | required for webhook verification |
| `timeoutMs` | — | `30000` |
| `maxRetries` | — | `2` |

See [the software design document](./docs/NODE_SDK_SDD.md) for the API boundaries,
security model, retry semantics, milestones, and release gates.

Maintainers should follow [the release runbook](./docs/RELEASING.md) for automated npm
publishing through GitHub Actions.

## Contract conformance

This repository validates the SDK against versioned fixtures derived from MediaRuntime's
public API contract. The suite covers canonical source serialization, supported output
aliases, terminal job states, normalized errors, request correlation, and the shared
bundle metadata exposed through polling and terminal webhooks. They also pin representative
multi-result and HLS ZIP trees plus owner-scoped, expiring bundle redemption. These
development fixtures are not included in the published npm package.

Maintainer synchronization instructions live in
[Contract maintenance](./docs/CONTRACT_MAINTENANCE.md).
