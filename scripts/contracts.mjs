#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractDirectory = resolve(repositoryRoot, "contracts");
const artifacts = ["v1/openapi.json", "v1/conformance.json"];
const manifestPath = resolve(contractDirectory, "provenance.json");

function usage(message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/contracts.mjs check [--source <gateway-contracts-dir>]\n" +
      "       node scripts/contracts.mjs sync --source <gateway-contracts-dir>",
  );
  process.exit(2);
}

function argumentsFor(argv) {
  const command = argv[0];
  if (command !== "check" && command !== "sync") usage("Expected check or sync.");
  let source;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] !== "--source" || !argv[index + 1]) usage(`Unknown argument: ${argv[index]}`);
    source = resolve(argv[index + 1]);
    index += 1;
  }
  if (command === "sync" && !source) usage("sync requires --source.");
  return { command, source };
}

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readArtifact(root, path) {
  const content = await readFile(resolve(root, path));
  JSON.parse(content.toString("utf8"));
  return content;
}

async function createManifest() {
  const entries = {};
  for (const path of artifacts) {
    const content = await readArtifact(contractDirectory, path);
    entries[path] = { sha256: digest(content) };
  }
  return {
    manifest_version: 1,
    source: {
      identifier: "mediaruntime-public-api",
      artifact_root: "contracts",
    },
    artifacts: entries,
  };
}

async function sync(source) {
  for (const path of artifacts) {
    await readArtifact(source, path);
    const destination = resolve(contractDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(source, path), destination);
  }
  const manifest = await createManifest();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Synced ${artifacts.length} gateway contract artifacts.`);
}

async function check(source) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const expected = await createManifest();
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error("Contract provenance hashes are stale. Run npm run contracts:sync.");
  }
  if (source) {
    for (const path of artifacts) {
      const local = await readArtifact(contractDirectory, path);
      const upstream = await readArtifact(source, path);
      if (!local.equals(upstream)) {
        throw new Error(`${path} differs from the supplied gateway contract.`);
      }
    }
  }
  console.log(
    source
      ? "Gateway contract snapshot matches the supplied source."
      : "Gateway contract snapshot and provenance hashes are valid.",
  );
}

const options = argumentsFor(process.argv.slice(2));
if (options.command === "sync") await sync(options.source);
else await check(options.source);
