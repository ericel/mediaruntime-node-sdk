import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import {
  JobWaitTimeoutError,
  MediaRuntime,
  MediaRuntimeApiError,
  MediaRuntimeConnectionError,
  MediaRuntimeTimeoutError,
} from "../dist/index.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function observe(promise) {
  const result = { state: "pending" };
  promise.then(
    (value) => Object.assign(result, { state: "fulfilled", value }),
    (error) => Object.assign(result, { state: "rejected", error }),
  );
  return result;
}

function controlledClock(t) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  t.mock.method(Math, "random", () => 0.5);
  // Track timer ownership through the runtime API, without depending on SDK helpers.
  const active = new Set();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) => {
    const timer = schedule(() => { active.delete(timer); callback(...args); }, milliseconds);
    active.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => { active.delete(timer); cancel(timer); });
  return {
    active,
    // Move the clock without delivering the timeout callback, exercising event-loop ordering.
    elapsed(milliseconds) { t.mock.timers.setTime(1_000 + milliseconds); },
    async tick(milliseconds) { t.mock.timers.tick(milliseconds); await nextTurn(); },
  };
}

function jobResponse(status = "PROCESSING", sequence = 0, id = "job_deadline") {
  return Response.json({ job_id: id, status, metadata: { sequence } });
}

function pendingRequest(signal) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function fixture(t, entry, fetchJob, transport = {}) {
  const clock = controlledClock(t);
  const requests = [];
  const media = new MediaRuntime({
    apiKey: "test-deadline",
    timeoutMs: 10_000,
    maxRetries: 2,
    ...transport,
    fetch: async (url, init) => {
      if (init.method === "POST") {
        return Response.json({ job_id: "job_deadline", status: "QUEUED", tier: "standard" });
      }
      const request = { url, signal: init.signal };
      requests.push(request);
      return fetchJob(request, requests.length);
    },
  });
  const job = entry === "Job.wait"
    ? await media.jobs.create({ source: "https://example.test/video.mp4", outputs: ["video.web"] })
    : undefined;
  const wait = (options = {}) => {
    const settings = { timeoutMs: 100, initialDelayMs: 1, maxDelayMs: 1, ...options };
    return job ? job.wait(settings) : media.jobs.wait("job_deadline", settings);
  };
  return { clock, requests, media, wait };
}

function assertTimeout(result, previous = false, timeoutMs = 100) {
  assert.equal(result.state, "rejected", "wait must have settled at its deadline");
  assert.ok(result.error instanceof JobWaitTimeoutError);
  assert.equal(result.error.timeoutMs, timeoutMs);
  if (previous) {
    assert.equal(result.error.lastJob.id, "job_deadline");
    assert.equal(result.error.lastJob.status, "PROCESSING");
    assert.deepEqual(result.error.lastJob.metadata, { sequence: 0 });
  } else assert.equal(result.error.lastJob, null);
}

for (const entry of ["jobs.wait", "Job.wait"]) {
  for (const cooperative of [true, false]) {
    test(`${entry}: deadline aborts a pending fetch (honors signal=${cooperative})`, async (t) => {
      const gate = deferred();
      const f = await fixture(t, entry, ({ signal }) => cooperative ? pendingRequest(signal) : gate.promise);
      const result = observe(f.wait());
      await nextTurn();
      await f.clock.tick(99);
      assert.equal(result.state, "pending");
      await f.clock.tick(1);
      assertTimeout(result);
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].signal.aborted, true);
      assert.equal(f.clock.active.size, 0, "settlement releases request and wait timers");
      gate.resolve(jobResponse("COMPLETED"));
      await nextTurn();
      assertTimeout(result);
      assert.equal(f.requests.length, 1);
    });
  }

  test(`${entry}: a polling delay cannot start another fetch at the deadline`, async (t) => {
    const f = await fixture(t, entry, (_request, count) => jobResponse(count === 1 ? "PROCESSING" : "COMPLETED"));
    const result = observe(f.wait({ initialDelayMs: 1_000, maxDelayMs: 1_000 }));
    await nextTurn();
    await f.clock.tick(100);
    assertTimeout(result, true);
    assert.equal(f.requests.length, 1);
    assert.equal(f.clock.active.size, 0);
  });

  test(`${entry}: deadline interrupts Retry-After and preserves an earlier snapshot`, async (t) => {
    const f = await fixture(t, entry, (_request, count) => count === 1 ? jobResponse()
      : Response.json({ detail: "busy" }, { status: 503, headers: { "Retry-After": "60" } }));
    const result = observe(f.wait());
    await nextTurn();
    await f.clock.tick(1);
    assert.equal(f.requests.length, 2);
    await f.clock.tick(99);
    assertTimeout(result, true);
    assert.equal(f.clock.active.size, 0);
    await f.clock.tick(60_000);
    assert.equal(f.requests.length, 2);
  });

  for (const status of [200, 503]) {
    test(`${entry}: deadline bounds pending response bodies (HTTP ${status})`, async (t) => {
      const body = deferred();
      const f = await fixture(t, entry, () => ({
        ok: status === 200, status, headers: new Headers({ "Retry-After": "0" }), text: () => body.promise,
      }));
      const result = observe(f.wait());
      await nextTurn();
      await f.clock.tick(100);
      assertTimeout(result);
      assert.equal(f.requests[0].signal.aborted, true);
      assert.equal(f.clock.active.size, 0);
      body.resolve(JSON.stringify({ job_id: "job_deadline", status: "COMPLETED" }));
      await nextTurn();
      assertTimeout(result);
      assert.equal(f.requests.length, 1);
    });
  }

  for (const previous of [false, true]) {
    for (const outcome of ["completed", "processing", "network", "503", "400", "body"]) {
      for (const elapsed of [100, 101]) {
        test(`${entry}: late ${outcome} at ${elapsed}ms, previous=${previous}, before timer delivery`, async (t) => {
          const gate = deferred();
          const f = await fixture(t, entry, (_request, count) => {
            if (previous && count === 1) return jobResponse();
            if (outcome === "body") return { ok: true, status: 200, text: () => gate.promise };
            return gate.promise;
          });
          const result = observe(f.wait());
          await nextTurn();
          if (previous) await f.clock.tick(1);
          const count = previous ? 2 : 1;
          assert.equal(f.requests.length, count);
          f.clock.elapsed(elapsed);
          if (outcome === "network") gate.reject(new TypeError("connection lost"));
          else if (outcome === "503" || outcome === "400") {
            gate.resolve(Response.json({ detail: "failed" }, {
              status: Number(outcome), headers: { "Retry-After": "0" },
            }));
          } else if (outcome === "body") {
            gate.resolve(JSON.stringify({ job_id: "job_deadline", status: "COMPLETED" }));
          } else gate.resolve(jobResponse(outcome === "completed" ? "COMPLETED" : "PROCESSING", 1));
          await nextTurn();
          assertTimeout(result, previous);
          assert.equal(f.requests.length, count, "no retry may start before the deadline timer runs");
          assert.equal(f.clock.active.size, 0);
        });
      }
    }
  }

  for (const stage of ["fetch", "body", "poll delay", "retry delay"]) {
    test(`${entry}: caller abort during ${stage} keeps its reason even if clock subsequently expires`, async (t) => {
      const caller = new AbortController();
      const reason = { cancelled: stage };
      const f = await fixture(t, entry, ({ signal }) => {
        if (stage === "fetch") return pendingRequest(signal);
        if (stage === "body") return { ok: true, status: 200, text: () => new Promise(() => {}) };
        if (stage === "poll delay") return jobResponse();
        return Response.json({}, { status: 503, headers: { "Retry-After": "60" } });
      });
      const result = observe(f.wait({ signal: caller.signal, initialDelayMs: 1_000 }));
      await nextTurn();
      f.clock.elapsed(99);
      caller.abort(reason);
      f.clock.elapsed(100);
      await nextTurn();
      assert.equal(result.state, "rejected");
      assert.equal(result.error, reason);
      assert.equal(f.requests.length, 1);
      assert.equal(getEventListeners(caller.signal, "abort").length, 0);
      assert.equal(f.clock.active.size, 0);
    });
  }

  for (const reason of [null, 0, "cancelled"]) {
    test(`${entry}: preserves caller abort reason ${JSON.stringify(reason)}`, async (t) => {
      const caller = new AbortController();
      const f = await fixture(t, entry, ({ signal }) => pendingRequest(signal));
      const result = observe(f.wait({ signal: caller.signal }));
      caller.abort(reason);
      await nextTurn();
      assert.equal(result.state, "rejected");
      assert.equal(result.error, reason);
      assert.equal(f.clock.active.size, 0);
    });
  }

  test(`${entry}: an already cancelled caller starts no fetch`, async (t) => {
    const caller = new AbortController();
    const reason = new Error("cancelled earlier");
    caller.abort(reason);
    const f = await fixture(t, entry, () => jobResponse("COMPLETED"));
    const result = observe(f.wait({ signal: caller.signal }));
    await nextTurn();
    assert.equal(result.state, "rejected");
    assert.equal(result.error, reason);
    assert.equal(f.requests.length, 0);
    assert.equal(f.clock.active.size, 0);
  });

  test(`${entry}: caller cancellation at the deadline cannot replace timeout`, async (t) => {
    const caller = new AbortController();
    const f = await fixture(t, entry, ({ signal }) => pendingRequest(signal));
    const result = observe(f.wait({ signal: caller.signal }));
    f.clock.elapsed(100);
    caller.abort(new Error("too late"));
    await nextTurn();
    assertTimeout(result);
    assert.equal(f.clock.active.size, 0);
  });

  for (const status of ["COMPLETED", "FAILED", "REJECTED", "PARTIAL"]) {
    test(`${entry}: ${status} observed before expiration returns normally and cleans up`, async (t) => {
      const gate = deferred();
      const caller = new AbortController();
      const f = await fixture(t, entry, () => gate.promise);
      const result = observe(f.wait({ signal: caller.signal }));
      f.clock.elapsed(99);
      gate.resolve(jobResponse(status));
      await nextTurn();
      assert.equal(result.state, "fulfilled");
      assert.equal(result.value.status, status);
      assert.equal(f.clock.active.size, 0);
      assert.equal(getEventListeners(caller.signal, "abort").length, 0);
      await f.clock.tick(10_000);
      assert.equal(f.requests[0].signal.aborted, false, "a completed wait leaves no abort timer");
      assert.equal(f.requests.length, 1);
    });
  }

  for (const failure of ["api", "network", "request timeout"]) {
    test(`${entry}: preserves ${failure} settling before the wait deadline`, async (t) => {
      const cause = new TypeError("network failed");
      const f = await fixture(t, entry, ({ signal }) => {
        if (failure === "api") return Response.json({ detail: "forbidden" }, { status: 403 });
        if (failure === "network") throw cause;
        return pendingRequest(signal);
      }, { maxRetries: 0, timeoutMs: 30 });
      const result = observe(f.wait());
      await nextTurn();
      if (failure === "request timeout") await f.clock.tick(30);
      assert.equal(result.state, "rejected");
      const ErrorType = failure === "api" ? MediaRuntimeApiError
        : failure === "network" ? MediaRuntimeConnectionError : MediaRuntimeTimeoutError;
      assert.ok(result.error instanceof ErrorType);
      if (failure === "network") assert.equal(result.error.cause, cause);
      assert.equal(f.clock.active.size, 0);
    });
  }
}

test("concurrent waits sharing a caller signal have independent deadlines and cleanup", async (t) => {
  const caller = new AbortController();
  const gates = new Map();
  const f = await fixture(t, "jobs.wait", ({ url }) => {
    const gate = deferred();
    gates.set(new URL(url).pathname, gate);
    return gate.promise;
  });
  const first = observe(f.media.jobs.wait("first", { timeoutMs: 100, signal: caller.signal }));
  const second = observe(f.media.jobs.wait("second", { timeoutMs: 200, signal: caller.signal }));
  await nextTurn();
  await f.clock.tick(100);
  assertTimeout(first);
  assert.equal(second.state, "pending");
  assert.equal(caller.signal.aborted, false);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal.aborted, false);
  f.clock.elapsed(150);
  gates.get("/v1/jobs/second").resolve(jobResponse("COMPLETED", 0, "second"));
  await nextTurn();
  assert.equal(second.state, "fulfilled");
  assert.equal(second.value.id, "second");
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  assert.equal(f.clock.active.size, 0);
});

test("standalone jobs.get keeps its request timeout and retry policy", async (t) => {
  const f = await fixture(t, "jobs.wait", (_request, count) => count === 1
    ? Response.json({}, { status: 503, headers: { "Retry-After": "60" } }) : jobResponse("COMPLETED"));
  const result = observe(f.media.jobs.get("job_deadline"));
  await nextTurn();
  await f.clock.tick(100);
  assert.equal(result.state, "pending");
  assert.equal(f.requests.length, 1);
  await f.clock.tick(59_900);
  assert.equal(result.state, "fulfilled");
  assert.equal(result.value.status, "COMPLETED");
  assert.equal(f.requests.length, 2);
});

test("a long wait budget is not truncated to Node's maximum timer delay", async (t) => {
  const gate = deferred();
  const f = await fixture(t, "jobs.wait", () => gate.promise);
  const result = observe(f.wait({ timeoutMs: 2 ** 31 + 100 }));
  await f.clock.tick(100);
  assert.equal(result.state, "pending");
  gate.resolve(jobResponse("COMPLETED"));
  await nextTurn();
  assert.equal(result.state, "fulfilled");
  assert.equal(f.clock.active.size, 0);
});
