# `@mediaruntime/node`

[![CI](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml)

Official Node.js SDK for the MediaRuntime asynchronous media API.

Status: stable `1.1.1`. The SDK is validated against the production API from a Node.js 22
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
