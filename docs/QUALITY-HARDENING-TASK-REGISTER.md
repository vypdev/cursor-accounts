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
| QA-1 | CI, tests, localization, lint | PARTIAL | Full audit passes with loopback access: 795 tests, 26 locales, 428 keys, webview 18/18, coverage floors; three repeated webview runs pass | Add repeated host-run evidence and review generated-artifact/source-lint policy |
| QA-2 | Dependencies and supply chain | PARTIAL | SDK `1.0.28`, legacy npm `sqlite3` removed, targeted `uuid@11.1.1` and `undici@6.28.0` overrides resolve; `pnpm audit --prod` reports 0 advisories and signatures remain valid | Add clean-room shipped-tree scan, package-size review, and independent compatibility evidence before marking complete |
| QA-3 | Native runtime and packaging | PARTIAL | Current-target clean build passes with dynamic Electron ABI 128, official SHA-256 validation, sanitized runtime native tree, and VSIX verification | Execute clean-room install from an empty store/workspace and expand evidence across the supported target matrix |
| QA-4 | Token and cost correctness | PARTIAL | Accounting contract, authoritative server-cost precedence, model-aware fallback calculation, non-finite input guards, and SQLite replay golden test are implemented | Expand coverage across all decoder shapes, pricing refresh/versioning, rounding policy, and unknown/cache-rate reconciliation |
| QA-5 | Clean Architecture enforcement | OPEN | Existing checker and fixtures pass; Graphify still reports contract/hotspot risks | Resolve domain/application contracts and replace checker blind spots |
| QA-6 | Security and privacy | PARTIAL | Local API token, loopback validation, redaction, sidecar safety, and text-safe rendering exist | Complete threat-model decisions, retention/disk-full tests, and process review |
| QA-7 | Reliability and lifecycle | OPEN | SQLite cleanup has selective and rollback tests | Add concurrency, failure injection, migration recovery, and disk lifecycle tests |
| QA-8 | Local test confidence | PARTIAL | Critical floors exist for selected modules; Repowise still identifies low-coverage hotspots | Add risk-based floors and negative/property tests for remaining hotspots |
| QA-9 | Documentation and operations | PARTIAL | Plan, audit links, dependency inventory, advisory register, and English docs are synchronized for this slice | Add task/decision records, reproducible audit artifact output, and runbooks |
| QA-10 | Independent final audit and release rehearsal | OPEN | Not started | Run only after QA-1 through QA-9 have current evidence |

## QA-0 evidence

### Repository and tooling

| Item | Value |
|---|---|
| Branch | feature/3-mitm-proxy |
| Latest implementation commit | 50bdcc2 |
| Latest documentation commit | 50bdcc2 |
| Node | v22.23.1 |
| pnpm | 11.19.0 |
| Graphify | 0.9.48 |
| Repowise | 0.45.0 |
| Architecture gate | 438 TypeScript files |
| Documentation gate | 46 Markdown files |

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

The immutable pre-remediation pnpm audit --prod baseline reports 240 dependencies:

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 15 |
| Moderate | 13 |
| Low | 3 |

pnpm audit signatures --json verified 852 packages with no invalid or missing
signatures. Signature validity does not remediate vulnerable package versions;
QA-2 remains open.

## Post-remediation checkpoint — 2026-08-25

The first QA-2 implementation slice is now validated by the full repository
audit, executed with the loopback permission required by the proxy API
acceptance tests:

- `@cursor/sdk` upgraded from `1.0.18` to `1.0.28`; its Node requirement
  (`>=22.13`) is compatible with the observed Node `22.23.1` runtime.
- The unused root `sqlite3@5.1.7` package was removed. The extension uses
  `better-sqlite3` for persistence and retains the separately built platform
  SQLite CLI under `bin/<target>/`.
- `uuid@11.1.1` is forced for `http-mitm-proxy`; source inspection confirmed
  the library uses only the named `v4` export and the proxy package loads.
- `undici@6.28.0` is forced for ConnectRPC `1.7.0`; source inspection found
  no runtime `undici` import in the affected package, and the SDK loads.
- `CI=true pnpm run audit` passed: lint/type checks, architecture rules and
  fixtures, localization, documentation links (46 files), extension tests and
  coverage floors, webview tests (18/18), and selected VSIX verification.
- The audit was also attempted in the restricted sandbox; its two loopback
  acceptance tests failed with `EPERM`, so that run is not considered product
  evidence. The escalated run passed those tests.

The current post-remediation signature check reports 830 verified packages,
with zero invalid and zero missing signatures; the immutable pre-remediation
baseline reported 852.

QA-2 remains PARTIAL until clean-room packaging proves that build-only
dependencies are not shipped accidentally and the exact staged runtime closure
is reviewed.

## QA-3 packaging checkpoint — 2026-08-25

The current-target packaging path now has reproducible local evidence:

- VS Code target `^1.95.0` resolves to Electron `32.0.0`, node ABI `128`.
- The prebuild downloader derives the package version and ABI, fetches the
  official release digest, verifies SHA-256, validates the archive member list,
  extracts into a temporary directory, and installs only the expected native
  binding.
- Native prebuild helper tests cover checksum-format output, the expected
  archive member, unexpected archive members, path traversal input, and missing
  extracted bindings.
- `CI=true pnpm run build:current` passes and produces
  `cursor-accounts-darwin-arm64-0.1.34.vsix`.
- The sanitized artifact is 28 MiB with 3,085 entries and retains the runtime
  `better_sqlite3.node` while removing the source tree and native build
  intermediates. `node scripts/verify-vsix.mjs` passes on that exact artifact.
- The build was repeated after hardening `scripts/ensure-node.sh` against an
  inherited `npm_config_prefix`; the resulting artifact still passes native,
  dependency, and VSIX verification.

QA-3 remains PARTIAL because a fresh empty-store installation and the complete
darwin, Linux, and Windows target matrix have not yet been executed in this
environment.

## QA-4 accounting checkpoint — 2026-08-25

The accounting contract is now explicit in
[ACCOUNTING-CONTRACT.md](ACCOUNTING-CONTRACT.md). The implementation and tests
currently prove:

- a valid server `total_cents` remains authoritative, including zero;
- absent, negative, or non-finite server costs cannot become billing values;
- completed turns fall back to the model-aware calculator when the server omits
  cost;
- live delta estimates remain separate from completed-turn costs;
- repeated live and completion events remain idempotent in SQLite;
- synthetic redacted end-to-end data reconciles token totals, cache components,
  live cost, and completed-turn cost without double counting.

QA-4 remains PARTIAL until decoder-shape coverage, pricing snapshot/version
semantics, rounding policy, and unknown-model/cache-rate reconciliation are
specified and tested.

## Reclassification decisions

The following historical findings are reclassified from the current baseline:

| Historical finding | Current classification | Reason |
|---|---|---|
| Webview DOM leakage | PARTIALLY RESOLVED | Current webview suite passes 18/18; repeated and shuffled-run evidence remains |
| Localization key parity | RESOLVED FOR CURRENT BASELINE | All 26 locales currently contain 428 keys; fallback and translation policy still need explicit documentation |
| Source lint and coverage gate | PARTIALLY RESOLVED | Repository audit passes; generated-artifact policy and broader local floors remain |
| Current VSIX verification | RESOLVED FOR SELECTED ARTIFACT | Clean-room and release matrix remain open |
| Production advisories | PARTIALLY RESOLVED | Current `pnpm audit --prod` reports zero advisory records; clean-room shipped-tree evidence remains open |
| Domain/application dependency direction | OPEN | Existing gate passes but resolver-level contract analysis remains incomplete |
| Native runtime reproducibility | OPEN | Existing artifact passes; clean-room ABI matrix remains unverified |
| Token and cost semantic correctness | OPEN | No complete golden event-to-cost reconciliation corpus exists |
| Security/privacy residuals | PARTIAL | Several controls exist; retention, disk-full, process, and threat-model evidence remain |

## Commit and evidence log

| Date | Task | Commit | Evidence |
|---|---|---|---|
| 2026-08-25 | QA-0 baseline capture and register creation | fa1bb12 | Current audit outputs in /private/tmp/qa0-*; immutable baseline recorded before remediation |
| 2026-08-25 | QA-2 dependency/native cleanup slice | 03b9fe6 | SDK upgrade, sqlite3 removal, targeted overrides, clean install, production audit 0, native smoke test, and full audit pass |
| 2026-08-25 | QA-3 native packaging reproducibility slice | 50bdcc2 | Dynamic Electron ABI, official prebuild digest verification, native archive tests, runtime-tree sanitization, pnpm 10.34 frozen install, current-target build, production audit 0, signatures 830/830, and full audit pass |

This register must be updated in the same commit as each task's implementation
or evidence change.
