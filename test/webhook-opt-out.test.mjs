import assert from "node:assert/strict";
import { test } from "node:test";
import { MediaRuntime } from "../dist/index.js";

for (const value of [undefined, true, false]) {
  test(`webhook delivery policy round-trips: ${value}`, async () => {
    let body;
    const media = new MediaRuntime({ apiKey: "test", fetch: async (_url, options) => {
      if (options.method === "POST") {
        body = JSON.parse(options.body);
        return Response.json({ job_id: "job_test", status: "QUEUED", tier: "standard" });
      }
      return Response.json({ job_id: "job_test", status: "COMPLETED", deliver_webhook: value });
    } });
    await media.jobs.create({ source: "https://example.test/video.mp4", outputs: ["video.web"], deliverWebhook: value });
    assert.equal(body.deliver_webhook, value);
    assert.equal(Object.hasOwn(body, "deliver_webhook"), value !== undefined);
    assert.equal((await media.jobs.get("job_test")).deliverWebhook, value);
  });
}
test("invalid webhook policy fails before uploading a local source", async () => {
  const media = new MediaRuntime({ apiKey: "test", fetch: () => assert.fail("Network must not be reached") });
  await assert.rejects(media.jobs.create({ source: "missing.mp4", outputs: ["video.web"], deliverWebhook: "false" }), /must be a boolean/);
});
