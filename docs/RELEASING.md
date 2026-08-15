# Releasing `@mediaruntime/node`

CI validates pull requests and `main` on Node.js 20, 22, and 24. npm publishing is
tag-driven and uses npm Trusted Publishing with GitHub Actions OIDC, so the repository
does not store a long-lived npm token.

## One-time npm configuration

Before the first automated update, configure a trusted publisher for
`@mediaruntime/node` in npm package settings:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `ericel` |
| Repository | `mediaruntime-node-sdk` |
| Workflow filename | `release.yml` |
| Environment | leave empty |

The workflow requests only `contents: read` and `id-token: write`. Do not add an
`NPM_TOKEN` repository secret.

## Publish an update

1. Change `version` in `package.json` and `package-lock.json` on a normal pull request.
2. Merge the version change after CI passes.
3. Tag that exact merge commit with `v<package-version>` and push the tag.
4. Watch the **Release** GitHub Actions workflow.

The workflow rejects a tag that differs from `package.json`. Versions containing a
prerelease suffix, such as `0.1.0-beta.1`, publish under `next`; stable versions publish
under `latest`.

Example after merging a stable `0.1.0` version bump:

```bash
git switch main
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

The beta packages were published manually while the trusted-publisher identity was being
validated. Stable `0.1.0` and all subsequent versions must use the workflow so npm records
GitHub provenance for the release.
