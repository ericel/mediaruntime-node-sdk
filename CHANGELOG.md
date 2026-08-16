# Changelog

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
