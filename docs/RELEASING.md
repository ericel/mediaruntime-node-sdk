# Manual SDK and CLI releases

This is the release process for MediaRuntime's three client packages. Run commands
from the named repository. The existing GitHub Actions workflows publish when a
matching version tag is pushed; publishing a GitHub release page alone is not the
package publication step.

## Repositories and order

| Package | Repository | Local checkout | Publisher |
| --- | --- | --- | --- |
| `@mediaruntime/node` | `ericel/mediaruntime-node-sdk` | `/Users/ojobasi/dev/nodejs/mediaruntime-sdk` | npm |
| `mediaruntime` | `ericel/mediaruntime-python-sdk` | `/Users/ojobasi/dev/python/mediaruntime-sdk` | PyPI |
| `@mediaruntime/cli` | `ericel/mediaruntime-cli` | `/Users/ojobasi/dev/nodejs/mediaruntime-cli` | npm |

Publish the Node SDK before the CLI whenever the CLI needs the new SDK version.
Python can be released independently. Engine, estimator, gateway, web hosting, and
the docs assistant function/corpus have their own deployment workflows.

Examples below use 1.4.0. Substitute the next unused version for future releases.
Additive API features use a minor version; fixes use a patch; breaking public
interfaces require a major version. Never move an already-published release tag or
reuse an existing registry version for different bytes.

## Authentication and identity

Use Node 24/npm and Python 3.13 where possible to match the publishing workflows;
local validation can also use another supported Python version.

```bash
gh auth status
gh api user --jq .login
git config user.name
git config user.email
git remote -v
git status --short
git fetch origin --tags
git rev-list --left-right --count HEAD...origin/main
```

The author's configured identity for the 1.4.0 release was
`oj <ericel123new@gmail.com>`, with GitHub account `ericel`. Do not substitute a
bot author or change global Git configuration. Resolve remote divergence normally;
do not force-push release history.

All three repositories use `.github/workflows/release.yml`, triggered by pushed
`v*` tags. The npm workflows have `id-token: write` and use npm trusted publishing.
The Python publisher uses the GitHub environment `pypi` and PyPI trusted publishing.
A configured environment may require approval in GitHub before publishing.

Keep the existing publisher configuration. If setting it up again, configure the
correct GitHub owner/repository, workflow filename `release.yml`, and environment
(`pypi` for Python; the current npm workflows have no environment). Never add an
npm/PyPI token to committed files. Trusted publishing uses short-lived OIDC identity
from the workflow; local `npm login` is not required for this release path.

Reference: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[PyPI trusted publishing](https://docs.pypi.org/trusted-publishers/using-a-publisher/).
npm's documented OIDC minimum is npm 11.5.1 with Node 22.14.0; the current workflow
uses Node 24. A green earlier run confirms prior configuration, not future availability.

## Prepare and verify Node SDK

```bash
cd /Users/ojobasi/dev/nodejs/mediaruntime-sdk
npm version 1.4.0 --no-git-tag-version
```

If package.json already has the intended version, skip the version command. It
updates package.json and package-lock.json; tagging happens only after validation.

When changing the public API, first ensure the gateway's generated contract is current,
then sync the SDK's checked-in snapshot:

```bash
npm run contracts:sync -- --source /Users/ojobasi/dev/transcoder-gateway-api/contracts
npm run contracts:check -- --source /Users/ojobasi/dev/transcoder-gateway-api/contracts
```

Review the SDK implementation and tests, date the changelog, update the README,
feature guides and design document, and remove obsolete pending-publication copy.
Keep required backend-version/capability notes accurate: publishing a client does
not deploy its server features.

```bash
npm ci
npm run check
npm test
npm audit --audit-level=high
npm pack --dry-run
git diff --check
git diff --stat
git diff
```

`npm test` builds first, checks the vendored contracts, runs tests, and compiles a
consumer. The prepack hook also runs type and test checks.

Stage the reviewed release files explicitly, including new guides/tests. For example:

```bash
git add package.json package-lock.json CHANGELOG.md README.md src contracts docs test
git diff --cached --check
git diff --cached --stat
git commit -m "Release Node SDK 1.4.0 with assisted clipping"
git log -1 --format='%h %an <%ae> %s'
git push origin main
gh run list --workflow ci.yml --branch main --limit 5
```

Find the CI run whose commit matches `git rev-parse HEAD`, then wait for that run:

```bash
gh run watch RUN_ID --exit-status
```

Replace RUN_ID with the numeric ID from the preceding listing. Both Node matrix
jobs and the package audit must pass. Then publish by pushing the annotated tag:

```bash
git tag -a v1.4.0 -m "MediaRuntime Node SDK 1.4.0"
git push origin refs/tags/v1.4.0
gh run list --workflow release.yml --branch v1.4.0 --limit 5
gh run watch RELEASE_RUN_ID --exit-status
npm view @mediaruntime/node@1.4.0 version dist.integrity
npm view @mediaruntime/node dist-tags --json
```

The workflow verifies tag/package version equality. Stable versions publish under
`latest`; prerelease versions containing a hyphen publish under `next`.
A successful registry lookup and clean installation are required after Actions succeeds.

## Prepare and publish Python SDK

Update both `pyproject.toml` and `src/mediaruntime/_version.py`, version assertions,
changelog, README and relevant guides. Synchronize its public contract when applicable:

```bash
cd /Users/ojobasi/dev/python/mediaruntime-sdk
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python scripts/sync_gateway_contract.py --gateway-repo /Users/ojobasi/dev/transcoder-gateway-api
.venv/bin/python scripts/sync_gateway_contract.py --gateway-repo /Users/ojobasi/dev/transcoder-gateway-api --check
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy src
.venv/bin/pytest
.venv/bin/python -m build
.venv/bin/python -m twine check dist/mediaruntime-1.4.0*
git diff --check
git diff
git add pyproject.toml CHANGELOG.md README.md src contracts docs tests
git diff --cached --check
git commit -m "Release Python SDK 1.4.0 with assisted clipping"
git push origin main
gh run list --workflow ci.yml --branch main --limit 5
gh run watch RUN_ID --exit-status
git tag -a v1.4.0 -m "MediaRuntime Python SDK 1.4.0"
git push origin refs/tags/v1.4.0
gh run list --workflow release.yml --branch v1.4.0 --limit 5
gh run watch RELEASE_RUN_ID --exit-status
```

Python CI tests 3.10–3.14 and audits the package. The release workflow builds wheel
and sdist from the tag and publishes them through the `pypi` environment. Its
release job does not repeat the full matrix, so wait for main CI before tagging.
Inspect only the current version's distributions if an old local `dist/` remains.

Verify from a fresh temporary environment:

```bash
QA_PY_DIR="$(mktemp -d)"
python3 -m venv "$QA_PY_DIR/venv"
"$QA_PY_DIR/venv/bin/python" -m pip install --no-cache-dir mediaruntime==1.4.0
"$QA_PY_DIR/venv/bin/python" -c 'import importlib.metadata as m; from mediaruntime import MediaRuntime, ClipEmptyReason; print(m.version("mediaruntime")); assert hasattr(MediaRuntime().jobs, "get_clip_candidates")'
```

## Prepare and publish CLI after Node is on npm

The CLI lockfile must resolve the real published Node SDK, not a local link/tarball.

```bash
cd /Users/ojobasi/dev/nodejs/mediaruntime-cli
npm view @mediaruntime/node@1.4.0 version
npm version 1.4.0 --no-git-tag-version
npm install --package-lock-only '@mediaruntime/node@^1.4.0'
npm ci
npm ls @mediaruntime/node
npm run check
npm test
node dist/cli.js --version
npm audit --audit-level=high
npm pack --dry-run
git diff --check
git diff
```

Skip the version command when already set. Check the SDK lock entry has the npm
registry URL and integrity metadata. The executable version must match package.json.
Stage reviewed changes, commit as your configured identity, push main, wait for its
CI, then create/push `v1.4.0` and wait for the Release workflow as above.

```bash
git add package.json package-lock.json CHANGELOG.md README.md docs src test
git diff --cached --check
git commit -m "Release CLI 1.4.0 with assisted clipping and transcript files"
git push origin main
gh run list --workflow ci.yml --branch main --limit 5
gh run watch RUN_ID --exit-status
git tag -a v1.4.0 -m "MediaRuntime CLI 1.4.0"
git push origin refs/tags/v1.4.0
gh run list --workflow release.yml --branch v1.4.0 --limit 5
gh run watch RELEASE_RUN_ID --exit-status
npm view @mediaruntime/cli@1.4.0 version dependencies
npm view @mediaruntime/cli dist-tags --json
```

## Clean registry installation and GitHub release pages

Use an empty directory to avoid accidentally testing this checkout's built files:

```bash
QA_NODE_DIR="$(mktemp -d)"
cd "$QA_NODE_DIR"
npm init -y
npm install --save-exact @mediaruntime/node@1.4.0 @mediaruntime/cli@1.4.0
node --input-type=module -e 'import { MediaRuntime } from "@mediaruntime/node"; if (typeof new MediaRuntime({apiKey:"installation-check"}).jobs.getClipCandidates !== "function") throw new Error("Missing clipping API");'
./node_modules/.bin/mediaruntime --version
./node_modules/.bin/mediaruntime --help
```

Those commands verify installation/export/help without submitting a job. For a live
smoke test use an explicitly selected test account/source. Confirm terminal status,
typed candidate plans, caption timing, and downloaded bundle size/SHA-256. Backend
deployment must be complete before claiming a deployed feature works.

After each package is confirmed on its registry, create its public GitHub release
using the existing tag and reviewed release notes:

```bash
gh release create v1.4.0 --repo ericel/mediaruntime-node-sdk --verify-tag --title "MediaRuntime Node SDK 1.4.0" --notes-file /path/to/node-release-notes.md --latest
gh release create v1.4.0 --repo ericel/mediaruntime-python-sdk --verify-tag --title "MediaRuntime Python SDK 1.4.0" --notes-file /path/to/python-release-notes.md --latest
gh release create v1.4.0 --repo ericel/mediaruntime-cli --verify-tag --title "MediaRuntime CLI 1.4.0" --notes-file /path/to/cli-release-notes.md --latest
```

The notes should explain resulting client behavior, installation, tests, compatibility,
and backend requirements. Do not include credentials or signed media URLs.
[GitHub CLI release documentation](https://cli.github.com/manual/gh_release_create).

## Troubleshooting and completion record

- Main CI failed: fix the code, push normally, and wait before creating a release tag.
- Release failed before upload: inspect `gh run view RUN_ID --log-failed`. For a
  transient runner/network failure, rerun that workflow. Do not alter a published tag.
- Authentication failure: check the trusted publisher's owner/repository/workflow
  and GitHub environment configuration. npm also needs a sufficiently recent npm CLI.
  Do not work around this by committing credentials.
- A version already exists: inspect whether this run published it. Verify its contents;
  never assume a failed workflow means no upload happened. Fix released code in a
  new patch version.
- CLI cannot install its SDK: publish/verify Node first, refresh the lockfile from
  npm, then use clean `npm ci`. Never publish a `file:` or linked SDK dependency.
- Docs or deployment lag: package publication does not deploy the gateway/web/assistant.
  Update the relevant public release-status text and regenerate the assistant corpus
  when doing that separate web release.

Record all three commit SHAs, tags, Actions URLs, registry versions, GitHub release
URLs, and clean-install checks in the release handoff. Confirm each repository has
the expected clean working tree and `HEAD` matches `origin/main`.

## Completed releases

- [1.5.0: per-job webhook opt-out](releases/1.5.0.md) — package/tag commits, CI and publishing runs, registry verification, and the production smoke-test outcome.

For webhook opt-out releases, deploy Firebase `on_job_webhook` before exposing the new flag in the gateway. Confirm `deliver_webhook` in the deployed OpenAPI, then publish clients. A real smoke test must verify the saved job policy and `webhookStatus: SKIPPED` with zero attempts; a successful processing result alone does not prove callback suppression.
