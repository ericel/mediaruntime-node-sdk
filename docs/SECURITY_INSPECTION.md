# File inspection and application policy

File inspection uses the existing jobs API and requires account enablement and a
configured paid Standard/Premium tariff. It is not publicly enabled by this SDK
change. Disabled requests fail explicitly; the SDK never substitutes an ordinary
processing job. Run application acceptance decisions on your backend.

```js
import { MediaRuntime, evaluateFileReport } from '@mediaruntime/node';

const client = new MediaRuntime({ apiKey: process.env.MEDIARUNTIME_API_KEY });
const options = { enabled: true, tier: 'standard', maxInputBytes: 20 * 1024 * 1024 };
const quote = await client.jobs.estimateSecurity(options);
// Present quote.quotedAmountCents and the inspection billing terms for approval.
const job = await client.jobs.create({
  source: './upload.png', outputs: [],
  security: { ...options, pricingVersion: quote.pricingVersion,
    maxChargeCents: quote.quotedAmountCents },
});
try { await job.wait(); } catch { /* Failed/rejected jobs can still have reports. */ }
const result = await client.jobs.getSecurityReport(job.id);
const decision = evaluateFileReport(result, {
  allowedFormats: ['png', 'jpg'], requireDeepValidation: false,
  maxScanAgeSeconds: 3600,
});
if (!decision.accepted) console.log(decision.reasons);
```

Use the same explicit `idempotencyKey` when retrying a submission after an ambiguous
response. Local files use the dedicated quarantined upload path. Inspection quotes
do not download or parse media. The API reports observations; it does not receive
your format allowlist or return an application acceptance verdict. `COMPLETED`
means the job produced a report, including reports with threats or incomplete
coverage. No result guarantees that a file is safe.

`getSecurityReport` returns a typed pending/available envelope. Reports remain
available for owned failed/rejected jobs. Foreign and unrequested reports return
404; expired reports return 410. Job details expose `security.reportExpired` and
separate `inspectionQuote`/`inspectionBilling`. Do not log source or signed URLs.

The policy helper rejects unknown report/profile versions, missing identity,
ambiguous identification, known threat findings and missing required evidence.
Complete inspection, valid structure and malware evidence are required by default.
`jpg`/`jpeg`, `wave`/`wav`, `m4a`/`mp4` and `mkv`/`matroska` are aliases of detected
formats, not trusted filename extensions. Stable reasons describe rejection.

For ZIP applications use `allowedFormats: ['zip']` and
`archiveEntryFormats: ['png', 'jpg']`. An all-entry rule requires complete,
untruncated entry evidence and checks every entry; encrypted entries, unsupported
compression and exhausted entry/depth/expansion limits cannot satisfy it. Stored
and DEFLATE ZIP entries are supported. Archive-contained paths and URLs are never
used as extraction destinations or fetched as resources.

In report version 1, API `entries_inspected` (SDK `entriesInspected`) means
**non-directory entries attempted**, including entries rejected before decompression,
identification or malware scanning. Counts include visited nested archives. It does
not mean fully inspected or safe entries. `entries_total` counts entries discovered
in archives visited; deeper contents may remain unknown when traversal stops.
For one corrupt entry, `entries_total: 1`, `entries_inspected: 1` and
`entries_complete: false` means one attempt, not one successful content inspection.
Likewise, an archive check with `result: 'inspected'` describes the inspection
attempt; always read its `complete` flag and per-entry checks. Equality of the
counts is never evidence of complete coverage, and the bounded `entries` list
cannot be used to infer a full-inspection count when `entries_truncated` is true.
New reports additionally expose `entries_attempted` / `entriesAttempted` and
`entries_fully_inspected` / `entriesFullyInspected`. The latter counts entries
whose requested checks all finished, including checks with negative results;
it is not a count of safe files. Older reports omit these fields (or use null),
which means unknown, not zero. Counts include visited nested entries.

A ZIP whose entries cannot all be inspected has `inspectionStatus: 'incomplete'`.
Its deep-validation result is `not_validated`, with `coverage: 'zip_entries'` and
`complete: false`; this does not claim a successful full decode. A completed
submitted-file antivirus scan may report `no_threat_detected`, but when archive
coverage is incomplete it uses `coverage: 'antivirus_partial'`, `complete: false`.
This means no threat was detected in the scan performed, not that every entry was
scanned. The default policy rejects this report; `requireCompleteInspection: true`
and `requireValidStructure: true` also reject older ambiguous reports. Inspect
per-entry evidence when applying an archive-entry policy.

`archive_crc_mismatch` means the ZIP reader explicitly reported a CRC-32
validation failure for an entry. `archive_decompression_failed` identifies a DEFLATE decoder error;
`archive_structure_invalid` identifies invalid ZIP structure/header/directory
errors. Unclassified failures remain `malformed_data`.
The code does not mean the embedded media itself is malformed or malware was found.
Use `evaluateFileReport` on your backend rather than accepting a file merely
because `checks.malware.result` is `no_threat_detected`; partial coverage is rejected
by the default malware policy with `malware_evidence_missing`.

Still PNG/JPEG/WebP support structural checks and Premium full decoding. Bounded
MP4/MOV/WebM/Matroska and MP3/WAV/FLAC/Ogg/AAC support metadata validation and
Premium full decoding with supported codecs. Animated images, GIF/BMP/TIFF/AVIF,
documents, executables, SVG/HTML, manifests and other archives have no complete
validation adapter; recognition or antivirus scanning does not change that.
Codec, resource and decode limits are explicit incomplete coverage.

Opt-in sanitization uses Premium with `deepValidation: true` and
`sanitization: 'png'` or `'jpeg'` in inspection-only mode. It re-encodes supported
still images into fresh RGB pixels, applies orientation, and removes metadata;
alpha is not preserved. The derivative is bounded to 4 MiB, independently scanned
and decoded, and carries source/derivative hashes and recipe lineage. Require
`requireSanitizedDerivative: true` in your policy before calling
`getSecurityDerivative(job.id)` for its short-lived attachment URL. Unsupported
formats are reported explicitly. A supported image that fails structural validation
skips sanitization with `status: 'not_run'`, `reason: 'structural_validation_failed'`.
A failed full decode uses `deep_validation_failed`; incomplete prerequisite checks
use `short_circuit`. These produce no derivative and do not mean PNG/JPEG/WebP is
an unsupported format. The original is never exposed by this endpoint.

Optional processing uses `mode: 'enforce'` with supported output requests and a
separate account feature flag. MediaRuntime applies its own server-side admission
policy before ordinary media estimation. Processing consumes the approved
immutable bytes with the same job ID. SDK acceptance cannot bypass this policy.
Batch, recipe, moderation, watermark and audiogram combinations are unsupported
in this lane. HLS/DASH output support remains available; remote manifest input
restrictions remain in force.

Inspection reserves the quoted maximum and settles the actual input size band.
Completed negative findings and documented content limits are billable. Failed
ingestion, exhausted provider retries, and cancellation before a durable assessment
release the inspection reservation. `cancelSecurityInspection(job.id)` cannot
cancel processing after inspection settlement. Combined jobs reserve and bill
transformation separately after admission; insufficient transformation funds
preserve the inspection report and its charge. There is no free inspection tier,
silent upgrade or charge above the accepted quote.


PNG CRC diagnostics use `png_chunk_crc_mismatch` only when the isolated inspector
computes CRC-32 over the chunk type and complete data and finds a mismatch with
the stored checksum. Optional `chunk` (four ASCII letters) and `message` fields
identify the failure; they are retained by the SDK. This is independent of the
filename and decoder error text. A correct CRC does not establish valid pixel
content. Truncated chunks and decode failures remain separate malformed-data
findings. CRC traversal is bounded by input size, 4096 chunks and two seconds;
exceeding a bound reports incomplete coverage with `policy_limit`.
