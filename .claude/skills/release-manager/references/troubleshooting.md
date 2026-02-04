# Release Troubleshooting

## Common Issues

### Workflow Fails: Build Phase

#### Bun Build Fails
**Symptom**: `bun build` command fails in workflow

**Check**:
```bash
# Reproduce locally
bun install --frozen-lockfile
bun build src/index.ts --compile --outfile dist/moonbit-registry
```

**Common causes**:
- TypeScript errors not caught by lint
- Missing dependencies
- Bun version mismatch (check `mise.toml` vs workflow)

**Fix**: Resolve build errors locally, amend or create new release

---

#### Platform-Specific Build Fails
**Symptom**: One platform (e.g., linux-arm64) fails while others succeed

**Check**:
```bash
gh run view <run-id> --log-failed
```

**Common causes**:
- Cross-compilation issues
- Platform-specific Bun bugs

**Fix**: Check Bun GitHub issues for platform-specific problems

---

### Workflow Fails: Release Phase

#### Changelog Extraction Fails
**Symptom**: Release created but notes say "Release X.Y.Z" (default)

**Check**: Verify changelog format matches awk script expectations:
- Section header must be `## [X.Y.Z]` (with brackets)
- Version in tag must match version in changelog (without `v` prefix)

**Fix**: Update CHANGELOG.md format, delete release, re-tag

---

#### Artifact Download Fails
**Symptom**: `download-artifact` step fails

**Check**:
```bash
gh run view <run-id>
```

**Common causes**:
- Build jobs didn't complete
- Artifact naming mismatch

---

### Tag/Release Issues

#### Tag Already Exists
**Symptom**: `git tag` fails with "already exists"

**Resolution**:
```bash
# If release should be replaced
git tag -d vX.Y.Z
git push --delete origin vX.Y.Z
gh release delete vX.Y.Z --yes

# Re-tag
git tag vX.Y.Z
git push origin vX.Y.Z
```

---

#### Wrong Commit Tagged
**Symptom**: Tag points to wrong commit

**Resolution**:
```bash
# Delete and recreate
git tag -d vX.Y.Z
git push --delete origin vX.Y.Z
gh release delete vX.Y.Z --yes

# Tag correct commit
git tag vX.Y.Z <correct-commit-sha>
git push origin vX.Y.Z
```

---

### Version Mismatch

#### package.json and CLI Version Differ
**Symptom**: `moonbit-registry --version` shows different version than package.json

**Check**:
```bash
grep '"version"' package.json
grep '.version(' src/cli/index.ts
```

**Fix**: Update both files to match, commit, re-release

---

## Diagnostic Commands

### Check Workflow Status
```bash
# List recent release runs
gh run list --workflow=release.yml --limit=10

# View specific run details
gh run view <run-id>

# View failed step logs
gh run view <run-id> --log-failed

# Rerun failed jobs
gh run rerun <run-id> --failed
```

### Check Release Status
```bash
# List releases
gh release list

# View specific release
gh release view vX.Y.Z

# Download release assets
gh release download vX.Y.Z --dir ./release-test
```

### Check Tag Status
```bash
# List tags
git tag -l

# Show tag details
git show vX.Y.Z

# Check if tag exists on remote
git ls-remote --tags origin | grep vX.Y.Z
```

## Improving Release Reliability

### After Resolving Issues

1. **Document the fix** in this troubleshooting guide
2. **Add automation** to prevent recurrence:
   - Pre-release validation script
   - CI checks for version consistency
3. **Update checklist** if manual step was missed

### Potential Mise Tasks to Add

```toml
# Validate release readiness
[tasks."release:check"]
description = "Check release readiness"
run = "bash .mise/tasks/release-check"
run_windows = "powershell -ExecutionPolicy Bypass -File .mise/tasks/release-check.ps1"

# Bump version consistently
[tasks."release:bump"]
description = "Bump version in all locations"
run = "bash .mise/tasks/release-bump"
run_windows = "powershell -ExecutionPolicy Bypass -File .mise/tasks/release-bump.ps1"
```

### CI Enhancements

Consider adding to `.github/workflows/ci.yml`:
```yaml
- name: Check version consistency
  run: |
    PKG_VERSION=$(jq -r .version package.json)
    CLI_VERSION=$(grep -oP '\.version\("\K[^"]+' src/cli/index.ts)
    if [ "$PKG_VERSION" != "$CLI_VERSION" ]; then
      echo "Version mismatch: package.json=$PKG_VERSION, CLI=$CLI_VERSION"
      exit 1
    fi
```
