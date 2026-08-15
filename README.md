# `@mediaruntime/node`

[![CI](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ericel/mediaruntime-node-sdk/actions/workflows/ci.yml)

Official Node.js SDK for the MediaRuntime asynchronous media API.

> Status: public beta. The local contract suite passes; live staging conformance remains
> a release gate for stable `0.1.0`.

## Install

```bash
npm install @mediaruntime/node@next
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
| `baseUrl` | `MEDIARUNTIME_API_URL` | `https://mediaruntime.com` |
| `webhookSecret` | `MEDIARUNTIME_WEBHOOK_SECRET` | required for webhook verification |
| `timeoutMs` | — | `30000` |
| `maxRetries` | — | `2` |

See [the software design document](./docs/NODE_SDK_SDD.md) for the API boundaries,
security model, retry semantics, milestones, and release gates.

Maintainers should follow [the release runbook](./docs/RELEASING.md) for automated npm
publishing through GitHub Actions.
