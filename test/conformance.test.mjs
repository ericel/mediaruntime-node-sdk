import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  AuthenticationError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  MediaRuntime,
  NotFoundError,
  ValidationError,
} from "../dist/index.js";

const contract = JSON.parse(
  await readFile(new URL("../contracts/v1/conformance.json", import.meta.url), "utf8"),
);
const openapi = JSON.parse(
  await readFile(new URL("../contracts/v1/openapi.json", import.meta.url), "utf8"),
);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jobDetails(status, values = {}) {
  return {
    job_id: "job_contract",
    status,
    tier: {},
    usage: {},
    billing: {},
    bundle: {
      available: false,
      download_url: null,
      expires_at: null,
      size_bytes: null,
      sha256: null,
      retention_days: null,
      ...values.bundle,
    },
    media: null,
    metadata: values.metadata ?? {},
    error: values.error ?? null,
    created_at: null,
    updated_at: null,
    started_at: null,
    completed_at: null,
  };
}

function valueAt(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

test("checked-in OpenAPI advertises the canonical source spelling", () => {
  const schemas = openapi.components.schemas;
  assert.ok(schemas.CreateJobRequest.properties.source);
  assert.ok(schemas.JobInput.properties.source);
  assert.equal(Object.keys(openapi.paths).some((path) => path.startsWith("/v1/internal/")), false);
  assert.equal(Object.keys(schemas).some((name) => name.startsWith("Internal")), false);
  assert.equal(contract.compatibility.canonical_source_field, "source");
  assert.equal(contract.compatibility.accepted_legacy_source_field, "file_url");
});

test("serializes canonical scalar and batch source requests from the gateway fixture", async () => {
  const captured = [];
  const media = new MediaRuntime({
    apiKey: "sk_contract",
    fetch: async (_input, init) => {
      captured.push(JSON.parse(init.body));
      return json({ job_id: "job_contract", status: "QUEUED", tier: "standard", msg: "accepted" });
    },
  });

  const single = contract.canonical_requests.single.example;
  await media.jobs.create({ source: single.source, outputs: single.outputs });
  assert.deepEqual(captured[0], single);

  const batch = contract.canonical_requests.batch.example;
  await media.jobs.create({
    inputs: batch.inputs.map((input) => ({
      source: typeof input.source === "string" ? input.source : new URL(input.source.url),
      inputId: input.input_id,
    })),
    outputs: batch.outputs,
  });
  assert.deepEqual(captured[1], {
    ...batch,
    inputs: batch.inputs.map((input) => ({
      ...input,
      source: typeof input.source === "string" ? input.source : input.source.url,
    })),
  });
  assert.ok(captured.every((body) => !("file_url" in body)));
  assert.ok(captured[1].inputs.every((input) => !("file_url" in input)));
});

test("forwards every frozen output alias without SDK-side materialization", async () => {
  let captured;
  const aliases = Object.keys(contract.output_aliases);
  const media = new MediaRuntime({
    apiKey: "sk_contract",
    fetch: async (_input, init) => {
      captured = JSON.parse(init.body);
      return json({ job_id: "job_aliases", status: "QUEUED", tier: "standard", msg: "accepted" });
    },
  });
  await media.jobs.create({
    source: contract.canonical_requests.single.example.source,
    outputs: aliases,
  });
  assert.deepEqual(captured.outputs, aliases);
});

test("wait recognizes every declared single and batch terminal status", async () => {
  const statuses = new Set([
    ...contract.terminal_statuses.single,
    ...contract.terminal_statuses.batch,
  ]);
  for (const status of statuses) {
    let calls = 0;
    const media = new MediaRuntime({
      apiKey: "sk_contract",
      fetch: async () => {
        calls += 1;
        return json(jobDetails(status));
      },
    });
    const result = await media.jobs.wait("job_contract", {
      timeoutMs: 100,
      initialDelayMs: 0,
      maxDelayMs: 0,
    });
    assert.equal(result.status, status);
    assert.equal(calls, 1, `${status} must stop polling`);
  }
});

test("current gateway error envelopes map to the existing typed errors", async () => {
  const examples = Object.fromEntries(
    contract.error_responses.examples.map((example) => [example.name, example]),
  );
  const cases = [
    ["unauthorized", AuthenticationError, "get"],
    ["not_found", NotFoundError, "get"],
    ["idempotency_in_progress", IdempotencyInProgressError, "create"],
    ["idempotency_conflict", IdempotencyConflictError, "create"],
    ["validation", ValidationError, "create"],
  ];

  for (const [name, ErrorType, operation] of cases) {
    const fixture = examples[name];
    assert.ok(fixture, `missing ${name} error fixture`);
    const media = new MediaRuntime({
      apiKey: "sk_contract",
      maxRetries: 0,
      fetch: async () => json(fixture.body, fixture.status),
    });
    const action = operation === "get"
      ? media.jobs.get("job_contract")
      : media.jobs.create({
          source: "https://cdn.example.com/media/source.mp4",
          outputs: ["video.web"],
          idempotencyKey: "contract:key",
        });
    await assert.rejects(action, (error) => {
      assert.ok(error instanceof ErrorType, `${name} produced ${error?.constructor?.name}`);
      assert.equal(error.status, fixture.status);
      assert.equal(error.code, fixture.body.error.code);
      assert.equal(error.retryable, fixture.body.error.retryable);
      assert.equal(error.requestId, fixture.body.error.request_id);
      assert.deepEqual(error.details, fixture.body.error.details);
      assert.deepEqual(error.responseBody, fixture.body);
      if (name === "validation") assert.equal(error.field, "source");
      return true;
    });
  }
});

test("request correlation contract is constrained and normalized", () => {
  assert.equal(contract.request_correlation.header, "X-Request-Id");
  assert.match(
    contract.request_correlation.valid_inbound_example,
    new RegExp(contract.request_correlation.accepted_pattern),
  );
  assert.deepEqual(contract.error_responses.normalized_fields, [
    "code",
    "message",
    "status",
    "retryable",
    "request_id",
    "details",
  ]);
});

test("polling and verified webhook projections preserve declared bundle parity", async () => {
  const bundle = {
    available: true,
    download_url: "https://api.example.test/v1/jobs/job_contract/bundle?token=poll",
    expires_at: "2026-08-17T00:00:00Z",
    size_bytes: 4096,
    sha256: "a".repeat(64),
    retention_days: 7,
  };
  const metadata = { asset_id: "asset_contract" };
  const media = new MediaRuntime({
    apiKey: "sk_contract",
    webhookSecret: "whsec_contract",
    fetch: async () => json(jobDetails("COMPLETED", { bundle, metadata })),
  });
  const polled = await media.jobs.get("job_contract");

  const timestamp = 1_786_800_000;
  const eventId = "webhook_evt_contract";
  const payload = {
    event_id: "evt_contract_completed",
    job_id: "job_contract",
    account_id: "acc_contract",
    status: "COMPLETED",
    delivery: {
      mode: "PULL",
      retentionDays: 7,
      expiresAt: "2026-08-17T00:00:00Z",
      bundle: {
        type: "zip",
        filename: "job_contract_outputs.zip",
        size_bytes: 4096,
        download: {
          url: "https://api.example.test/v1/jobs/job_contract/bundle?token=webhook",
          expiresAt: "2026-08-17T00:00:00Z",
        },
      },
    },
    meta: { request_metadata: metadata, bundle: { sha256: "a".repeat(64) } },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const digest = createHmac("sha256", "whsec_contract")
    .update(`${timestamp}.${eventId}.`)
    .update(rawBody)
    .digest("hex");
  const event = media.webhooks.verify(
    rawBody,
    {
      "x-transcoder-id": eventId,
      "x-transcoder-timestamp": String(timestamp),
      "x-transcoder-signature": `t=${timestamp},v1=${digest}`,
    },
    { now: timestamp },
  );

  const sdkPollingPaths = {
    status: "status",
    metadata: "metadata",
    "bundle.size_bytes": "bundle.sizeBytes",
    "bundle.sha256": "bundle.sha256",
    "bundle.retention_days": "bundle.retentionDays",
    "bundle.expires_at": "bundle.expiresAt",
  };
  for (const mapping of contract.delivery_contract.parity) {
    const sdkPath = sdkPollingPaths[mapping.polling_path];
    assert.ok(sdkPath, `unmapped polling path ${mapping.polling_path}`);
    assert.deepEqual(valueAt(polled, sdkPath), valueAt(event.data, mapping.webhook_path));
  }
  assert.equal(event.data.delivery.bundle.type, contract.delivery_contract.bundle.archive_type);
  assert.notEqual(polled.bundle.downloadUrl, event.data.delivery.bundle.download.url);
});

test("pins owner-scoped redemption semantics", () => {
  const delivery = contract.delivery_contract;
  assert.equal(contract.schema_version, "1.2.0");
  assert.deepEqual(delivery.redemption.required_token_claims, [
    "account_id",
    "job_id",
    "type",
    "exp",
  ]);
  assert.equal(delivery.redemption.scope, "bundle");
  assert.equal(delivery.redemption.cross_account_result, 404);
  assert.equal(delivery.redemption.expired_result, 410);
  assert.equal(delivery.retention.configuration, "DELIVERY_RETENTION_DAYS");
  assert.equal(delivery.retention.expired_redemption_result, 410);
  assert.equal(
    delivery.retention.storage_cleanup_policy,
    "external_infrastructure_not_managed_in_repository",
  );
});
