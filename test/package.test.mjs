import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

test("ESM entry point exports the client", async () => {
  const sdk = await import("../dist/index.js");
  assert.equal(typeof sdk.MediaRuntime, "function");
});

test("CommonJS entry point exports the client", () => {
  const require = createRequire(import.meta.url);
  const sdk = require("../dist/index.cjs");
  assert.equal(typeof sdk.MediaRuntime, "function");
});
