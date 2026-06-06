# Rollout Plan — better-sqlite3 Migration (Milestones 5-8)

**Status**: Milestones 1-4 complete, ready for phased rollout  
**Target audience**: Extension maintainers executing the migration

This document outlines the phased rollout strategy for migrating from legacy CLI subprocess to `better-sqlite3` with persistent connections.

---

## Overview

| Milestone | Phase | Duration | Feature Flag Default | Users Affected | Rollback |
|-----------|-------|----------|---------------------|----------------|----------|
| 5 | Alpha | 1-2 weeks | `false` (opt-in) | 2-3 internal testers | Easy (disable flag) |
| 6 | Beta | 2-3 weeks | `false` (opt-in) | ≥10 community volunteers | Easy (disable flag) |
| 7 | Default | 2+ weeks | `true` (opt-out) | All users | Easy (explicit opt-out) |
| 8 | Legacy Removal | After 4+ weeks stable | N/A (only better-sqlite3) | All users | Not possible |

---

## Milestone 5: Alpha Release (Internal Testing)

**Goal**: Validate stability with 2-3 trusted internal users in production usage.

### Pre-Alpha Checklist

- [x] Milestone 1-4 complete
- [x] All automated tests pass (17 connection tests + 7 concurrency tests)
- [x] Manual multi-window testing successful
- [x] Documentation complete (DATABASE-BETTER-SQLITE3.md, ADRs, TESTING-MULTI-WINDOW.md)
- [ ] Build and package VSIX with better-sqlite3 binaries
- [ ] Verify VSIX on all 6 platforms (macOS x64/arm64, Linux x64/arm64, Windows x64/arm64)

### Alpha Testers Selection

Choose 2-3 users who:
- Use the extension daily with proxy agent tracking enabled
- Have multiple VS Code windows open frequently
- Can provide detailed feedback and logs
- Understand this is experimental (expect issues)

### Alpha Rollout Steps

1. **Build VSIX**:
   ```bash
   pnpm run build:current
   # Verify better-sqlite3 bindings in VSIX:
   unzip -l cursor-accounts-*.vsix | grep better_sqlite3.node
   ```

2. **Distribute to alpha testers**:
   - Send VSIX file + instructions
   - Ask them to install: Extensions → ⋯ → Install from VSIX…
   - **Enable feature flag**:
     ```json
     {
       "cursorAccounts.experimental.useBetterSqlite3": true
     }
     ```
   - Restart VS Code

3. **Monitoring (1-2 weeks)**:
   - Daily check-in with testers
   - Collect logs: Output → "Cursor Accounts"
   - Watch for:
     - "database is locked" errors (should be eliminated)
     - Connection leak warnings
     - WAL checkpoint issues
     - Performance regressions
   - Run verification script:
     ```bash
     scripts/verify-wal-mode.sh
     ```

4. **Success Criteria**:
   - ✅ Zero "database is locked" errors
   - ✅ No data corruption (`PRAGMA integrity_check`)
   - ✅ No performance regressions (subjective faster)
   - ✅ WAL files properly managed (checkpointed on close)
   - ✅ Multi-window usage works without issues

5. **Feedback Collection**:
   - Create GitHub Discussion or Issue for alpha feedback
   - Questions to ask:
     - Did you experience any "database is locked" errors?
     - How many VS Code windows do you typically use?
     - Did you notice performance improvements?
     - Any warnings or errors in logs?

### Alpha Rollback

If critical issues occur:
1. Ask testers to disable flag:
   ```json
   {
     "cursorAccounts.experimental.useBetterSqlite3": false
   }
   ```
2. Reload VS Code
3. Investigate issue with collected logs
4. Fix and re-release alpha VSIX

---

## Milestone 6: Beta Release (Community Testing)

**Goal**: Expand testing to ≥10 community users across diverse platforms and usage patterns.

### Pre-Beta Checklist

- [ ] Alpha phase completed successfully (zero critical issues)
- [ ] All alpha feedback addressed
- [ ] Platform-specific testing completed (manual or CI)
- [ ] Beta announcement drafted (README, CHANGELOG, GitHub Discussion)

### Beta Recruitment

**Where to recruit**:
- GitHub repository (create "Beta Testers Wanted" issue)
- VS Code marketplace review replies (if applicable)
- Community forums, Discord, Reddit (if present)

**Beta announcement template**:
```markdown
## 🚀 Beta Testers Wanted: better-sqlite3 Migration

We're migrating from CLI subprocess to `better-sqlite3` with persistent connections to eliminate "database is locked" errors and improve performance by 10-100x.

**What we need:**
- ≥10 volunteers willing to test the experimental feature for 2-3 weeks
- Diverse platforms (macOS, Linux, Windows; Intel/ARM)
- Heavy users (multiple windows, frequent agent streaming)

**How to participate:**
1. Install latest extension version [link to VSIX or marketplace]
2. Enable feature flag:
   ```json
   {
     "cursorAccounts.experimental.useBetterSqlite3": true
   }
   ```
3. Use normally for 2-3 weeks
4. Report issues in [this discussion thread]

**What to watch for:**
- "database is locked" errors (should be gone!)
- Performance improvements (faster UI updates)
- Any warnings in Output → "Cursor Accounts"

**Benefits:**
- Help improve the extension for everyone
- Get early access to performance improvements
- Influence the final release

[Link to documentation: DATABASE-BETTER-SQLITE3.md]
```

### Beta Monitoring (2-3 weeks)

**Week 1-2**:
- Monitor GitHub issues/discussions daily
- Respond to questions within 24 hours
- Collect platform-specific reports (macOS/Linux/Windows)
- Track metrics:
  - Number of beta testers opted in
  - Number of issues reported
  - Number of "database is locked" errors (target: 0)

**Week 3**:
- Request final feedback from active testers
- Run database integrity checks remotely (via logs or script)
- Prepare summary for community

### Beta Success Criteria

- ✅ ≥10 active beta testers
- ✅ All 6 platforms tested (at least 1 user per platform)
- ✅ Zero critical bugs (data loss, corruption, crashes)
- ✅ ≤2 minor bugs (cosmetic, non-blocking)
- ✅ Positive feedback (majority report improvements)
- ✅ Performance gains confirmed (faster than legacy)

### Platform-Specific Issue Resolution

If issues occur on specific platforms:
1. Request detailed logs from affected users
2. Reproduce locally or via CI
3. Fix and release beta patch VSIX
4. Re-test with affected users

### Beta Rollback

Same as Alpha: disable flag, reload VS Code.

---

## Milestone 7: Default Switchover

**Goal**: Make `better-sqlite3` the default for all users (opt-out available).

### Pre-Switchover Checklist

- [ ] Beta phase completed successfully
- [ ] All beta feedback addressed
- [ ] No open critical issues
- [ ] CHANGELOG updated
- [ ] Documentation finalized
- [ ] Monitoring plan ready (for post-switchover)

### Switchover Implementation

**1. Change feature flag default** (in `package.json`):
```json
"cursorAccounts.experimental.useBetterSqlite3": {
  "type": "boolean",
  "default": true,  // Changed from false
  "markdownDescription": "Use better-sqlite3 with persistent connections (default). Set to false to revert to legacy CLI if issues occur.",
  "scope": "application"
}
```

**2. Update announcement** (CHANGELOG, README):
```markdown
## [Version X.Y.0] - YYYY-MM-DD

### 🚀 Major Performance Improvement: better-sqlite3 by Default

The extension now uses `better-sqlite3` with persistent connections instead of CLI subprocess spawning. This eliminates "database is locked" errors and improves performance by 10-100x.

**Benefits:**
- ✅ No more "database is locked" errors in multi-window scenarios
- ✅ Significantly faster database operations
- ✅ Real ACID transactions for data integrity
- ✅ Concurrent multi-window access via WAL mode

**Rollback:** If you experience issues, you can opt out:
```json
{
  "cursorAccounts.experimental.useBetterSqlite3": false
}
```

Please report any issues at [GitHub issues link].
```

**3. Release new version**:
```bash
# Bump version
npm version minor  # X.Y.0 (minor bump for significant change)

# Build and publish
pnpm run build:current
# Upload to VS Code marketplace or distribute VSIX
```

### Monitoring Period (2+ weeks)

**Week 1-2** (Critical monitoring):
- Monitor GitHub issues hourly for first 48 hours
- Then daily for 2 weeks
- Watch for:
  - Spike in "database is locked" reports (should not happen)
  - Performance complaints (rare, but possible)
  - Platform-specific issues missed in beta
  - Upgrade migration issues (old WAL files, etc.)

**Success metrics**:
- Issue report rate ≤ beta phase
- No rollbacks required (users don't disable flag)
- Positive community feedback

### Hotfix Preparation

Have a hotfix version ready to deploy within 24 hours if critical issues occur:
1. Pre-built VSIX with flag flipped to `false`
2. Fast-track approval process (if marketplace has review delay)
3. Communication plan (announce issue + hotfix immediately)

### Rollback Plan (if needed)

If critical widespread issues occur:
1. **Immediate**: Publish hotfix version with `default: false`
2. **Communication**: Announce via GitHub, marketplace, social media
3. **Investigation**: Identify root cause with logs from affected users
4. **Fix**: Address issue, re-test, re-release

---

## Milestone 8: Legacy Removal

**Goal**: Remove legacy CLI implementation after 4+ weeks of stable operation.

### Pre-Removal Checklist

- [ ] Milestone 7 complete (default switchover)
- [ ] 4+ weeks of stable operation with no critical issues
- [ ] <1% users opted out (using `useBetterSqlite3: false`)
- [ ] Community approval (no strong objections)

### Removal Impact Analysis

**Code to remove**:
- `src/persistence/sqliteExecutor.ts` (CLI wrapper)
- `src/persistence/agentTrackingDatabase.ts` (legacy repository)
- `bin/` folder (sqlite3 CLI binaries for 6 platforms)
- Factory fallback logic in `agentTrackingRepositoryFactory.ts`
- Feature flag from `package.json`

**Size reduction**:
- ~10MB saved (CLI binaries removed)
- +5MB added (better-sqlite3 binaries)
- **Net**: ~5MB smaller VSIX

**Benefits**:
- Simpler codebase (single implementation)
- Faster CI builds (no need to bundle CLI binaries)
- Easier maintenance (no dual-stack complexity)

### Removal Steps

1. **Announce deprecation** (1 version before removal):
   ```markdown
   ## [Version X.Y.0] - YYYY-MM-DD
   
   ### ⚠️ Deprecation Notice
   
   The legacy CLI subprocess database implementation will be removed in the next major version (X+1.0.0). The `cursorAccounts.experimental.useBetterSqlite3` flag will be removed, and better-sqlite3 will be the only supported implementation.
   
   If you're currently using `useBetterSqlite3: false`, please test with `true` and report any issues before the next release.
   ```

2. **Wait 2+ weeks** for community feedback

3. **Remove legacy code**:
   ```bash
   # Create removal branch
   git checkout -b remove-legacy-cli
   
   # Remove files
   rm -rf bin/
   rm src/persistence/sqliteExecutor.ts
   rm src/persistence/agentTrackingDatabase.ts
   
   # Update factory to only use better-sqlite3
   # Remove feature flag from package.json
   # Update documentation
   
   # Commit
   git add .
   git commit -m "feat: remove legacy CLI database implementation
   
   BREAKING CHANGE: The useBetterSqlite3 feature flag has been removed. better-sqlite3 is now the only supported database implementation."
   ```

4. **Major version bump**:
   ```bash
   npm version major  # X+1.0.0
   ```

5. **Update CHANGELOG**:
   ```markdown
   ## [X+1.0.0] - YYYY-MM-DD
   
   ### 💥 BREAKING CHANGES
   
   - Removed legacy CLI subprocess database implementation
   - Removed `cursorAccounts.experimental.useBetterSqlite3` setting
   - better-sqlite3 is now the only supported database backend
   
   ### ✨ Benefits
   
   - 5MB smaller extension package
   - Simpler codebase (single implementation)
   - No more dual-stack maintenance overhead
   ```

6. **Release and monitor**:
   - Build and publish new version
   - Monitor for upgrade issues (first 48 hours critical)
   - Respond to any rollback requests (though none should be possible)

### Post-Removal Maintenance

**Updated documentation**:
- Remove all references to "legacy" or "CLI subprocess"
- Update ARCHITECTURE.md (single implementation)
- Simplify DATABASE-BETTER-SQLITE3.md (remove migration context)
- Archive ADRs (keep for historical record)

**Monitoring**:
- Track issue reports for 2+ weeks
- Ensure no regression in stability or performance
- Address any unforeseen migration issues

---

## Success Metrics (Overall Migration)

**Quantitative**:
- ✅ "database is locked" error rate: 0% (down from ~5-10% baseline)
- ✅ Database operation latency: <1ms (down from 50-100ms)
- ✅ Multi-window usage: No reported issues
- ✅ Data integrity: 100% (`PRAGMA integrity_check`)
- ✅ User opt-out rate: <1% (after default switchover)

**Qualitative**:
- ✅ Positive community feedback
- ✅ Performance improvements widely reported
- ✅ No complaints about new implementation
- ✅ Smooth upgrade experience

---

## Timeline Summary

```
Week 1-2:   Alpha (2-3 internal users, opt-in)
Week 3-5:   Beta (≥10 community users, opt-in)
Week 6-7:   Default switchover (all users, opt-out available)
Week 8-11:  Monitoring (stable operation period)
Week 12+:   Legacy removal (major version bump)
```

**Total duration**: ~3 months from Alpha to Legacy removal

---

## Communication Plan

**Channels**:
1. GitHub repository (Issues, Discussions, Releases)
2. CHANGELOG.md (read by all users on upgrade)
3. README.md (prominent feature flag section)
4. VS Code marketplace description (if published)
5. Community forums/Discord (if applicable)

**Key messages**:
- **Alpha/Beta**: "Help us test! Early performance improvements"
- **Default**: "Now faster by default! Opt-out if issues"
- **Removal**: "Legacy code removed, simpler codebase"

---

## Rollback Strategy (Summary)

| Phase | Rollback Difficulty | Rollback Method | Data Loss Risk |
|-------|-------------------|-----------------|----------------|
| Alpha | Easy | Disable flag | None (same DB) |
| Beta | Easy | Disable flag | None (same DB) |
| Default | Easy | Explicit opt-out | None (same DB) |
| Post-Removal | **Not possible** | N/A | N/A |

**Critical**: Do not proceed to Milestone 8 (removal) until Milestone 7 (default) has been stable for 4+ weeks.

---

## Contact & Support

- GitHub Issues: [repository issues URL]
- Community Discussion: [discussion thread URL]
- Maintainer: [contact info]

**For urgent issues during rollout**: [escalation procedure]
