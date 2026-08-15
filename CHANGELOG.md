# Changelog

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
