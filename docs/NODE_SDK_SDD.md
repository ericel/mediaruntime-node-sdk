# MediaRuntime Node SDK — Software Design Document

Status: Milestones A and B implemented and published as stable `0.2.4`

Package: `@mediaruntime/node`

Repository: `ericel/mediaruntime-node-sdk`
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
  outputs: ["video.web"],
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
- Make job submission retry-safe by assigning one opaque idempotency key to each
  `jobs.create()` invocation and reusing it across that invocation's transport retries.
  Preserve caller-provided keys for durable business idempotency.
- Expose distinct typed errors for an idempotency claim in progress and for a key/body
  conflict.
- Provide capped exponential backoff with jitter for safe reads and idempotent submission.
- Provide `job.wait()` for scripts, tests, notebooks, and reconciliation tasks.
- Verify webhook HMAC signatures, timestamp tolerance, and exact raw bytes in one call.
- Ship types, ESM, and CommonJS from one package with no runtime dependencies.
- Keep gateway wire names private where practical and expose JavaScript-style camelCase.

### Non-goals for 0.x

- Client-owned output alias resolution or hosted recipes. The SDK forwards typed alias
  strings unchanged; the gateway owns materialization and publishes the live catalog.
- Local webhook relay, CLI commands, or synthetic event delivery.
- Automatic webhook `event_id` deduplication; that requires the customer's datastore.
- Browser support. The package uses Node filesystem and cryptography APIs.
- Client-side replication of tier, billing, preset, or input-compatibility policy.
- Cancellation and retry endpoints that the gateway does not currently expose.

## 3. Source of truth

The current gateway implementation is authoritative:

- The upstream gateway schemas define job and upload request/response shapes.
- The upstream gateway routes define the public `/v1` endpoint behavior.
- The upstream gateway webhook service defines webhook signing.
- `GET /v1/capabilities` is the runtime source of compatibility rules and output aliases.

The gateway's canonical public input is `source` at both scalar and batch-item scope.
It still accepts `file_url` as a legacy compatibility spelling, but official SDKs emit
only `source`.

Versioned snapshots of the filtered public OpenAPI document and cross-client conformance
fixture live under `contracts/v1/`. The gateway remains authoritative; the snapshot lets normal
SDK CI validate its wire surface without importing a sibling checkout. Maintainers use
`scripts/contracts.mjs` for an explicit byte-for-byte sync/check during coordinated API
changes.

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
    ├── express(handler)
    └── fastify(handler)
```

`MediaRuntime` reads `MEDIARUNTIME_API_KEY`, `MEDIARUNTIME_API_URL`, and
`MEDIARUNTIME_WEBHOOK_SECRET` when explicit options are absent. Production consumers
normally supply only the API key: the hosted base URL defaults to
`https://mediaruntime.com`. `baseUrl`/`MEDIARUNTIME_API_URL` are overrides for local,
staging, proxy, and test environments—not required customer configuration. Constructor
injection of `fetch` is supported for tests, controlled proxies, and instrumentation.

`jobs.create()` returns a `Job` receipt containing `id`, `status`, `tier`, `message`,
`refresh()`, and `wait()`. Detailed reads and list pages are plain typed data structures.

## 5. Request mapping

The SDK accepts camelCase input and explicitly maps it to the gateway's snake_case body.
It does not use a generic recursive case converter: metadata is opaque customer data and
must be sent byte-for-byte with its original keys.

```text
source                       -> source
inputs[].source              -> inputs[].source
webhookUrl                   -> webhook_url
output.pathSuffix            -> path_suffix
output.removeBg              -> remove_bg
output.smartCrop             -> smart_crop
output.posterTimeSec         -> poster_time_sec
output.posterFormat          -> poster_format
```

Nested first-party option fields are mapped explicitly. `metadata` and input metadata are
copied unchanged.

`source` is the canonical public spelling for both scalar and batch submissions. The
gateway continues to accept `file_url` for legacy HTTP clients, but the SDK never emits
that compatibility spelling.

Exactly one of `source` and `inputs` is required. A request must contain at least one
output unless `moderation.enabled` is true. The gateway remains authoritative and may
perform stricter validation.

## 6. Local-file upload flow

For a source that is not an HTTP(S), `gs://`, or `file://` URL:

1. Resolve and validate the local file.
2. Call `POST /v1/upload-url` with its basename and inferred content type.
3. Stream the file to the signed URL with every returned `upload_headers` entry.
4. Submit the opaque returned `file_uri` as `source`.

`file://` URLs are converted with Node's URL utilities. Batch inputs run uploads
sequentially in 0.1 to avoid unbounded memory/file-descriptor pressure; bounded parallel
upload can be added after measurement.

## 7. Retry and timeout policy

Default transport timeout: 30 seconds per attempt. Default maximum retries: two after the
initial attempt.

Retryable failures are network errors, `429`, and `5xx`. A typed
`idempotency_in_progress` `409` is also retryable for job submission because it can be the
immediate replay of a request whose response was lost while the gateway finishes its
claim. Other `409` responses and fingerprint-conflict `422` responses remain terminal.
Delay is capped exponential backoff with jitter, honoring `Retry-After` when present.

| Operation | Automatic retry |
|---|---|
| `GET` capabilities/jobs/moderation/report | Yes |
| `POST /jobs` | Yes, with one key per invocation |
| Signed file `PUT` | Never in 0.1 |
| Watermark mutation or webhook retry | Never |

At the start of `jobs.create()`, after local validation and before any upload or network
await, the SDK uses the trimmed caller key or generates a fresh RFC 4122 UUID. The key is
kept inside the request and is neither returned nor logged. All attempts made by that one
transport request reuse it. A later invocation generates a different UUID. Generated
keys protect only a live call; stable caller keys remain the only protection across
process restarts, workers, queue redelivery, or deliberate later calls.

Signed uploads, watermark mutation, and webhook retry are not safe reads and are not
automatically replayed.

## 8. Error model

All SDK errors extend `MediaRuntimeError`.

- `MediaRuntimeApiError`: gateway `code`, message, HTTP `status`, `retryable`,
  `requestId`, normalized `details`, complete compatibility `responseBody`, response
  headers, and named validation field.
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

The gateway owns error codes and retryability. Unknown or legacy bodies fall back to
`code: "api_error"`; their complete payload remains available through `responseBody`.

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
that registered `express.json()` first. The Fastify helper prefers `request.rawBody` from
a raw-body plugin and falls back to a Buffer supplied by a scoped content-type parser.
Both helpers reject an already parsed JSON object with `401` and have no framework runtime
dependency.

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
- response loss after acceptance followed by an in-progress replay and prior-response
  recovery with one invocation key;
- one generated key across network/`5xx`/`429` retries, a fresh key on the next call, and
  caller-key override;
- terminal fingerprint conflicts, validation failures, unrelated `409` responses, and
  safe-read retries;
- typed API/idempotency errors;
- local upload header preservation and opaque URI submission;
- polling completion and timeout;
- all gateway-declared single and batch terminal states, including `PARTIAL` batches;
- canonical scalar/batch source, all frozen aliases, current error envelopes, and shared
  polling/webhook bundle metadata from the checked-in conformance fixture;
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

### Milestone B — contract hardening (implemented)

- Check in the filtered public OpenAPI v1 schema with provenance hashes.
- Add shared conformance fixtures between gateway and SDK.
- Exercise the fixture in ordinary CI without a runtime dependency on the gateway repo.

Remaining before `1.0.0`:

- Test real signed uploads, bundle redirects, and webhook payloads in staging.
- Decide support window for Node 20 after its upstream end-of-life.
- Claim npm namespace and configure provenance-based publishing.

### Milestone C — ergonomic additions

- [x] Accept frozen output aliases and project the gateway-resolved outputs and tier.
- Richer framework-native Express and Fastify typings without mandatory dependencies.
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
- Pull requests and `main` pass CI on Node.js 20, 22, and 24.
- Version-matching `v*` tags publish through npm Trusted Publishing; prereleases use
  `next` and stable versions use `latest`.

## 15. Implementation snapshot — 2026-08-16

Implemented in this repository:

- dual ESM/CommonJS TypeScript package with bundled declarations;
- authenticated transport, deadlines, conservative retries, and typed API errors;
- invocation-scoped idempotency for safe submit retries without weakening durable caller
  keys;
- job create/get/list/wait, moderation, media-report, and manual webhook-retry methods;
- ergonomic `source` mapping plus transparent local and batch-input uploads;
- capabilities client and watermark-logo upload/confirm workflow;
- typed frozen aliases, gateway-resolved output receipts, and capabilities discovery;
- raw-byte webhook verification and dependency-free Express and Fastify middleware;
- unit coverage for safety-critical retry, upload, timeout, polling, packaging, and
  signature behavior.

Local release checks currently pass: type-check, build, the full Node test suite, ES2017
consumer type compatibility, dependency audit, and package dry-run. Production validation from
`wahalao-functions` covers:

- authenticated job submission through `POST /v1/jobs`;
- terminal raw-body webhook signature and timestamp verification;
- output-bundle import and Firestore reconciliation;
- report-only moderation persistence on processed gallery media.

Stable `0.2.0` adds the six frozen aliases without moving resolution or billing policy
into the client. Alias strings are forwarded unchanged, and explicit output objects remain
fully supported.

CI/CD implementation details and the one-time npm trusted-publisher setup are documented
in `docs/RELEASING.md`.
