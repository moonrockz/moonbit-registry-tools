# Release Checklist

## Pre-Release Verification

### Code Quality
- [ ] All tests pass: `mise run test`
- [ ] Linting passes: `mise run lint`
- [ ] Formatting correct: `mise run fmt:check`
- [ ] No uncommitted changes: `git status`

### Branch Status
- [ ] On `main` branch (or approved release branch)
- [ ] Branch is up to date with remote: `git pull origin main`
- [ ] All PRs for this release are merged

### Changelog
- [ ] `CHANGELOG.md` has entries in `[Unreleased]` section
- [ ] Changes categorized correctly (Added, Changed, Fixed, etc.)
- [ ] No duplicate entries
- [ ] Links to issues/PRs where appropriate

### Version Consistency
- [ ] Decided on version bump type (major/minor/patch)
- [ ] Version follows SemVer conventions

## Release Execution

### Step 1: Update Versions
```bash
# Determine new version (example: 0.2.0)
NEW_VERSION="0.2.0"
```

Edit `package.json`:
```json
{
  "version": "0.2.0"
}
```

Edit `src/cli/index.ts`:
```typescript
.version("0.2.0")
```

### Step 2: Update Changelog

Transform:
```markdown
## [Unreleased]

### Added
- New feature X
```

To:
```markdown
## [Unreleased]

## [0.2.0] - 2026-01-27

### Added
- New feature X
```

Update links at bottom:
```markdown
[Unreleased]: https://github.com/moonrockz/moonbit-registry-tools/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/moonrockz/moonbit-registry-tools/releases/tag/v0.2.0
[0.1.0]: https://github.com/moonrockz/moonbit-registry-tools/releases/tag/v0.1.0
```

### Step 3: Commit Release
```bash
git add package.json src/cli/index.ts CHANGELOG.md
git commit -m "chore: release v0.2.0"
```

### Step 4: Create Tag
```bash
git tag v0.2.0
```

### Step 5: Push
```bash
git push origin main
git push origin v0.2.0
```

## Post-Release Verification

### Workflow Success
- [ ] GitHub Actions release workflow completed: `gh run list --workflow=release.yml`
- [ ] All build matrix jobs succeeded (linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64)

### Release Artifacts
- [ ] GitHub Release created: `gh release view v0.2.0`
- [ ] All 5 binary archives attached
- [ ] Release notes extracted correctly from changelog

### Smoke Test
```bash
# Download and test a binary (example: linux-x64)
gh release download v0.2.0 --pattern '*linux-x64*' --dir /tmp
tar -xzf /tmp/moonbit-registry-linux-x64.tar.gz -C /tmp
/tmp/moonbit-registry --version
```

## Rollback Procedure

If release needs to be rolled back:

```bash
# Delete the release
gh release delete v0.2.0 --yes

# Delete the tag
git push --delete origin v0.2.0
git tag -d v0.2.0

# Revert the commit (if needed)
git revert HEAD
git push origin main
```
