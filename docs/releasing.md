# Releasing Fidibaku

Fidibaku releases are tag-driven from GitHub Actions.

## One-time npm setup

Create the npm package once, then configure durable publishing with npm Trusted Publishing.

1. Create and verify an npm account.
2. Enable 2FA on the npm account.
3. Publish `fidibaku@0.1.0` once, or run the `Tag Release` workflow with explicit version `0.1.0` after credentials are configured.
4. On npmjs.com, open the `fidibaku` package settings and configure Trusted Publishing:
   - Provider: GitHub Actions
   - Owner/user: `mathieu-ships`
   - Repository: `fidibaku`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
5. In the package publishing access settings, choose the restrictive token option that disallows tokens.

Trusted Publishing avoids long-lived npm write tokens. Do not add `NPM_TOKEN` to this repository; the publish workflow uses GitHub Actions OIDC with `id-token: write`.

## Release flow

Use GitHub Actions -> `Tag Release`.

- Select branch: `main`
- For the first publish, set `version` to `0.1.0`
- After that, leave `version` empty and choose `patch`, `minor`, or `major`

The workflow:

1. Computes the next version from the latest `v*` tag unless an explicit version is provided.
2. Runs `npm install`, `npm run check`, `npm run smoke`, and `npm pack --dry-run`.
3. Creates and pushes a tag like `v0.1.1` on the verified `main` commit.
4. Dispatches `Publish npm Package` for that tag.

The release tag is the source of truth for the published version. The publish workflow checks out the tag and sets `package.json` to the tag version before packing, so `main` does not need a release-only version-bump commit.

`Publish npm Package` also supports direct `workflow_dispatch` with an existing tag. It verifies the package again and runs:

```sh
npm publish --access public --provenance
```

## Manual fallback

From a clean `main` checkout:

```sh
npm install
npm run check
npm run smoke
npm pack --dry-run
npm publish --access public --provenance
```

Do not publish generated `*.comments.*` sidecars. They are ignored by git and excluded from the npm package allowlist.
