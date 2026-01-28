# Release Retrospective Template

Use this template after each release to capture learnings and improve the process.

## Release Summary

**Version**: vX.Y.Z
**Date**: YYYY-MM-DD
**Release Manager**: [Name/Agent]
**Duration**: [Time from start to verified release]

## Timeline

| Step | Started | Completed | Notes |
|------|---------|-----------|-------|
| Readiness check | | | |
| Version bump | | | |
| Changelog update | | | |
| Commit & tag | | | |
| Push | | | |
| Workflow completion | | | |
| Verification | | | |

## What Went Well

- [ ] Quality checks passed first try
- [ ] Changelog was up to date
- [ ] Workflow completed without issues
- [ ] All artifacts built successfully
- [ ] Release notes extracted correctly

Additional notes:
-

## What Didn't Go Well

Document any issues encountered:

### Issue 1
**Description**:
**Root cause**:
**Resolution**:
**Time lost**:

### Issue 2
**Description**:
**Root cause**:
**Resolution**:
**Time lost**:

## Metrics

- **Build time**: [Time for all 5 platforms]
- **Total workflow time**: [From push to release created]
- **Manual intervention required**: [Yes/No, describe if yes]
- **Rollback needed**: [Yes/No, describe if yes]

## Process Improvements

### Immediate Actions
Items to fix before next release:

- [ ] Action item 1
- [ ] Action item 2

### Future Enhancements
Nice-to-have improvements:

- [ ] Enhancement 1
- [ ] Enhancement 2

### Documentation Updates
- [ ] Update checklist.md
- [ ] Update troubleshooting.md
- [ ] Update SKILL.md

## Artifacts Checklist

Verify all expected artifacts:

- [ ] `moonbit-registry-linux-x64.tar.gz`
- [ ] `moonbit-registry-linux-arm64.tar.gz`
- [ ] `moonbit-registry-darwin-x64.tar.gz`
- [ ] `moonbit-registry-darwin-arm64.tar.gz`
- [ ] `moonbit-registry-windows-x64.zip`

## Release Notes Quality

- [ ] Notes accurately reflect changes
- [ ] Categories used correctly
- [ ] No sensitive information exposed
- [ ] Links to relevant issues/PRs

## Sign-off

**Release verified by**: [Name/Agent]
**Date**: YYYY-MM-DD
**Status**: [Success / Success with issues / Failed and rolled back]

---

## Historical Retrospectives

### v0.1.0 - 2026-01-27
**Status**: Initial release
**Notes**: First release of moonbit-registry-tools. Established release workflow with multi-platform builds.

---

*Add new retrospective entries above this line*
