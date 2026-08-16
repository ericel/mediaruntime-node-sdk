# `@mediaruntime/node`

[![CI](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml)

Official Node.js SDK for the MediaRuntime asynchronous media API.

Status: stable. Version `0.2.1` is validated against the production API from a Node.js 22
Firebase Functions consumer, including job submission, terminal webhook verification,
artifact reconciliation, and moderation persistence.

## Install

```bash
npm install @mediaruntime/node
```

Node.js 20 or newer is required.

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

Enable report-only moderation when creating a visual-media job, then retrieve its typed
result after completion:

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
