# Quality Hardening Task Register

Last reviewed: 2026-08-25

This register tracks execution of
[FINAL-QUALITY-RELEASE-HARDENING-PLAN-2026-08-25.md](FINAL-QUALITY-RELEASE-HARDENING-PLAN-2026-08-25.md).
It is intentionally separate from the historical implementation log. A task
is not complete because a related command passes; it is complete only when its
acceptance criteria and evidence are recorded.

## Status legend

- **COMPLETE**: acceptance criteria are met with current reproducible evidence.
- **PARTIAL**: some controls are present, but at least one acceptance criterion
  remains open.
- **OPEN**: implementation or a required decision has not been completed.
- **BLOCKED**: progress requires an external decision or unavailable runtime;
  the blocker and safe fallback must be documented.

## Current execution register

| ID | Area | Status | Current evidence | Next required action |
|---|---|---|---|---|
| QA-0 | Baseline and finding reclassification | COMPLETE | pnpm run audit passes; current Graphify/Repowise/dependency evidence captured on 2026-08-25 | Keep this baseline immutable and update it after every cross-cutting change |
| QA-1 | CI, tests, localization, lint | PARTIAL | Audit passes: 795 tests, 26 locales, 428 keys, webview 18/18, coverage floors | Add repeated-run evidence and review generated-artifact/source-lint policy |
| QA-2 | Dependencies and supply chain | OPEN | Current production audit: 1 critical, 15 high, 13 moderate, 3 low; signatures 852/852 | Build shipped dependency/SBOM inventory and triage each advisory |
| QA-3 | Native runtime and packaging | PARTIAL | Existing VSIX verification passes; clean-room and full target matrix are not yet evidenced | Repair fail-closed native preparation and execute clean-room matrix |
| QA-4 | Token and cost correctness | OPEN | Persistence seams and idempotency tests exist; no complete golden accounting corpus | Define accounting contract and build redacted end-to-end fixtures |
| QA-5 | Clean Architecture enforcement | OPEN | Existing checker and fixtures pass; Graphify still reports contract/hotspot risks | Resolve domain/application contracts and replace checker blind spots |
| QA-6 | Security and privacy | PARTIAL | Local API token, loopback validation, redaction, sidecar safety, and text-safe rendering exist | Complete threat-model decisions, retention/disk-full tests, and process review |
| QA-7 | Reliability and lifecycle | OPEN | SQLite cleanup has selective and rollback tests | Add concurrency, failure injection, migration recovery, and disk lifecycle tests |
| QA-8 | Local test confidence | PARTIAL | Critical floors exist for selected modules; Repowise still identifies low-coverage hotspots | Add risk-based floors and negative/property tests for remaining hotspots |
| QA-9 | Documentation and operations | PARTIAL | Plan, audit links, and English docs are synchronized for this slice | Add task/decision records, reproducible audit artifact output, and runbooks |
| QA-10 | Independent final audit and release rehearsal | OPEN | Not started | Run only after QA-1 through QA-9 have current evidence |

## QA-0 evidence

### Repository and tooling

| Item | Value |
|---|---|
| Branch | feature/3-mitm-proxy |
| Latest implementation commit | a2b761b |
| Latest documentation commit | 8c27f24 |
| Node | v22.23.1 |
| pnpm | 11.19.0 |
| Graphify | 0.9.48 |
| Repowise | 0.45.0 |
| Architecture gate | 438 TypeScript files |
| Documentation gate | 45 Markdown files |

### Reproducible audit

pnpm run audit passed on 2026-08-25 with:

- extension-host tests: 795/795 across 253 suites;
- coverage: 76.1% lines, 72.77% branches, 76.33% functions;
- architecture rules and fixtures: passed;
- localization: 26 locales with 428 keys each;
- webview tests: 5 files and 18 tests passed;
- current VSIX content verification: passed.

The current-target VSIX check proves the selected artifact is internally
consistent. It does not prove clean-room reproducibility or the full platform
matrix; those remain QA-3 work.

### Graphify

The latest code-only graph contains 3,742 nodes and 10,117 edges. The highest
relevant hotspots include:

- ProxyManager: degree 67;
- IAgentTrackingRepository: degree 38;
- MitmProxyServer: degree 19;
- AccountsPanelProvider: degree 29;
- AgentTrackingService: degree 27.

Graphify skipped SQL contributions because tree_sitter_sql is not installed.
Future comparisons must either install the parser or keep the same omission
policy and state it explicitly.

### Repowise

- Safe-only dead-code analysis: no findings.
- Historical security scan: 0 findings across 158 commits, 4,248 blobs, and
  2,465 files.
- Current refactoring targets include proxyDecode.ts, proxyServer.ts,
  installCaCertificate.ts, statusBarManager.ts, efficiencyService.ts,
  profileCommands.ts, IProxyManager.ts, and high-fan-out type barrels.

Repowise targets are prioritization signals, not automatic deletion commands.
Each candidate requires runtime, bundle, and VSIX reachability review.

### Production dependency audit

The current pnpm audit --prod baseline reports 240 dependencies:

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 15 |
| Moderate | 13 |
| Low | 3 |

pnpm audit signatures --json verified 852 packages with no invalid or missing
signatures. Signature validity does not remediate vulnerable package versions;
QA-2 remains open.

## Reclassification decisions

The following historical findings are reclassified from the current baseline:

| Historical finding | Current classification | Reason |
|---|---|---|
| Webview DOM leakage | PARTIALLY RESOLVED | Current webview suite passes 18/18; repeated and shuffled-run evidence remains |
| Localization key parity | RESOLVED FOR CURRENT BASELINE | All 26 locales currently contain 428 keys; fallback and translation policy still need explicit documentation |
| Source lint and coverage gate | PARTIALLY RESOLVED | Repository audit passes; generated-artifact policy and broader local floors remain |
| Current VSIX verification | RESOLVED FOR SELECTED ARTIFACT | Clean-room and release matrix remain open |
| Production advisories | OPEN | 1 critical and 15 high advisories remain in the current production audit |
| Domain/application dependency direction | OPEN | Existing gate passes but resolver-level contract analysis remains incomplete |
| Native runtime reproducibility | OPEN | Existing artifact passes; clean-room ABI matrix remains unverified |
| Token and cost semantic correctness | OPEN | No complete golden event-to-cost reconciliation corpus exists |
| Security/privacy residuals | PARTIAL | Several controls exist; retention, disk-full, process, and threat-model evidence remain |

## Commit and evidence log

| Date | Task | Commit | Evidence |
|---|---|---|---|
| 2026-08-25 | QA-0 baseline capture and register creation | Pending | Current audit outputs in /private/tmp/qa0-*; update with committed artifact paths when QA-9 audit runner exists |

This register must be updated in the same commit as each task's implementation
or evidence change.
