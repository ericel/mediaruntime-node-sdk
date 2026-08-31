# Changelog

## 1.3.0 — 2026-08-31

- Add API-key collection management for list, create, retrieve, update, recoverable
  archive, retained binding history, and activation-ID or stable-pack-ID binding flows.
- Add `media.stickers.usage()` for typed workspace-pooled operation, authorized
  delivery, remaining allowance, status, and settled-overage reporting.
- Preserve structured `sticker_runtime_quota_exceeded` details from FastAPI `402`
  responses so services can direct workspace owners to fund their wallet.
- Add `media.stickers.collection(collectionId)` as the primary server-side Sticker
  Runtime client, using the configured workspace API key for pack reads, search,
  typeahead, metadata retrieval, and asset resolution.
- Add `media.stickers.createClientToken()` for server-side issuance of short-lived,
  collection-scoped Hosted Sticker Runtime credentials.
- Add the bearer-only `StickerRuntime` client for pack discovery, search, typeahead,
  stable metadata retrieval, and historical-safe asset resolution without exposing a
  workspace API key.
- Add typed `privacyRedaction` controls for the Premium still-image Preview; video and
  animated-image redaction remain unavailable and are rejected by the gateway and engine.
- Document the stable public privacy-report boundary: detector categories and outcomes,
  ZIP-relative paths, and no vendor/model or private infrastructure metadata.
- Add typed Audiogram artwork-fit, waveform-gain, safe-caption, and optional loudness
  normalization controls; document the caption-free poster and complete bundle inventory.
- Add typed `jobs.getCompatibilityReport()` access to the versioned
  `compatibility_report_v1` sidecar.
- Add typed `jobs.getCodeDetections()` access to the bounded `code_detect_v1` report;
  decoded payloads are explicitly untrusted text.
- Add typed `contactSheet` controls for the public `contact_sheet_v1` frames preset.
- Serialize contact-sheet geometry, sampling, format, and quality to the gateway's
  `contact_sheet` request object and parse the same fields in hosted recipes.

## 1.2.0 — 2026-08-19

- Add `media.recipes` management for immutable account-scoped hosted recipes.
- Accept `recipe` or pinned `name@version` references in `jobs.create()` while rejecting
  inline processing overrides.
- Preserve the resolved recipe acknowledgement across submit receipts, polling details,
  and verified terminal webhooks.
- Pin recipe built-ins, mutation roles, resolution ordering, and public routes in the
  shared gateway conformance fixture.

## 1.1.1 — 2026-08-18

- Preserve the gateway's ordered `public_presets` list as `publicPresets` instead of
  requiring clients to infer public availability from the broader preset catalog.

## 1.1.0 — 2026-08-18

- Expose the complete typed gateway capability catalog through
  `media.capabilities.retrieve()`.
- Include accepted source kinds, output artifacts, base tiers, optional feature metadata,
  and the six frozen aliases.
- Preserve additive capability fields under the stable 1.x compatibility policy.

## 1.0.0 — 2026-08-16

- Declare the documented SDK surface stable under semantic versioning.
- Require supported Node.js 22 or newer runtimes.
- Freeze canonical source serialization, output aliases, terminal states, typed errors,
  invocation-safe retries, and polling/webhook ZIP-bundle semantics as the v1 contract.
- Correct the public idempotency documentation to distinguish invocation-generated keys
  from caller-provided durable business keys.

## 0.2.5 — 2026-08-16

- Generate one opaque idempotency key per `jobs.create()` invocation when the caller
  omits one, and reuse it across network, `5xx`, `429`, and in-progress replay attempts.
- Preserve caller-provided keys as the durable mechanism across restarts, redelivery, and
  later invocations; generated key material is never exposed or logged.
- Keep fingerprint conflicts, validation failures, and unrelated `409` responses
  terminal.

## 0.2.4 — 2026-08-16

- Vendor only the filtered public OpenAPI surface in repository conformance fixtures.
- Keep private upstream repository naming out of public provenance and consumer docs.

## 0.2.3 — 2026-08-16

- Surface gateway-owned `code`, `retryable`, and `requestId` fields on API errors.
- Preserve normalized `details` separately from the complete legacy-compatible response body.
- Pin request-correlation and error classification in the shared conformance fixture.

## 0.2.2 — 2026-08-16

- Send canonical `source` for scalar and batch job submissions.
- Treat batch `PARTIAL` as terminal in `job.wait()`.
- Pin the versioned gateway OpenAPI and conformance artifacts in CI.
- Add typed webhook bundle, metadata, and error projections.

## 0.2.1 — 2026-08-16

- Send canonical `source` for every batch item while retaining transparent local uploads.
- Document the batch input surface and canonical ZIP bundle workflow.

## 0.2.0 — 2026-08-16

- Added typed support for the six frozen output aliases.
- Exposed gateway-resolved output tuples and the required tier on job receipts.
- Exposed the live output-alias catalog through capabilities.

## 0.1.1 — 2026-08-15

- Added dependency-free Fastify webhook middleware with raw-body verification.
- Documented a scoped Fastify content parser that leaves normal JSON routes unchanged.
- Added Fastify raw-body, parsed-body rejection, and consumer type-compatibility tests.

## 0.1.0 — 2026-08-15

First stable release of the official MediaRuntime Node.js SDK.

- Typed job creation, retrieval, listing, waiting, moderation, media reports, and webhook retries.
- Direct HTTP(S)/`gs://` sources plus transparent signed uploads for local files.
- Conservative retry behavior with opt-in idempotent job submission.
- Typed API, connection, timeout, validation, authentication, and idempotency errors.
- Capabilities and account watermark-logo clients.
- Raw-body webhook verification with timestamp tolerance and Express middleware.
- ESM and CommonJS builds, bundled TypeScript declarations, and Node.js 20+ support.
- Production validation through Wahalao Firebase Functions, including moderation persistence.

## 0.1.0-beta.1 — 2026-08-15

- Added ES2017 consumer declaration compatibility and a regression compilation test.

## 0.1.0-beta.0 — 2026-08-15

- Initial public beta.
