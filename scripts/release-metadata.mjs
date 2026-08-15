import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function releaseMetadata(version, refName) {
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("package.json must contain a non-empty version");
  }
  const expectedRef = `v${version}`;
  if (refName !== expectedRef) {
    throw new Error(`Release tag ${refName || "<missing>"} must exactly match ${expectedRef}`);
  }
  return {
    version,
    distTag: version.includes("-") ? "next" : "latest",
  };
}

async function main() {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const metadata = releaseMetadata(packageJson.version, process.env.GITHUB_REF_NAME);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required in the release workflow");
  await appendFile(
    outputPath,
    `version=${metadata.version}\ndist-tag=${metadata.distTag}\n`,
    "utf8",
  );
  console.log(`Validated v${metadata.version}; npm dist-tag=${metadata.distTag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
