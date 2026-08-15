# MediaRuntime Node SDK — Software Design Document

Status: Milestone A implemented; beta publication prepared

Package: `@mediaruntime/node`

Repository: `mediaruntime-sdk`
Runtime: Node.js 20+

## 1. Purpose

The Node SDK reduces the MediaRuntime integration from a collection of HTTP, upload,
retry, polling, and webhook-security primitives to one coherent, typed API. It is an
ergonomic layer over the existing asynchronous data-plane contract; it does not move
validation, billing, tier, preset, or capability policy out of the gateway.

The first public release must make this path straightforward:

```ts
import { MediaRuntime } from "@mediaruntime/node";

const media = new MediaRuntime();
const job = await media.jobs.create({
  source: "./video.mp4",
  outputs: [{ type: "mp4", preset: "mp4_720p_h264_aac" }],
  idempotencyKey: "video:vid_123:v1",
});

const result = await job.wait({ timeoutMs: 300_000 });
```

## 2. Goals and non-goals

### Goals

- Provide a hand-written, idiomatic TypeScript surface over every current authenticated
  JSON endpoint. The binary bundle is consumed through the job-scoped `downloadUrl`
  returned by the status endpoint.
- Accept HTTP(S), `gs://`, and local-file sources. Local files use the signed-upload flow
  transparently and submit the returned opaque `file_uri`.
- Make job submission retry-safe: never replay an ambiguous submission unless the caller
  supplied an `Idempotency-Key`.
- Expose distinct typed errors for an idempotency claim in progress and for a key/body
  conflict.
- Provide capped exponential backoff with jitter for safe reads and idempotent submission.
- Provide `job.wait()` for scripts, tests, notebooks, and reconciliation tasks.
- Verify webhook HMAC signatures, timestamp tolerance, and exact raw bytes in one call.
- Ship types, ESM, and CommonJS from one package with no runtime dependencies.
- Keep gateway wire names private where practical and expose JavaScript-style camelCase.

### Non-goals for 0.1

- Output aliases and hosted recipes. The SDK will accept them additively once the gateway
  publishes them, but will not maintain a client-only alias table that can drift.
- Local webhook relay, CLI commands, or synthetic event delivery.
- Automatic webhook `event_id` deduplication; that requires the customer's datastore.
- Browser support. The package uses Node filesystem and cryptography APIs.
- Client-side replication of tier, billing, preset, or input-compatibility policy.
- Cancellation and retry endpoints that the gateway does not currently expose.

## 3. Source of truth

The current gateway implementation is authoritative:

- `transcoder-gateway-api/models/schemas.py` defines job and upload request/response shapes.
- `transcoder-gateway-api/routes/routes.py` defines the public `/v1` endpoint behavior.
- `transcoder-gateway-api/services/webhook.py` defines webhook signing.
- `GET /v1/capabilities` is the runtime source of compatibility rules.

The gateway currently accepts `file_url`, not `source`. The SDK exposes `source` and maps
it to `file_url`; this is a client projection, not a dependency on the proposed gateway
field alias.

An OpenAPI-based generated transport may replace parts of the hand-written wire layer
later. Public resource classes and method signatures remain hand-written because
ergonomics are the primary product requirement.

## 4. Public surface

```text
MediaRuntime
├── jobs
│   ├── create(params) -> Job
│   ├── get(jobId) -> JobDetails
│   ├── list(query) -> JobPage
│   ├── wait(jobId, options) -> JobDetails
│   ├── getModeration(jobId)
│   ├── getMediaReport(jobId)
│   └── retryWebhook(jobId)
├── uploads
│   ├── createTarget(filename, contentType)
│   └── uploadFile(path)
├── watermarkLogo
│   ├── createUploadTarget(contentType)
│   ├── confirm(params)
│   └── upload(path, options)
├── capabilities.retrieve()
└── webhooks
    ├── verify(rawBody, headers, options)
    └── express(handler)
```

`MediaRuntime` reads `MEDIARUNTIME_API_KEY`, `MEDIARUNTIME_API_URL`, and
`MEDIARUNTIME_WEBHOOK_SECRET` when explicit options are absent. Constructor injection of
`fetch` is supported for tests, controlled proxies, and instrumentation.

`jobs.create()` returns a `Job` receipt containing `id`, `status`, `tier`, `message`,
`refresh()`, and `wait()`. Detailed reads and list pages are plain typed data structures.

## 5. Request mapping

The SDK accepts camelCase input and explicitly maps it to the gateway's snake_case body.
It does not use a generic recursive case converter: metadata is opaque customer data and
must be sent byte-for-byte with its original keys.

```text
source                       -> file_url
inputs[].source              -> inputs[].file_url
webhookUrl                   -> webhook_url
output.pathSuffix            -> path_suffix
output.removeBg              -> remove_bg
output.smartCrop             -> smart_crop
output.posterTimeSec         -> poster_time_sec
output.posterFormat          -> poster_format
```

Nested first-party option fields are mapped explicitly. `metadata` and input metadata are
copied unchanged.

Exactly one of `source` and `inputs` is required. A request must contain at least one
output unless `moderation.enabled` is true. The gateway remains authoritative and may
perform stricter validation.

## 6. Local-file upload flow

For a source that is not an HTTP(S), `gs://`, or `file://` URL:

1. Resolve and validate the local file.
2. Call `POST /v1/upload-url` with its basename and inferred content type.
3. Stream the file to the signed URL with every returned `upload_headers` entry.
4. Submit the opaque returned `file_uri` as `file_url`.

`file://` URLs are converted with Node's URL utilities. Batch inputs run uploads
sequentially in 0.1 to avoid unbounded memory/file-descriptor pressure; bounded parallel
upload can be added after measurement.

## 7. Retry and timeout policy

Default transport timeout: 30 seconds per attempt. Default maximum retries: two after the
initial attempt.

Retryable failures are network errors, `429`, and `5xx`. Delay is capped exponential
backoff with jitter, honoring `Retry-After` when present.

| Operation | Automatic retry |
|---|---|
| `GET` capabilities/jobs/moderation/report | Yes |
| `POST /jobs` with `idempotencyKey` | Yes |
| `POST /jobs` without `idempotencyKey` | Never |
| Signed file `PUT` | Never in 0.1 |
| Watermark mutation or webhook retry | Never |

The final three operations are not safe reads. Silently replaying them can create extra
objects or webhook deliveries, so the broader roadmap statement that every non-submit
endpoint is safe to retry is intentionally narrowed here.

## 8. Error model

All SDK errors extend `MediaRuntimeError`.

- `MediaRuntimeApiError`: HTTP status, response headers, structured detail, and field.
- `AuthenticationError`: `401`.
- `PermissionDeniedError`: `403`.
- `NotFoundError`: `404`.
- `RateLimitError`: exhausted `429` response.
- `ValidationError`: `400`, `413`, or `422` validation failure.
- `IdempotencyInProgressError`: submit `409` with a caller key.
- `IdempotencyConflictError`: submit `422` identifying key/body reuse.
- `MediaRuntimeConnectionError`: network/transport failure.
- `MediaRuntimeTimeoutError`: request timeout.
- `JobWaitTimeoutError`: polling reached its deadline; contains the last observed job.
- `WebhookVerificationError`: malformed, stale, or invalid webhook signature/body.

Unknown gateway error bodies remain available through `details`; the SDK never discards
the server's diagnostic payload.

## 9. Webhook verification

Verification accepts `Buffer`, `Uint8Array`, or a UTF-8 string plus either `Headers` or a
Node header record. It:

1. Reads `X-Transcoder-Id`, `X-Transcoder-Timestamp`, and `X-Transcoder-Signature`.
2. Parses `t=<timestamp>,v1=<hex>` and requires the signature timestamp to equal the
   dedicated timestamp header.
3. Enforces a default absolute age of 300 seconds.
4. Computes HMAC-SHA256 over `timestamp + "." + event_id + "." + raw_body`.
5. Uses a constant-time byte comparison.
6. Parses and returns the typed JSON event only after signature verification.

The Express helper requires `req.body` to be raw bytes. It cannot repair an application
that registered `express.json()` first, so its error explains that ordering constraint.

## 10. Packaging and compatibility

- Package name: `@mediaruntime/node`.
- Node support: 20 and later.
- TypeScript source; declarations included.
- `tsup` produces ESM and CommonJS entry points.
- No runtime dependencies.
- Semver: additions are minor, signature/type removals are major, gateway enum additions
  are treated as compatible by allowing unknown status strings.

Package namespace ownership must be confirmed before the first public publish. Publishing
is outside this implementation task.

## 11. Observability and security

- API keys are sent only to the configured API base, never to signed upload URLs.
- Error messages never include API keys or webhook secrets.
- The SDK exposes a `userAgent` header and permits a diagnostic callback in a later
  release; 0.1 keeps the transport surface minimal.
- Response body size remains gateway-controlled. The SDK does not log bodies.
- Authenticated API calls reject redirects, preventing a custom `X-API-Key` header from
  following a response to another origin. Signed storage uploads may follow redirects
  because they never carry the MediaRuntime API key.

## 12. Test strategy

Unit tests use Node's built-in test runner and injected `fetch`; no live account is
required. Required coverage:

- constructor/environment validation and URL normalization;
- request mapping without mutating metadata keys;
- no retry for an unkeyed ambiguous job submission;
- retry for keyed submission and safe reads;
- typed API/idempotency errors;
- local upload header preservation and opaque URI submission;
- polling completion and timeout;
- webhook success, invalid signature, stale timestamp, and raw-body sensitivity;
- ESM and CommonJS package loading after build.

A separately credentialed integration suite against a non-production gateway is planned
before `1.0.0`; it is not run from ordinary package tests.

## 13. Delivery plan

### Milestone A — foundation (this implementation)

- Package/build scaffold.
- Transport, retry policy, typed errors.
- Job create/get/list/wait and job resource.
- Transparent local-file upload.
- Capabilities, moderation, media-report, and manual webhook retry methods.
- Low-level webhook verification and Express adapter.
- Watermark-logo upload/confirm helper.
- Unit tests and quickstart.

### Milestone B — contract hardening

- Export or generate a machine-readable gateway schema.
- Add shared conformance fixtures between gateway and SDK.
- Test real signed uploads, bundle redirects, and webhook payloads in staging.
- Decide support window for Node 20 after its upstream end-of-life.
- Claim npm namespace and configure provenance-based publishing.

### Milestone C — ergonomic additions

- Accept gateway-resolved output aliases when W4 ships.
- Framework-specific Fastify helper and richer Express typings.
- Optional async iterators for paginated job listing.
- OpenTelemetry-compatible hooks without adding a mandatory dependency.

## 14. Release gates

- `npm run check`, `npm test`, and `npm pack --dry-run` pass.
- Public exports load in both ESM and CommonJS.
- No API key or secret appears in snapshots/errors.
- README examples compile.
- Staging smoke test covers URL source, local upload, `wait()`, and webhook verification.
- Package namespace and repository metadata are verified before publish.
- MIT licensing and the `ericel/mediaruntime-node-sdk` repository are configured.

## 15. Implementation snapshot — 2026-08-15

Implemented in this repository:

- dual ESM/CommonJS TypeScript package with bundled declarations;
- authenticated transport, deadlines, conservative retries, and typed API errors;
- job create/get/list/wait, moderation, media-report, and manual webhook-retry methods;
- ergonomic `source` mapping plus transparent local and batch-input uploads;
- capabilities client and watermark-logo upload/confirm workflow;
- raw-byte webhook verification and dependency-free Express middleware;
- unit coverage for safety-critical retry, upload, timeout, polling, packaging, and
  signature behavior.

Local release checks currently pass: type-check, build, 19 tests, dependency audit, and
package dry-run. The remaining gates require external decisions or infrastructure:

- staging conformance/smoke testing with real credentials;
- stable `latest` publication after beta validation;
- output aliases, which remain correctly independent of SDK 0.1.
