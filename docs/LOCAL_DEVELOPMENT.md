# Local development

## Local development with real processing

Localhost applications can use the hosted API with their normal account API key.
Processing is billable at the account's normal rates; this is not sandbox mode.
Keep the API key in your server process. The SDK uploads local files; the hosted
service cannot fetch a localhost URL directly.

Set `deliver_webhook: false` on `POST /v1/jobs` to suppress callbacks for that
job, even when the account has a live webhook endpoint. It defaults to `true`.
This also suppresses batch completion callbacks; `/retry-webhook` returns HTTP
409 with code `webhook_delivery_disabled` for an opted-out job. The account's
webhook settings, billing, output retention and email preferences are unchanged.
`GET /v1/jobs/{job_id}` reports `deliver_webhook` so clients can verify the policy.
Poll the saved job ID and use the returned bundle download URL when complete.
A polling timeout does not cancel a job: resume polling that ID instead of
submitting another paid job.

Node SDK 1.5.0 or newer:

```js
const job = await media.jobs.create({
  source: "./product-video.mp4",
  outputs: ["video.web"],
  deliverWebhook: false,
});
// Persist job.id before waiting, so a restart can resume media.jobs.wait(job.id).
const result = await job.wait();
if (result.status !== "COMPLETED") throw new Error(`Job ${result.id}: ${result.status}`);
// Download result.bundle.downloadUrl before result.bundle.expiresAt.
```

Python SDK 1.5.0 or newer:

```python
job = media.jobs.create(
    source="./product-video.mp4",
    outputs=["video.web"],
    deliver_webhook=False,
)
# Persist job.id before waiting; resume with media.jobs.wait(job.id).
result = job.wait()
if result.status != "COMPLETED":
    raise RuntimeError(f"Job {result.id}: {result.status}")
# Download result.bundle.download_url before result.bundle.expires_at.
```

For submission retries across process restarts, upload once with the SDK's upload
helper, persist its `fileUri` / `file_uri`, and reuse the identical request and
idempotency key within the 24-hour deduplication window. After receiving a job ID,
only poll that job. Do not re-upload or create another job just because waiting
expired. Sticker Runtime requests remain available with the same server-side key
and their usual authorization and billing; this flag only controls job webhooks.
