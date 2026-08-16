import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  JobWaitTimeoutError,
  MediaRuntime,
  MediaRuntimeConnectionError,
  MediaRuntimeTimeoutError,
  ValidationError,
} from "../dist/index.js";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function details(status = "PROCESSING") {
  return {
    job_id: "job_123",
    status,
    tier: { requested: "standard", required: "standard", effective: "standard", billed: null, reasons: [] },
    usage: { units_total: null },
    billing: {
      status: "RESERVED",
      currency: "USD",
      unit_price_cents: 1,
      final_units: null,
      final_amount_cents: null,
      estimated_units: 2,
      estimated_amount_cents: 2,
    },
    bundle: {
      available: status === "COMPLETED",
      download_url: status === "COMPLETED" ? "https://example.test/bundle" : null,
      expires_at: null,
      size_bytes: null,
      sha256: null,
      retention_days: 7,
    },
    media: null,
    metadata: { customer_key: "unchanged" },
    error: null,
    created_at: "2026-08-15T00:00:00Z",
    updated_at: "2026-08-15T00:00:01Z",
    started_at: null,
    completed_at: status === "COMPLETED" ? "2026-08-15T00:00:02Z" : null,
  };
}

test("maps ergonomic create input to the current gateway contract without changing metadata keys", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    baseUrl: "https://api.example.test/",
    fetch: async (input, init) => {
      captured = { url: String(input), init };
      return json({ job_id: "job_123", status: "queued", tier: "standard", msg: "accepted" });
    },
  });

  const job = await media.jobs.create({
    source: "https://cdn.example.test/video.mp4",
    idempotencyKey: "video:123:v1",
    metadata: { Customer_Key: "keep_me" },
    outputs: [
      {
        type: "mp4",
        preset: "mp4_720p_h264_aac",
        pathSuffix: "web",
        posterTimeSec: 2,
        video: { bitrateBps: 2_000_000, twoPass: true },
        subtitles: { translateToEnglish: true, maxAudioMinutes: 30 },
      },
    ],
  });

  assert.equal(job.id, "job_123");
  assert.equal(job.status, "QUEUED");
  assert.equal(captured.url, "https://api.example.test/v1/jobs");
  assert.equal(new Headers(captured.init.headers).get("x-api-key"), "sk_test");
  assert.equal(new Headers(captured.init.headers).get("idempotency-key"), "video:123:v1");
  assert.deepEqual(JSON.parse(captured.init.body), {
    file_url: "https://cdn.example.test/video.mp4",
    outputs: [
      {
        type: "mp4",
        preset: "mp4_720p_h264_aac",
        path_suffix: "web",
        video: { bitrate_bps: 2_000_000, two_pass: true },
        subtitles: { translate_to_english: true, max_audio_minutes: 30 },
        poster_time_sec: 2,
      },
    ],
    metadata: { Customer_Key: "keep_me" },
  });
});

test("sends canonical source for every batch input", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_batch", status: "queued", tier: "standard", msg: "accepted" });
    },
  });

  const job = await media.jobs.create({
    inputs: [
      {
        source: "https://cdn.example.test/a.mp4",
        inputId: "asset-a",
        metadata: { position: 0 },
      },
      {
        source: new URL("https://cdn.example.test/b.mp4"),
        inputId: "asset-b",
      },
    ],
    outputs: ["video.web"],
  });

  assert.equal(job.id, "job_batch");
  assert.deepEqual(captured, {
    inputs: [
      {
        source: "https://cdn.example.test/a.mp4",
        input_id: "asset-a",
        metadata: { position: 0 },
      },
      {
        source: "https://cdn.example.test/b.mp4",
        input_id: "asset-b",
      },
    ],
    outputs: ["video.web"],
  });
});

test("forwards frozen output aliases for gateway-side resolution", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({
        job_id: "job_alias",
        status: "queued",
        tier: "standard",
        required_tier: "standard",
        outputs: [
          { alias: "video.web", type: "mp4", preset: "mp4_720p_h264_aac" },
          { alias: "audio.transcription", type: "audio", preset: "audio_aac_128k" },
        ],
        msg: "accepted",
      });
    },
  });

  const job = await media.jobs.create({
    source: "https://cdn.example.test/video.mp4",
    outputs: ["video.web", "audio.transcription"],
  });

  assert.equal(job.id, "job_alias");
  assert.equal(job.requiredTier, "standard");
  assert.equal(job.outputs[0].preset, "mp4_720p_h264_aac");
  assert.deepEqual(captured.outputs, ["video.web", "audio.transcription"]);
});

test("does not retry an ambiguous unkeyed job submission", async () => {
  let calls = 0;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 3,
    fetch: async () => {
      calls += 1;
      throw new TypeError("socket closed");
    },
  });
  await assert.rejects(
    media.jobs.create({
      source: "https://cdn.example.test/video.mp4",
      outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
    }),
    MediaRuntimeConnectionError,
  );
  assert.equal(calls, 1);
});

test("retries a keyed submission on a retryable response", async () => {
  let calls = 0;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 2,
    fetch: async () => {
      calls += 1;
      if (calls === 1) return json({ detail: "temporary" }, 500, { "Retry-After": "0" });
      return json({ job_id: "job_123", status: "QUEUED", tier: "standard", msg: "accepted" });
    },
  });
  const job = await media.jobs.create({
    source: "https://cdn.example.test/video.mp4",
    outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
    idempotencyKey: "video:123:v1",
  });
  assert.equal(job.id, "job_123");
  assert.equal(calls, 2);
});

test("distinguishes idempotency in-progress and request-conflict responses", async () => {
  const responses = [
    json({ detail: "A request with this Idempotency-Key is still in progress" }, 409),
    json({ detail: "Idempotency-Key was already used with a different request body" }, 422),
  ];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 0,
    fetch: async () => responses.shift(),
  });
  const params = {
    source: "https://cdn.example.test/video.mp4",
    outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
    idempotencyKey: "video:123:v1",
  };
  await assert.rejects(media.jobs.create(params), IdempotencyInProgressError);
  await assert.rejects(media.jobs.create(params), IdempotencyConflictError);
});

test("uploads a local source with all signed headers, without leaking the API key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mediaruntime-sdk-"));
  const path = join(directory, "sample.mp4");
  await writeFile(path, Buffer.from("sample-media"));
  const calls = [];
  try {
    const media = new MediaRuntime({
      apiKey: "sk_test",
      fetch: async (input, init = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/v1/upload-url")) {
          return json({
            upload_url: "https://storage.example.test/signed",
            file_uri: "gs://input-bucket/opaque/sample.mp4",
            upload_headers: {
              "Content-Type": "video/mp4",
              "X-Goog-Test": "preserve",
            },
          });
        }
        if (url === "https://storage.example.test/signed") {
          await new Response(init.body).arrayBuffer();
          return new Response("", { status: 200 });
        }
        return json({ job_id: "job_local", status: "queued", tier: "standard", msg: "accepted" });
      },
    });
    const job = await media.jobs.create({
      source: path,
      outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
    });
    assert.equal(job.id, "job_local");
    assert.equal(calls.length, 3);
    const signedHeaders = new Headers(calls[1].init.headers);
    assert.equal(signedHeaders.get("content-type"), "video/mp4");
    assert.equal(signedHeaders.get("x-goog-test"), "preserve");
    assert.equal(signedHeaders.get("x-api-key"), null);
    assert.equal(JSON.parse(calls[2].init.body).file_url, "gs://input-bucket/opaque/sample.mp4");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("wait polls until a terminal state and returns camelCase detail", async () => {
  const queue = [details("PROCESSING"), details("COMPLETED")];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async () => json(queue.shift()),
  });
  const result = await media.jobs.wait("job_123", {
    timeoutMs: 1_000,
    initialDelayMs: 0,
    maxDelayMs: 0,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.bundle.downloadUrl, "https://example.test/bundle");
  assert.deepEqual(result.metadata, { customer_key: "unchanged" });
});

test("capabilities are available without an API key and safe reads retry", async () => {
  let calls = 0;
  const media = new MediaRuntime({
    maxRetries: 1,
    fetch: async (_input, init) => {
      calls += 1;
      assert.equal(new Headers(init.headers).get("x-api-key"), null);
      if (calls === 1) return json({ detail: "temporary" }, 503, { "Retry-After": "0" });
      return json({
        capabilities: { visual: "a video or image stream" },
        output_types: { mp4: ["timeline", "visual"] },
        preset_overrides: {},
        output_aliases: {
          "video.web": {
            type: "mp4",
            preset: "mp4_720p_h264_aac",
            tier: "standard",
            artifacts: ["720p MP4"],
            output: { type: "mp4", preset: "mp4_720p_h264_aac" },
          },
        },
        notes: [],
      });
    },
  });
  const result = await media.capabilities.retrieve();
  assert.deepEqual(result.outputTypes.mp4, ["timeline", "visual"]);
  assert.equal(result.outputAliases["video.web"].preset, "mp4_720p_h264_aac");
  assert.equal(calls, 2);
});

test("wait times out with the last observed job", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async () => json(details("PROCESSING")),
  });
  await assert.rejects(
    media.jobs.wait("job_123", { timeoutMs: 2, initialDelayMs: 10, maxDelayMs: 10 }),
    (error) =>
      error instanceof JobWaitTimeoutError &&
      error.lastJob?.id === "job_123" &&
      error.lastJob.status === "PROCESSING",
  );
});

test("covers list, moderation, media-report, and manual webhook retry projections", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/jobs" && init.method === "GET") {
        assert.equal(url.searchParams.get("status"), "COMPLETED");
        return json({
          jobs: [{
            job_id: "job_1",
            status: "COMPLETED",
            tier_billed: "standard",
            units_total: 4,
            amount_cents: 8,
            currency: "USD",
            bundle_available: true,
            created_at: null,
            updated_at: "2026-08-15T00:00:00Z",
          }],
          next_cursor: "job_1",
        });
      }
      if (url.pathname.endsWith("/moderation")) {
        return json({
          verdict: "review",
          mode: "report",
          media_type: "video",
          requested_checks: ["violence"],
          flagged_checks: ["violence"],
          review_only_checks: [],
          checks: [{ check: "violence", decision: "review", confidence: 0.8, review_only: false }],
          judge: { escalated: true, escalated_checks: ["violence"], likelihoods: { violence: "LIKELY" }, ok: true, error: null },
          ok: true,
          error: null,
        });
      }
      if (url.pathname.endsWith("/media-report")) {
        return json({ job_id: "job_1", report: { format: "mov" }, download_url: null, note: null });
      }
      if (url.pathname.endsWith("/retry-webhook")) {
        return json({ status: "success", msg: "sent", attempts: 1, http_status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const page = await media.jobs.list({ status: "COMPLETED", limit: 1 });
  assert.equal(page.jobs[0].id, "job_1");
  assert.equal(page.nextCursor, "job_1");
  const moderation = await media.jobs.getModeration("job_1");
  assert.equal(moderation.checks[0].reviewOnly, false);
  const report = await media.jobs.getMediaReport("job_1");
  assert.deepEqual(report.report, { format: "mov" });
  const retried = await media.jobs.retryWebhook("job_1");
  assert.equal(retried.httpStatus, 204);
});

test("rejects an empty job id before making a request", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async () => { throw new Error("must not run"); },
  });
  await assert.rejects(media.jobs.getModeration("  "), ValidationError);
});

test("wraps an elapsed request deadline in a typed timeout error", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test",
    timeoutMs: 5,
    maxRetries: 0,
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
  });
  await assert.rejects(media.jobs.get("job_123"), MediaRuntimeTimeoutError);
});

test("uploads and confirms an account watermark logo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mediaruntime-watermark-"));
  const path = join(directory, "logo.png");
  await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  let confirmBody;
  try {
    const media = new MediaRuntime({
      apiKey: "sk_test",
      fetch: async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith("/watermark-logo/upload-url")) {
          return json({
            upload_url: "https://storage.example.test/logo",
            file_uri: "gs://output-bucket/account-assets/acc_1/watermark-logo.png",
            upload_headers: { "Content-Type": "image/png" },
          });
        }
        if (url === "https://storage.example.test/logo") {
          await new Response(init.body).arrayBuffer();
          return new Response("", { status: 200 });
        }
        if (url.endsWith("/watermark-logo/confirm")) {
          confirmBody = JSON.parse(init.body);
          return json({
            logo_url: confirmBody.file_uri,
            position: confirmBody.position,
            opacity_pct: confirmBody.opacity_pct,
            scale_pct: confirmBody.scale_pct,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    const logo = await media.watermarkLogo.upload(path, {
      position: "top_right",
      opacityPct: 75,
      scalePct: 20,
    });
    assert.equal(logo.position, "top_right");
    assert.equal(logo.opacityPct, 75);
    assert.deepEqual(confirmBody, {
      file_uri: "gs://output-bucket/account-assets/acc_1/watermark-logo.png",
      position: "top_right",
      opacity_pct: 75,
      scale_pct: 20,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
