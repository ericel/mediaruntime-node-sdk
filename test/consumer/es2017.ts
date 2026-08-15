import {
  MediaRuntime,
  MediaRuntimeError,
  WebhookVerificationError,
} from "@mediaruntime/node";

const client = new MediaRuntime({
  apiKey: "test_key",
  baseUrl: "https://example.com",
});

void client.jobs.list({ limit: 1 });
void client.webhooks.fastify(async (event, _request, reply) => {
  console.log(event.id);
  reply.code(204).send();
});
void new MediaRuntimeError("consumer-compatible error", { cause: new Error("cause") });
void new WebhookVerificationError("invalid_body", "invalid body", { cause: new Error("cause") });
