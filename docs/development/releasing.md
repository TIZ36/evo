# Releasing

This document describes how to publish new versions of @tiz36/evo to npm.

## Prerequisites

- Commit access to the repository
- GitHub Actions secret `NPM_TOKEN` configured (npm automation or granular token with publish permission on @tiz36/evo)
- For first-time setup: an npm account that owns the @tiz36 scope (create an organization named `tiz36` or sign up with username `tiz36`)

> Note: The unscoped name `evo` is taken on npm. This package is published as `@tiz36/evo`.

## Release Steps

1. **Bump version** in `package.json` and plugin manifests (`plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`)

2. **Update CHANGELOG.md** with the new version and changes

3. **Open a PR and merge to main**

4. **Create and push the version tag**:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

5. The publish workflow runs automatically:
   - Runs the full check suite (`pnpm check`: test + typecheck + build + iron-rule)
   - Publishes @tiz36/evo to npm with provenance

## Manual Trigger

For tags that already exist (e.g., the initial v0.3.0), use the workflow_dispatch trigger:

1. Go to Actions → "Publish to npm"
2. Click "Run workflow"
3. Enter the version without the `v` prefix (or leave empty to use package.json version)

## Required Secret

Add the `NPM_TOKEN` secret in GitHub repository settings:

1. Generate a token at [npmjs.com](https://www.npmjs.com/) → Access Tokens
2. Use "Automation" or "Granular" token type with publish permission
3. Add as a repository secret named `NPM_TOKEN`

---

Attribution: Paper team
