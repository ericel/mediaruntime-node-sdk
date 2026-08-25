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
  MediaRuntimeApiError,
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
    source: "https://cdn.example.test/video.mp4",
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

test("serializes animated image controls to the gateway wire contract", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_animation", status: "queued", tier: "premium", msg: "accepted" });
    },
  });

  await media.jobs.create({
    source: "https://cdn.example.test/clip.mp4",
    outputs: [{
      type: "image",
      preset: "image_animated_webp_v1",
      animation: {
        width: 720,
        fps: 15,
        startTime: 1,
        duration: 6,
        loop: 0,
        quality: 80,
      },
    }],
  });

  assert.deepEqual(captured.outputs[0].animation, {
    width: 720,
    fps: 15,
    start_time: 1,
    duration: 6,
    loop: 0,
    quality: 80,
  });
});

test("serializes portable placeholder controls to the gateway wire contract", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_placeholders", status: "queued", tier: "standard", msg: "accepted" });
    },
  });

  await media.jobs.create({
    source: "https://cdn.example.test/poster.png",
    outputs: [{
      type: "image",
      preset: "image_placeholders_v1",
      placeholders: {
        maxDimension: 48,
        sourceTimeSec: 1.25,
        lqipQuality: 42,
        lqipMaxBytes: 2048,
      },
    }],
  });

  assert.deepEqual(captured.outputs[0].placeholders, {
    max_dimension: 48,
    source_time_sec: 1.25,
    lqip_quality: 42,
    lqip_max_bytes: 2048,
  });
});

test("serializes hard JPG/WebP rendition byte ceilings", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_exact_image_size", status: "queued", tier: "standard", msg: "accepted" });
    },
  });

  await media.jobs.create({
    source: "https://cdn.example.test/poster.png",
    outputs: [{
      type: "image",
      preset: "image_multi_v1",
      images: [{
        width: 1280,
        height: 720,
        mode: "cover",
        format: "webp",
        quality: 86,
        maxBytes: 200000,
        minQuality: 35,
      }],
    }],
  });

  assert.deepEqual(captured.outputs[0].images, [{
    width: 1280,
    height: 720,
    mode: "cover",
    format: "webp",
    quality: 86,
    max_bytes: 200000,
    min_quality: 35,
  }]);
});

test("serializes contact-sheet controls to the gateway wire contract", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_contact_sheet", status: "queued", tier: "standard", msg: "accepted" });
    },
  });

  await media.jobs.create({
    source: "https://cdn.example.test/clip.mp4",
    outputs: [{
      type: "frames",
      preset: "contact_sheet_v1",
      contactSheet: {
        columns: 5,
        rows: 4,
        tileWidth: 240,
        tileHeight: 135,
        intervalSec: 12,
        startTimeSec: 3,
        durationSec: 120,
        maxSheets: 3,
        format: "webp",
        quality: 76,
      },
    }],
  });

  assert.deepEqual(captured.outputs[0].contact_sheet, {
    columns: 5,
    rows: 4,
    tile_width: 240,
    tile_height: 135,
    interval_sec: 12,
    start_time_sec: 3,
    duration_sec: 120,
    max_sheets: 3,
    format: "webp",
    quality: 76,
  });
});

test("serializes audiogram asset and composition controls to the gateway wire contract", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_audiogram", status: "queued", tier: "premium", msg: "accepted" });
    },
  });

  await media.jobs.create({
    source: "https://cdn.example.test/episode.mp3",
    outputs: [{
      type: "social",
      preset: "audiogram_v1",
      audiogram: {
        artworkSource: "https://cdn.example.test/cover.png",
        captionsSource: "https://cdn.example.test/captions.vtt",
        layout: "portrait",
        artworkFit: "blurred_background",
        backgroundColor: "#102030",
        waveformColor: "#abcdef",
        waveformGain: 2.5,
        startTimeSec: 2,
        durationSec: 45,
        fps: 24,
        burnCaptions: true,
        captionPosition: "bottom",
        captionFontScale: 1.1,
        normalizeAudio: true,
        loudnessTargetLufs: -18,
      },
    }],
  });

  assert.deepEqual(captured.outputs[0].audiogram, {
    artwork_source: "https://cdn.example.test/cover.png",
    captions_source: "https://cdn.example.test/captions.vtt",
    layout: "portrait",
    artwork_fit: "blurred_background",
    background_color: "#102030",
    waveform_color: "#abcdef",
    waveform_gain: 2.5,
    start_time_sec: 2,
    duration_sec: 45,
    fps: 24,
    burn_captions: true,
    caption_position: "bottom",
    caption_font_scale: 1.1,
    normalize_audio: true,
    loudness_target_lufs: -18,
  });
});

test("serializes bounded privacy-redaction controls to the gateway wire contract", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_privacy", status: "queued", tier: "premium", msg: "accepted" });
    },
  });

  await media.jobs.create({
    source: "https://cdn.example.test/people.mp4",
    outputs: [{
      type: "mp4",
      preset: "mp4_720p_h264_aac",
      privacyRedaction: {
        detectors: ["face", "license_plate", "text"],
        style: "pixelate",
        failureMode: "fail_closed",
        minConfidence: 0.72,
        sampleIntervalSec: 1.5,
        maxFrames: 24,
        boxPaddingRatio: 0.2,
        solidColor: "#102030",
        pixelBlockSize: 32,
        privacyStrength: "strong",
        includeDebugObservations: true,
      },
    }],
  });

  assert.deepEqual(captured.outputs[0].privacy_redaction, {
    detectors: ["face", "license_plate", "text"],
    style: "pixelate",
    failure_mode: "fail_closed",
    min_confidence: 0.72,
    sample_interval_sec: 1.5,
    max_frames: 24,
    box_padding_ratio: 0.2,
    solid_color: "#102030",
    pixel_block_size: 32,
    privacy_strength: "strong",
    include_debug_observations: true,
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

test("submits a hosted recipe without inline processing overrides and preserves its acknowledgement", async () => {
  let captured;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({
        job_id: "job_recipe",
        status: "queued",
        recipe: {
          name: "web-video",
          version: 1,
          reference: "web-video@1",
          built_in: true,
          sha256: "a".repeat(64),
        },
      });
    },
  });

  const job = await media.jobs.create({
    source: "https://cdn.example.test/video.mp4",
    recipe: "web-video",
  });

  assert.deepEqual(captured, {
    source: "https://cdn.example.test/video.mp4",
    recipe: "web-video",
  });
  assert.equal(job.recipe.reference, "web-video@1");
  assert.equal(job.recipe.builtIn, true);
  await assert.rejects(
    media.jobs.create({
      source: "https://cdn.example.test/video.mp4",
      recipe: "web-video",
      outputs: ["video.web"],
    }),
    ValidationError,
  );
});

test("manages immutable hosted recipes and maps nested template options ergonomically", async () => {
  const calls = [];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push([init.method, url.pathname, body]);
      if (init.method === "GET" && url.pathname === "/v1/recipes") {
        return json({ recipes: [{
          name: "web-video", version: 1, reference: "web-video@1",
          description: "Web-ready", built_in: true, status: "active", sha256: "a".repeat(64),
        }] });
      }
      if (init.method === "DELETE") {
        return json({ name: "team-video", status: "archived", latest_version: 2 });
      }
      const version = url.pathname.endsWith("/versions") || url.pathname.endsWith("/versions/2") ? 2 : 1;
      return json({
        name: "team-video",
        version,
        reference: `team-video@${version}`,
        description: "Team default",
        built_in: false,
        status: "active",
        sha256: "b".repeat(64),
        template: { outputs: [{
          type: "mp4",
          video: { bitrate_bps: 2_000_000, two_pass: true },
          subtitles: { translate_to_english: true, max_audio_minutes: 30 },
        }] },
      }, init.method === "POST" ? 201 : 200);
    },
  });

  assert.equal((await media.recipes.list())[0].reference, "web-video@1");
  const created = await media.recipes.create({
    name: "team-video",
    description: "Team default",
    template: { outputs: [{ type: "mp4", video: { bitrateBps: 2_000_000, twoPass: true } }] },
  });
  const second = await media.recipes.createVersion("team-video", {
    expectedLatestVersion: 1,
    template: { outputs: ["video.streaming"] },
  });
  const fetched = await media.recipes.get("team-video", { version: 2 });
  await media.recipes.archive("team-video");

  assert.equal(created.template.outputs[0].video.bitrateBps, 2_000_000);
  assert.equal(created.template.outputs[0].video.twoPass, true);
  assert.equal(second.version, 2);
  assert.equal(fetched.template.outputs[0].subtitles.translateToEnglish, true);
  assert.deepEqual(calls[1], ["POST", "/v1/recipes", {
    name: "team-video",
    description: "Team default",
    template: { outputs: [{ type: "mp4", video: { bitrate_bps: 2_000_000, two_pass: true } }] },
  }]);
  assert.deepEqual(calls.at(-1).slice(0, 2), ["DELETE", "/v1/recipes/team-video"]);
});

test("recovers from response loss and an in-progress replay with one generated key", async () => {
  const acceptedJobs = new Map();
  const keys = [];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 2,
    fetch: async (_input, init) => {
      const key = new Headers(init.headers).get("idempotency-key");
      keys.push(key);
      if (keys.length === 1) {
        acceptedJobs.set(key, "job_accepted");
        throw new TypeError("response lost after acceptance");
      }
      if (keys.length === 2) {
        return json({
          error: {
            code: "idempotency_in_progress",
            message: "A request with this Idempotency-Key is still in progress",
            retryable: true,
          },
        }, 409, { "Retry-After": "0" });
      }
      return json({
        job_id: acceptedJobs.get(key),
        status: "QUEUED",
        tier: "standard",
        msg: "replayed",
      });
    },
  });
  const job = await media.jobs.create({
    source: "https://cdn.example.test/video.mp4",
    outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
  });
  assert.equal(job.id, "job_accepted");
  assert.equal("idempotencyKey" in job.toJSON(), false);
  assert.equal(acceptedJobs.size, 1);
  assert.equal(keys.length, 3);
  assert.match(keys[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(keys.every((key) => key === keys[0]));
});

test("creates a fresh generated key for each later create invocation", async () => {
  const keys = [];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async (_input, init) => {
      keys.push(new Headers(init.headers).get("idempotency-key"));
      return json({ job_id: `job_${keys.length}`, status: "QUEUED", tier: "standard", msg: "accepted" });
    },
  });
  const params = {
    source: "https://cdn.example.test/video.mp4",
    outputs: ["video.web"],
  };
  await media.jobs.create(params);
  await media.jobs.create(params);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("caller-provided idempotency key wins and is reused for retries", async () => {
  let calls = 0;
  const keys = [];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 2,
    fetch: async (_input, init) => {
      calls += 1;
      keys.push(new Headers(init.headers).get("idempotency-key"));
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
  assert.deepEqual(keys, ["video:123:v1", "video:123:v1"]);
});

test("generated key is reused across 5xx and 429 retries", async () => {
  const keys = [];
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 2,
    fetch: async (_input, init) => {
      keys.push(new Headers(init.headers).get("idempotency-key"));
      if (keys.length === 1) return json({ detail: "temporary" }, 503, { "Retry-After": "0" });
      if (keys.length === 2) return json({ detail: "slow down" }, 429, { "Retry-After": "0" });
      return json({ job_id: "job_retry", status: "QUEUED", tier: "standard", msg: "accepted" });
    },
  });
  const job = await media.jobs.create({
    source: "https://cdn.example.test/video.mp4",
    outputs: ["video.web"],
  });
  assert.equal(job.id, "job_retry");
  assert.equal(keys.length, 3);
  assert.ok(keys.every((key) => key === keys[0]));
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

test("does not retry an idempotency fingerprint conflict", async () => {
  let calls = 0;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 3,
    fetch: async () => {
      calls += 1;
      return json({
        error: {
          code: "idempotency_conflict",
          message: "Idempotency-Key was already used with a different request body",
          retryable: false,
        },
      }, 422);
    },
  });
  await assert.rejects(
    media.jobs.create({
      source: "https://cdn.example.test/video.mp4",
      outputs: ["video.web"],
      idempotencyKey: "video:123:v1",
    }),
    IdempotencyConflictError,
  );
  assert.equal(calls, 1);
});

test("does not misclassify or retry an unrelated create-job 409", async () => {
  let calls = 0;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 3,
    fetch: async () => {
      calls += 1;
      return json({ detail: { message: "Sandbox session already has an active job." } }, 409);
    },
  });
  await assert.rejects(
    media.jobs.create({
      source: "https://cdn.example.test/video.mp4",
      outputs: ["video.web"],
    }),
    (error) => error instanceof MediaRuntimeApiError && !(error instanceof IdempotencyInProgressError),
  );
  assert.equal(calls, 1);
});

test("does not retry terminal validation failures even with a generated key", async () => {
  let calls = 0;
  const media = new MediaRuntime({
    apiKey: "sk_test",
    maxRetries: 3,
    fetch: async () => {
      calls += 1;
      return json({
        error: {
          code: "validation_error",
          message: "source is invalid",
          retryable: false,
          details: [{ loc: ["body", "source"], msg: "invalid", type: "value_error" }],
        },
      }, 422);
    },
  });
  await assert.rejects(
    media.jobs.create({
      source: "https://cdn.example.test/video.mp4",
      outputs: ["video.web"],
    }),
    ValidationError,
  );
  assert.equal(calls, 1);
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
    assert.equal(JSON.parse(calls[2].init.body).source, "gs://input-bucket/opaque/sample.mp4");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("uses caption MIME types for local Audiogram SRT and VTT uploads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mediaruntime-captions-"));
  const srt = join(directory, "episode.srt");
  const vtt = join(directory, "episode.vtt");
  await writeFile(srt, "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
  await writeFile(vtt, "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n");
  const requested = [];
  try {
    const media = new MediaRuntime({
      apiKey: "sk_test",
      fetch: async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith("/v1/upload-url")) {
          const body = JSON.parse(init.body);
          requested.push(body);
          return json({
            upload_url: `https://storage.example.test/${body.filename}`,
            file_uri: `gs://input-bucket/${body.filename}`,
            upload_headers: { "Content-Type": body.content_type },
          });
        }
        if (url.startsWith("https://storage.example.test/")) {
          await new Response(init.body).arrayBuffer();
          return new Response("", { status: 200 });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    await media.uploads.uploadFile(srt);
    await media.uploads.uploadFile(vtt);
    assert.deepEqual(requested, [
      { filename: "episode.srt", content_type: "application/x-subrip" },
      { filename: "episode.vtt", content_type: "text/vtt" },
    ]);
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
        public_presets: ["webm_vp9_1080p"],
        presets: {
          webm_vp9_1080p: {
            output_type: "webm",
            source_kinds: ["video"],
            base_tier: "premium",
            description: "VP9 WebM",
            artifacts: ["VP9 WebM"],
            codec: "vp9",
          },
        },
        features: {
          moderation: { rejection_status: "REJECTED" },
        },
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
  assert.deepEqual(result.publicPresets, ["webm_vp9_1080p"]);
  assert.equal(result.outputAliases["video.web"].preset, "mp4_720p_h264_aac");
  assert.equal(result.presets.webm_vp9_1080p.outputType, "webm");
  assert.equal(result.presets.webm_vp9_1080p.codec, "vp9");
  assert.equal(result.features.moderation.rejection_status, "REJECTED");
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

test("covers list, moderation, reports, and manual webhook retry projections", async () => {
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
      if (url.pathname.endsWith("/compatibility-report")) {
        return json({
          job_id: "job_1",
          report: { rule_set: { version: "2026-08-20" }, profiles: [] },
          download_url: null,
          note: null,
        });
      }
      if (url.pathname.endsWith("/codes")) {
        return json({
          job_id: "job_1",
          report: {
            payload_is_untrusted: true,
            detections: [{ decoded_text: "<b>inert</b>", confidence: null }],
          },
          download_url: null,
          note: null,
        });
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
  const compatibility = await media.jobs.getCompatibilityReport("job_1");
  assert.equal(compatibility.report.rule_set.version, "2026-08-20");
  const codes = await media.jobs.getCodeDetections("job_1");
  assert.equal(codes.report.payload_is_untrusted, true);
  assert.equal(codes.report.detections[0].decoded_text, "<b>inert</b>");
  const retried = await media.jobs.retryWebhook("job_1");
  assert.equal(retried.httpStatus, 204);
});

test("rejects an empty job id before making a request", async () => {
  const media = new MediaRuntime({
    apiKey: "sk_test",
    fetch: async () => { throw new Error("must not run"); },
  });
  await assert.rejects(media.jobs.getModeration("  "), ValidationError);
  await assert.rejects(media.jobs.getCompatibilityReport("  "), ValidationError);
  await assert.rejects(media.jobs.getCodeDetections("  "), ValidationError);
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
