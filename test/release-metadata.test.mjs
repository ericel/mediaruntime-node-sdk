import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseMetadata } from "../scripts/release-metadata.mjs";

test("routes prerelease versions to the next dist-tag", () => {
  assert.deepEqual(releaseMetadata("0.1.0-beta.1", "v0.1.0-beta.1"), {
    version: "0.1.0-beta.1",
    distTag: "next",
  });
});

test("routes stable versions to the latest dist-tag", () => {
  assert.deepEqual(releaseMetadata("0.1.0", "v0.1.0"), {
    version: "0.1.0",
    distTag: "latest",
  });
});

test("rejects a tag that does not match package.json", () => {
  assert.throws(
    () => releaseMetadata("0.1.0", "v0.1.1"),
    /must exactly match v0\.1\.0/,
  );
});
