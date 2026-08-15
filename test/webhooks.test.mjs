import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  MediaRuntime,
  WebhookVerificationError,
} from "../dist/index.js";

function signedFixture({
  secret = "whsec_test",
  timestamp = 1_786_800_000,
  eventId = "webhook_evt_job_123",
  payload = { event_id: "evt_job_123_completed", job_id: "job_123", account_id: "acc_1", status: "COMPLETED" },
} = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.`)
    .update(body)
    .digest("hex");
  return {
    secret,
    timestamp,
    body,
    headers: {
      "x-transcoder-id": eventId,
      "x-transcoder-timestamp": String(timestamp),
      "x-transcoder-signature": `t=${timestamp},v1=${digest}`,
    },
  };
}

test("verifies exact webhook bytes and projects a semantic event", () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  const event = media.webhooks.verify(fixture.body, fixture.headers, { now: fixture.timestamp });
  assert.equal(event.id, "webhook_evt_job_123");
  assert.equal(event.jobId, "job_123");
  assert.equal(event.type, "job.completed");
  assert.equal(event.status, "COMPLETED");
  assert.deepEqual(event.rawBody, fixture.body);
});

test("rejects a body that changed after it was signed", () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  assert.throws(
    () => media.webhooks.verify(Buffer.concat([fixture.body, Buffer.from(" ")]), fixture.headers, { now: fixture.timestamp }),
    (error) => error instanceof WebhookVerificationError && error.reason === "invalid_signature",
  );
});

test("rejects stale webhook timestamps", () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  assert.throws(
    () => media.webhooks.verify(fixture.body, fixture.headers, { now: fixture.timestamp + 301 }),
    (error) =>
      error instanceof WebhookVerificationError && error.reason === "timestamp_outside_tolerance",
  );
});

test("Express helper verifies a raw body before invoking the handler", async () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  let handled = false;
  let status = null;
  const middleware = media.webhooks.express(
    async (event, _request, response) => {
      handled = event.jobId === "job_123";
      response.sendStatus(204);
    },
    { now: fixture.timestamp },
  );
  await middleware(
    { body: fixture.body, headers: fixture.headers },
    { sendStatus: (value) => { status = value; } },
  );
  assert.equal(handled, true);
  assert.equal(status, 204);
});

test("Express helper rejects an already parsed body", async () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  let status = null;
  const middleware = media.webhooks.express(() => {
    throw new Error("must not run");
  });
  await middleware(
    { body: JSON.parse(fixture.body), headers: fixture.headers },
    { sendStatus: (value) => { status = value; } },
  );
  assert.equal(status, 401);
});

test("Fastify helper verifies request.rawBody before invoking the handler", async () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  let handled = false;
  let status = null;
  let sent = false;
  const routeHandler = media.webhooks.fastify(
    async (event, _request, reply) => {
      handled = event.jobId === "job_123";
      reply.code(204).send();
    },
    { now: fixture.timestamp },
  );
  const reply = {
    code(value) {
      status = value;
      return this;
    },
    send() {
      sent = true;
    },
  };

  await routeHandler(
    { rawBody: fixture.body, body: JSON.parse(fixture.body), headers: fixture.headers },
    reply,
  );

  assert.equal(handled, true);
  assert.equal(status, 204);
  assert.equal(sent, true);
});

test("Fastify helper accepts a Buffer body from a scoped content parser", async () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  let eventId = null;
  const routeHandler = media.webhooks.fastify(
    (event) => {
      eventId = event.id;
    },
    { now: fixture.timestamp },
  );

  await routeHandler(
    { body: fixture.body, headers: fixture.headers },
    { code() { return this; }, send() {} },
  );

  assert.equal(eventId, "webhook_evt_job_123");
});

test("Fastify helper rejects an already parsed body", async () => {
  const fixture = signedFixture();
  const media = new MediaRuntime({ webhookSecret: fixture.secret });
  let status = null;
  let sent = false;
  const routeHandler = media.webhooks.fastify(() => {
    throw new Error("must not run");
  });
  const reply = {
    code(value) {
      status = value;
      return this;
    },
    send() {
      sent = true;
    },
  };

  await routeHandler(
    { body: JSON.parse(fixture.body), headers: fixture.headers },
    reply,
  );

  assert.equal(status, 401);
  assert.equal(sent, true);
});
