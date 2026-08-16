import {
  MediaRuntime,
  MediaRuntimeApiError,
  MediaRuntimeError,
  WebhookVerificationError,
} from "@mediaruntime/node";

const client = new MediaRuntime({
  apiKey: "test_key",
  baseUrl: "https://example.com",
});

void client.jobs.list({ limit: 1 });
void client.jobs.create({ source: "https://example.com/video.mp4", outputs: ["video.web"] });
void client.jobs.create({
  inputs: [
    { source: "https://example.com/a.mp4", inputId: "asset-a" },
    { source: new URL("https://example.com/b.mp4"), metadata: { position: 1 } },
  ],
  outputs: ["video.web"],
});
void client.webhooks.fastify(async (event, _request, reply) => {
  console.log(event.id);
  if (event.status === "COMPLETED") {
    console.log(event.data.delivery?.bundle?.download.url);
  }
  reply.code(204).send();
});
void new MediaRuntimeError("consumer-compatible error", { cause: new Error("cause") });
void client.jobs.get("job_123").catch((error: unknown) => {
  if (error instanceof MediaRuntimeApiError) {
    console.log(error.code, error.status, error.retryable, error.requestId, error.details);
  }
});
void new WebhookVerificationError("invalid_body", "invalid body", { cause: new Error("cause") });
