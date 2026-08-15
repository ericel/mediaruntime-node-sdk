# `@mediaruntime/node`

[![CI](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml)

Official Node.js SDK for the MediaRuntime asynchronous media API.

Status: stable. Version `0.1.0` is validated against the production API from a Node.js 22
Firebase Functions consumer, including job submission, terminal webhook verification,
artifact reconciliation, and moderation persistence.

## Install

```bash
npm install @mediaruntime/node
```

Node.js 20 or newer is required.

## Submit and wait

```ts
import { MediaRuntime } from "@mediaruntime/node";

const media = new MediaRuntime({
  apiKey: process.env.MEDIARUNTIME_API_KEY,
});

const job = await media.jobs.create({
  source: "./video.mp4",
  outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
  metadata: { video_id: "vid_123" },
  idempotencyKey: "video:vid_123:v1",
});

console.log(job.id);

// Useful for scripts and tests. Prefer signed webhooks in production.
const result = await job.wait({ timeoutMs: 300_000 });
console.log(result.status, result.bundle.downloadUrl);
```

HTTP(S) and `gs://` sources are submitted directly. Other strings and `file://` URLs are
treated as local files and transparently uploaded through MediaRuntime's signed-upload
flow.

The production API URL is built in. Do not ask application users to configure it.
`baseUrl` is an optional override for local gateways, staging environments, and mock
servers:

```ts
const localMedia = new MediaRuntime({
  apiKey: process.env.MEDIARUNTIME_API_KEY,
  baseUrl: "http://localhost:8001",
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
