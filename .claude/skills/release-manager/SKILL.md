---
name: release-manager
description: |
  Expert release management for moonbit-registry-tools. Handles release readiness checks, changelog updates, triggering releases via mise tasks, release verification, post-release checks, retrospectives, and process improvements.

  Use when: (1) Checking if code is ready for release (2) Preparing changelog for a new version (3) Triggering a release (4) Verifying release success (5) Investigating failed releases (6) Conducting release retrospectives (7) Learning about or improving the release process
---

# Release Manager

Expert guidance for managing releases of moonbit-registry-tools.

## Release Process Overview

1. **Readiness Check** - Verify code quality, tests, and changelog
2. **Version Bump** - Update version in package.json and src/cli/index.ts
3. **Changelog Update** - Move unreleased items to versioned section
4. **Commit & Tag** - Create release commit and version tag
5. **Push** - Push commit and tag to trigger release workflow
6. **Verify** - Confirm GitHub Actions succeeded and release published

## Commands Reference

### Check Release Readiness

```bash
# Run all quality checks
mise run fmt:check && mise run lint && mise run test

# Check for uncommitted changes
git status

# Verify on main branch or release branch
git branch --show-current
```

### Prepare Changelog

Update `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format:

1. Rename `## [Unreleased]` items to `## [X.Y.Z] - YYYY-MM-DD`
2. Add new empty `## [Unreleased]` section above
3. Update comparison links at bottom:
   - Change `[Unreleased]` link to compare from new version
   - Add new version release link

Categories: Added, Changed, Deprecated, Removed, Fixed, Security

### Version Locations

Update version in TWO places:
- `package.json` - `"version": "X.Y.Z"`
- `src/cli/index.ts` - `.version("X.Y.Z")`

### Trigger Release

```bash
# Create and push tag (triggers .github/workflows/release.yml)
git tag vX.Y.Z
git push origin vX.Y.Z
```

### Verify Release

```bash
# Check workflow status
gh run list --workflow=release.yml --limit=5

# View specific run
gh run view <run-id>

# Check release was created
gh release view vX.Y.Z
```

## Mise Task Pattern

When creating release-related mise tasks, follow the repository's file-based pattern:

See `.mise/AGENTS.md` for the full pattern. Structure:
- `.mise/tasks/<task>` - Bash shim
- `.mise/tasks/<task>.ps1` - PowerShell shim
- `scripts/<task>.ts` - Bun script with logic

Add to `mise.toml`:
```toml
[tasks."release:check"]
description = "Check release readiness"
run = "bash .mise/tasks/release-check"
run_windows = "powershell -ExecutionPolicy Bypass -File .mise/tasks/release-check.ps1"
```

## Semantic Versioning

Follow [SemVer](https://semver.org/):
- **MAJOR** (X.0.0) - Breaking API changes
- **MINOR** (0.X.0) - New features, backward compatible
- **PATCH** (0.0.X) - Bug fixes, backward compatible

## Detailed Workflows

- **Release checklist**: See [references/checklist.md](references/checklist.md)
- **Troubleshooting**: See [references/troubleshooting.md](references/troubleshooting.md)
- **Retrospective template**: See [references/retrospective.md](references/retrospective.md)
