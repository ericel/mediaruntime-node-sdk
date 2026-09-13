# Assisted clipping

Requires SDK `1.4.0` or newer and the matching deployed gateway/engine. Confirm
that the API capability catalog includes both clipping presets before submitting jobs.

Both stages use ordinary asynchronous jobs. Candidate analysis is Premium; rendering
is Standard. The engine uses its existing Whisper model when no transcript is supplied.

```ts
import { MediaRuntime } from "@mediaruntime/node";

const media = new MediaRuntime({ apiKey: process.env.MEDIARUNTIME_API_KEY });
// Retain this stable source reference with the plan. Do not save an expiring URL.
const source = "https://your-cdn.example/episode.mp4";
const analysis = await media.jobs.create({ source, outputs: [{
  type: "frames", preset: "clip_candidates_v1",
  clipAnalysis: { minDurationSec: 15, maxDurationSec: 60, maxCandidates: 5 },
}] });
const analyzed = await analysis.wait();
if (analyzed.status !== "COMPLETED") throw new Error(`Analysis ${analyzed.status}`);
const plan = await media.jobs.getClipCandidates(analysis.id);
// Present candidates for human review. A score is a heuristic, not predicted engagement.
const selected = plan.candidates[0];
if (!selected) {
  console.log("No suggestions:", plan.emptyReason ?? "No reason in this older report");
  // Stop this automatic render path; plan.transcript remains usable for manual clips.
  process.exit(0);
}

const render = await media.jobs.create({ source, outputs: [{
  type: "mp4", preset: "video_clip_v1", clip: {
    startTimeSec: selected.startTimeSec,
    durationSec: selected.durationSec,
    layout: "vertical_blur", // or original
    burnCaptions: true,
    // Keep SOURCE timestamps. The engine intersects and rebases cues for this render.
    transcript: plan.transcript.filter((segment) =>
      segment.endTimeSec > selected.startTimeSec &&
      segment.startTimeSec < selected.startTimeSec + selected.durationSec),
  },
}] });
const rendered = await render.wait();
if (rendered.status !== "COMPLETED") throw new Error(`Render ${rendered.status}`);
console.log(rendered.bundle.downloadUrl); // Short-lived URL for the complete ZIP.
```

The bundle contains `clip.mp4`, a poster and SRT/VTT when a transcript overlaps the
range. Rendering supplied text never triggers another transcription pass. Render
ranges must remain within the source and last 0.1–300 seconds. Suggestions may be
empty for silence, unmatched keywords or passages shorter than the requested minimum.
Captions use segments, not word-level animation; vertical framing is blur-fill,
without face or speaker tracking.

Original framing is capped at a 1920-pixel long edge and 30 fps; vertical blur-fill
uses 720×1280 at up to 30 fps within the Standard preset.

## Manual clips and caption reuse

A manual `video_clip_v1` output needs only a source, a nonnegative start, and a
0.1–300 second duration fully inside the source. It does not run Whisper. Captions
are optional: set burn captions only when supplying overlapping transcript segments.
Supplied transcripts produce SRT/VTT sidecars even when burn captions is false.

Candidate analysis automatically uses the existing Whisper model when its transcript
is absent or empty. A nonempty supplied transcript skips Whisper, but analysis still
requires Premium processing. The SDK accepts parsed segment arrays; it does not load
SRT/VTT files or cloud transcript paths into those arrays automatically. All timestamps
must refer to the original source, not the trimmed clip, and the same source must be
used for analysis and render. Do not rebase cues before submission.

The public Sandbox is limited to its enabled presets and fixtures; Premium candidate
analysis is unavailable there. Use an authorized workspace/API key for analysis.

## Empty analysis results

An empty candidates array is a successful analysis outcome, not a failed render.
`emptyReason` explains it when available; older reports return `null`.

| Reason | Meaning and next step |
| --- | --- |
| `no_speech` | No usable spoken transcript was found. Choose a manual range or supply a transcript. |
| `no_keyword_match` | No transcript passages matched the keywords. Change/remove keywords. |
| `no_matching_ranges` | Transcript passages did not satisfy the requested ranges. Adjust duration bounds. |
| `source_too_short` | The minimum exceeded source duration. Lower it; current preflight rejects this before processing. |

A nonempty transcript can still caption a manual clip even when no suggestions match.
Keep the report source reference alongside it. Treat ranking scores as transcript
heuristics, not predictions of virality or engagement.
