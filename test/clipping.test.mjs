import assert from "node:assert/strict";
import { test } from "node:test";
import { MediaRuntime } from "../dist/index.js";

test("retrieved candidate transcript renders with original source timestamps", async () => {
  let body;
  const media = new MediaRuntime({
    apiKey: "test",
    fetch: async (url, options) => {
      if (options.method === "GET") {
        assert.match(String(url), /\/jobs\/job_plan\/clip-candidates$/);
        return Response.json({
          schema_version: 1, source_duration_sec: 120,
          method: "transcript_heuristics_v1", transcript_source: "supplied",
          transcript: [{ start_time_sec: 31, end_time_sec: 34, text: "Keep_My Case." }],
          candidates: [{ id: "clip_1", start_time_sec: 30, duration_sec: 20,
            text: "Keep_My Case.", score: 0.8, reasons: ["keyword_match"] }],
        });
      }
      body = JSON.parse(options.body);
      return Response.json({ job_id: "job_render", status: "QUEUED", tier: "standard" });
    },
  });
  const plan = await media.jobs.getClipCandidates("job_plan");
  assert.equal(plan.schemaVersion, 1);
  const selected = plan.candidates[0];
  await media.jobs.create({ source: "https://example.test/episode.mp4", outputs: [{
    type: "mp4", preset: "video_clip_v1", clip: {
      startTimeSec: selected.startTimeSec + 0.5, durationSec: selected.durationSec,
      layout: "vertical_blur", burnCaptions: true, transcript: plan.transcript,
    },
  }] });
  assert.deepEqual(body.outputs[0].clip, {
    start_time_sec: 30.5, duration_sec: 20, layout: "vertical_blur", burn_captions: true,
    transcript: [{ start_time_sec: 31, end_time_sec: 34, text: "Keep_My Case." }],
  });
});

test("analysis serializes duration and keyword controls", async () => {
  let body;
  const media = new MediaRuntime({ apiKey: "test", fetch: async (_url, options) => {
    body = JSON.parse(options.body);
    return Response.json({ job_id: "job_plan", status: "QUEUED", tier: "premium" });
  } });
  await media.jobs.create({ source: "https://example.test/episode.mp4", outputs: [{
    type: "frames", preset: "clip_candidates_v1", clipAnalysis: {
      minDurationSec: 10, maxDurationSec: 30, maxCandidates: 3, keywords: ["API"],
    },
  }] });
  assert.deepEqual(body.outputs[0].clip_analysis, {
    min_duration_sec: 10, max_duration_sec: 30, max_candidates: 3, keywords: ["API"],
  });
});

function validPlan() {
  return {
    schema_version: 1, source_duration_sec: 120,
    method: "transcript_heuristics_v1", transcript_source: "supplied",
    transcript: [{ start_time_sec: 30, end_time_sec: 35, text: "Reviewed text." }],
    candidates: [{ id: "clip_1", start_time_sec: 30, duration_sec: 20,
      text: "Reviewed text.", score: 0.8, reasons: ["keyword_match"] }],
  };
}

const invalidPlans = [
  ["unknown version", (plan) => { plan.schema_version = 2; }],
  ["missing version", (plan) => { delete plan.schema_version; }],
  ["nonfinite duration", (plan) => { plan.source_duration_sec = Infinity; }],
  ["wrong timeline type", (plan) => { plan.transcript[0].start_time_sec = "30"; }],
  ["reversed cue", (plan) => { plan.transcript[0].end_time_sec = 29; }],
  ["unordered cues", (plan) => { plan.transcript.push({ start_time_sec: 20, end_time_sec: 25, text: "Earlier" }); }],
  ["cue past source", (plan) => { plan.transcript[0].end_time_sec = 121; }],
  ["multibyte text bound", (plan) => { plan.transcript[0].text = "가".repeat(667); }],
  ["aggregate text bound", (plan) => { plan.transcript = Array.from({ length: 140 }, () => ({ start_time_sec: 0, end_time_sec: 1, text: "x".repeat(2000) })); }],
  ["too many cues", (plan) => { plan.transcript = Array(2001).fill(plan.transcript[0]); }],
  ["too many candidates", (plan) => { plan.candidates = Array(21).fill(plan.candidates[0]); }],
  ["candidate past source", (plan) => { plan.candidates[0].duration_sec = 100; }],
  ["invalid reasons", (plan) => { plan.candidates[0].reasons = [42]; }],
  ["null cues", (plan) => { plan.transcript = null; }],
  ["invalid score", (plan) => { plan.candidates[0].score = -1; }],
];
for (const [name, corrupt] of invalidPlans) {
  test(`clip plan decoder rejects ${name}`, async () => {
    const plan = validPlan(); corrupt(plan);
    const media = new MediaRuntime({ apiKey: "test", fetch: async () => Response.json(plan) });
    await assert.rejects(media.jobs.getClipCandidates("job_plan"), (error) => {
      assert.equal(error.name, "ValidationError");
      assert.equal(error.code, "invalid_clip_plan");
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes("Reviewed text"));
      return true;
    });
  });
}

test("empty candidate plan and source-rounded overlapping cues are valid", async () => {
  const plan = validPlan();
  plan.candidates = [];
  plan.transcript = [
    { start_time_sec: 115, end_time_sec: 119, text: "First." },
    { start_time_sec: 118, end_time_sec: 120.05, text: "Second." },
  ];
  plan.internal_path = "/private/worker";
  const media = new MediaRuntime({ apiKey: "test", fetch: async () => Response.json(plan) });
  const result = await media.jobs.getClipCandidates("job_plan");
  assert.equal(result.transcript[1].endTimeSec, 120.05);
  assert.deepEqual(result.candidates, []);
  assert.ok(!("internal_path" in result));
  plan.transcript = [];
  assert.deepEqual((await media.jobs.getClipCandidates("job_plan")).transcript, []);
});

for (const emptyReason of [null, "no_speech", "no_keyword_match", "no_matching_ranges", "source_too_short"]) {
  test(`preserves empty analysis reason ${emptyReason}`, async () => {
    const plan = { ...validPlan(), candidates: [], empty_reason: emptyReason };
    const media = new MediaRuntime({ apiKey: "test", fetch: async () => Response.json(plan) });
    const result = await media.jobs.getClipCandidates("job_plan");
    assert.equal(result.emptyReason, emptyReason);
    // Even without suggestions the source transcript remains reusable for manual clips.
    assert.equal(result.transcript[0].startTimeSec, 30);
  });
}

test("older reports omit empty_reason without breaking consumers", async () => {
  const media = new MediaRuntime({ apiKey: "test", fetch: async () => Response.json(validPlan()) });
  assert.equal((await media.jobs.getClipCandidates("job_plan")).emptyReason, null);
});

for (const reason of ["unknown_reason", "", 0, false, [], { text: "PRIVATE TRANSCRIPT" }]) {
  test(`invalid empty reason container ${JSON.stringify(reason)}`, async () => {
    const media = new MediaRuntime({ apiKey: "test", fetch: async () => Response.json({
      ...validPlan(), candidates: [], empty_reason: reason,
    }) });
    await assert.rejects(media.jobs.getClipCandidates("job_plan"), (error) => {
      assert.equal(error.code, "invalid_clip_plan");
      assert.equal(error.field, "clip_candidates.empty_reason");
      assert.ok(!error.message.includes("PRIVATE TRANSCRIPT"));
      return true;
    });
  });
}
