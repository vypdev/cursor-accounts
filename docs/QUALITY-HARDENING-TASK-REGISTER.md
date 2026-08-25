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
| QA-1 | CI, tests, localization, lint | PARTIAL | Full audit passes with 860 host tests, 79.79% lines, 74.19% branches, and 78.94% functions; localization is 26 locales/428 keys and webview is 18/18 | Add repeated host-run evidence and review generated-artifact/source-lint policy |
| QA-2 | Dependencies and supply chain | PARTIAL | SDK `1.0.28`, legacy npm `sqlite3` removed, targeted `uuid@11.1.1` and `undici@6.28.0` overrides resolve; `pnpm audit --prod` reports 0 advisories and signatures remain valid | Add clean-room shipped-tree scan, package-size review, and independent compatibility evidence before marking complete |
| QA-3 | Native runtime and packaging | PARTIAL | Current-target clean build passes with dynamic Electron ABI 128, official SHA-256 validation, sanitized runtime native tree, and VSIX verification | Execute clean-room install from an empty store/workspace and expand evidence across the supported target matrix |
| QA-4 | Token and cost correctness | PARTIAL | Accounting contract, authoritative server-cost precedence, model-aware fallback calculation, non-finite input guards, and SQLite replay golden test are implemented | Expand coverage across all decoder shapes, pricing refresh/versioning, rounding policy, and unknown/cache-rate reconciliation |
| QA-5 | Clean Architecture enforcement | PARTIAL | TypeScript-AST resolver-backed checker passes for 295 production files; negative fixtures cover domain/application/package/cycle cases; current Graphify/Repowise hotspots remain | Refactor the highest-risk low-coverage infrastructure modules without weakening the contract, then add characterization and failure-path tests |
| QA-6 | Security and privacy | PARTIAL | Threat model recorded; API error details are generic; loopback/token parity, redaction, sidecar safety, text-safe webview rendering, certificate platform validation, injected certificate-process failure tests, bounded certificate-process timeout/kill escalation, fail-closed migration execution, SQLite snapshot backup, sidecar preservation, and Repowise history scan are evidenced | Complete disk-full/partial-cleanup tests, native privileged command execution review on supported OS runners, protocol-specific redaction, and the legacy optional-token decision |
| QA-7 | Reliability and lifecycle | PARTIAL | Tracking ingress shutdown is idempotent; proxy startup failures now attempt MITM/ingress/API cleanup; direct `SIGTERM`/`SIGINT` uses graceful shutdown; the real runtime integration suite passes 3/3; SQLite persistence has 2-process concurrency/reopen, migration rollback/retry, consistent backup, corrupted-database sidecar preservation, and real child hang escalation coverage | Add disk-full/partial-cleanup, restore-from-backup, long-lived reader checkpoint, and crash-restart tests |
| QA-8 | Local test confidence | PARTIAL | Full audit passes 860 host tests and 18 webview tests; `proxyDecode.ts` has 91.7% c8 lines and 100% c8 branches; certificate process/platform boundaries have 16/16 focused tests; `nodeProxyProcess.ts` has 91.15% lines, 88% branches, and 100% functions; `ProxyServerRuntime` has 3/3 real integration tests; `sqliteExecutor.ts` is at 87.23% lines/78.78% branches/100% functions, `sqliteCleanupService.ts` at 84.54%/77.77%/83.33%, and the schema initializer at 95.91%/77.77%/100%; the ProfileLauncher slice adds 33 focused tests; `proxyManager.ts` is at 72.07% c8 lines; `proxyCommands.ts` is at 94.59% lines, 75% branches, and 100% functions; `statusBarManager.ts` has 94.59% lines, 84.44% branches, and 93.33% functions; Repowise still identifies remaining hotspots | Reconcile static-analysis coverage ingestion, add risk-based floors, and cover the next proxy/profile/process hotspots |
| QA-9 | Documentation and operations | PARTIAL | Plan, audit links, dependency inventory, advisory register, and English docs are synchronized for this slice | Add task/decision records, reproducible audit artifact output, and runbooks |
| QA-10 | Independent final audit and release rehearsal | OPEN | Not started | Run only after QA-1 through QA-9 have current evidence |

## QA-0 evidence

### Repository and tooling

| Item | Value |
|---|---|
| Branch | feature/3-mitm-proxy |
| Latest implementation commit | 87ff608 |
| Latest documentation commit | See the commit and evidence log below |
| Node | v22.23.1 |
| pnpm | 11.19.0 |
| Graphify | 0.9.48 |
| Repowise | 0.45.0 |
| Architecture gate | 292 production TypeScript files; tests excluded by contract |
| Documentation gate | 49 Markdown files |

### Reproducible audit

pnpm run audit passed on 2026-08-25 with:

- extension-host tests: passed across the compiled host test suite;
- coverage: 79.79% lines, 74.19% branches, 78.94% functions;
- architecture rules and fixtures: passed;
- localization: 26 locales with 428 keys each;
- webview tests: 5 files and 18 tests passed;
- current VSIX content verification: passed.

The current-target VSIX check proves the selected artifact is internally
consistent. It does not prove clean-room reproducibility or the full platform
matrix; those remain QA-3 work.

### Graphify

The latest graph was generated with Graphify `0.9.48` on `87ff608` using no
clustering. It contains 5,207 nodes and 12,180 raw edges across 688 extracted
code files; the post-build graph contains 10,489 edges. The highest relevant
hotspots include:

- ProxyManager: degree 71;
- IAgentTrackingRepository: degree 38;
- IProfileReader: degree 45;
- IProfileDetector: degree 44;
- `activate()`: degree 42.

Graphify skipped nine SQL contributions because `tree_sitter_sql` is not
installed and skipped `.npmrc` as potentially sensitive. The multigraph
diagnostic reports 1,508 dangling endpoint edges, one self-loop, no missing
endpoints, and 93 same-endpoint relation groups; these are analysis signals,
not architecture violations by themselves. The graph was generated in an
isolated copy because Graphify's watcher cannot write its output directory in
the managed workspace.

### Repowise

- Safe-only dead-code analysis: no findings. The index reports three heuristic
  unreachable files and 26 unused exports, but none is safe for automatic
  deletion without entrypoint and bundle reachability review.
- Historical security scan: 0 findings across 213 commits, 4,536 blobs, and
  2,576 files.
- Current refactoring targets include proxyDecode.ts, proxyServer.ts,
  installCaCertificate.ts, statusBarManager.ts, efficiencyService.ts,
  profileCommands.ts, IProxyManager.ts, and high-fan-out type barrels.

The latest Repowise index contains 710 indexed wiki/decision items from 689
files. The no-network mock-vector reindex completed successfully; the health
report scores average health at 8.46/10, hotspot health at 5.71/10, and
maintainability at 9.38/10. Its lowest current production targets are
`src/proxy/proxyInsightExtractor.ts` (1.81/10, NLOC 654, max CCN 20,
11.13% duplication), `src/proxy/mitmProxyServer.ts` (2.16/10, NLOC 487,
max CCN 37, 17.60% duplication), `src/services/proxyManager.ts` (3.14/10,
NLOC 640), and `src/services/storageCleanupService.ts` (3.26/10,
33.88% duplication). These are prioritization signals, not automatic
extraction requirements. Safe-only dead-code analysis remains empty.

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

## QA-5 architecture checkpoint — 2026-08-25

Commit `7618984` replaced the regex-only import inspection with a
TypeScript-AST and TypeScript-resolver implementation. The current production
graph contains 282 TypeScript files, excludes `src/test` and generated output,
and passes with zero boundary violations and zero static import cycles.

The checker now:

- parses static imports, export declarations, dynamic `import()`, `require()`,
  and TypeScript import-equals declarations;
- resolves relative imports with TypeScript and fails closed when a relative
  source cannot be resolved;
- resolves workspace package names against package manifests and source
  entrypoints when `dist` output is absent;
- enforces explicit domain, application, shared-kernel, proxy, and composition
  root rules for both type and runtime imports;
- reports source line, import kind, target layer, and a machine-readable rule;
- emits JSON for audit integrations with `node scripts/check-architecture.mjs
  --json`.

The independent fixture suite covers legal domain/application dependencies,
domain-to-application violations, application-to-infrastructure violations,
unapproved external `require()` dependencies, unresolved relative imports,
workspace package resolution, and static cycles. Documentation and contributor
guidance now reference the same contract in
[ARCHITECTURE-CONTRACT.md](ARCHITECTURE-CONTRACT.md).

Graphify `0.9.48` was refreshed after the implementation and reported 4,983
nodes and 11,607 raw edges; Repowise `0.45.0` continues to prioritize
`proxyDecode.ts`, `proxyServer.ts`, `installCaCertificate.ts`,
`statusBarManager.ts`, and high-fan-out contract barrels. Those findings are
being treated as refactoring/test priorities, not as permission to relax the
architecture rules.

QA-5 remains PARTIAL until the prioritized infrastructure hotspots receive
characterization, failure-path, and lifecycle coverage and the final audit
confirms no boundary regressions.

## QA-7.5 and QA-8.4 profile-launch and proxy-composition checkpoints — 2026-08-25

The ProfileLauncher hotspot was handled in four implementation commits:

- `4535d73` introduced the `IProfileProcessLauncher` port and a platform-aware
  process adapter, with deterministic tests for background launch, early exit,
  LaunchServices success, and synchronous spawn failure.
- `1394eb4` introduced `IProfileProxyLaunchCoordinator`, isolating proxy
  enablement, lazy startup, URL/certificate resolution, and settings handling.
- `d944663` extracted launch conflict detection and launch preparation/finalization
  seams, and added injected-runner characterization for successful and failed
  `launchWithPath` operations.
- `f534f8c` moved ProxyManager's concrete default dependency graph into
  `proxyManagerDefaultDependencies.ts`, preserving the public facade and its
  existing constructor compatibility.
- `24ab634` split ProxyManager coordinator initialization into ordered traffic,
  lifecycle, read-model, and stop phases; the constructor no longer contains
  the full coordinator graph.

The focused launcher suites pass 33/33 tests. The current full audit passes
with architecture checks for 292 production TypeScript files, localization
parity for 26 locales and 428 keys, webview tests 18/18, selected VSIX
verification, and global c8 totals of 79.06% lines, 73.75% branches, and
78.30% functions. A first full-audit attempt showed one isolated
`accountsPanel.test.ts` delete-message failure; the focused suite passed 17/17
and the complete audit passed on the immediate repeat. This is recorded as
transient test evidence, not as a product defect, but repeated-run stability
remains part of QA-1.

Current per-file c8 evidence is 86.51% lines/71.23% branches/95.83% functions
for `profileLauncher.ts`, 89.08%/85.71%/100% for
`profileProcessLauncher.ts`, 94.66%/76.47%/100% for
`profileProxyLaunchCoordinator.ts`, 71.42%/89.28%/38.59% for
`proxyManager.ts`, 95.09%/75%/42.85% for
`proxyManagerDefaultDependencies.ts`, and 94.59%/75%/100% for
`proxyCommands.ts`. Facade cohesion and lower function
coverage remain open QA-7 work; no architecture rule was weakened.

## QA-7.6 and QA-8.5 proxy-command facade checkpoint — 2026-08-25

The proxy command registration facade was split into focused command-family
registrars while preserving the existing VS Code command identifiers and
manager interactions:

- `d5f0d10` extracted start, stop, log, output, and certificate command
  registration helpers from the monolithic `registerProxyCommands` function.
- `ace8c5d` added 8 focused tests covering registration, successful and failed
  starts, missing current profiles, output/log actions, confirmation handling,
  and missing certificates.
- Repowise reports `src/commands/proxyCommands.ts` improving from 2.7/10 to
  3.6/10, with maximum CCN reduced from 11 to 4. Its reported 41.92%
  duplication is a fixture-reuse signal involving test setup and is not being
  treated as production-logic duplication without a semantic review.
- Current c8 coverage for `proxyCommands.ts` is 94.59% lines, 75% branches,
  and 100% functions.
- The repeated CI-equivalent audit passes architecture checks for 292
  production TypeScript files, localization parity for 26 locales and 428
  keys, webview tests 18/18, selected VSIX verification, and global c8 totals
  of 79.06% lines, 73.75% branches, and 78.30% functions. The remote workflow
  for `ace8c5d` is green.

The command facade is now easier to reason about, but QA-7 and QA-8 remain
partial because command-family behavior still needs broader integration,
failure-injection, and lifecycle evidence across the full proxy runtime.

## QA-7.7 and QA-8.6 proxy process composition checkpoint — 2026-08-25

The standalone proxy child-process boundary was decomposed into explicit
configuration, composition, and process-lifecycle responsibilities:

- `f35f835` moved Zod configuration parsing into
  `proxyServerConfigParser.ts`, concrete infrastructure assembly into
  `proxyServerCompositionRoot.ts`, and signal/startup/error handling into the
  injectable `proxyServerProcess.ts` adapter.
- The executable `proxyServer.ts` now remains a narrow compatibility entry
  point that re-exports the existing parser and runtime factory APIs.
- The focused proxy-server suites pass 12/12 tests: 8 configuration/composition
  tests and 4 process-lifecycle tests, together with the pre-existing proxy
  server cases in the same characterization boundary.
- Current c8 evidence is 87.5% lines for `proxyServer.ts`, 100% lines and
  functions for `proxyServerConfigParser.ts`, and 89.33% lines for
  `proxyServerProcess.ts`. The composition root remains intentionally covered
  primarily through safe pre-start shutdown characterization because starting
  a real MITM listener and native SQLite pool belongs to integration/release
  rehearsal evidence.
- The full audit passes Clean Architecture checks for 295 production
  TypeScript files, localization parity for 26 locales and 428 keys, webview
  tests 18/18, selected VSIX verification, and global c8 totals of 79.39%
  lines, 73.77% branches, and 78.15% functions. The remote workflow for
  `f35f835` is green.

Repowise now reports 4,017 nodes and 11,556 edges. `proxyServer.ts` remains a
3.3/10 hotspot because its process-entry behavior is high-risk despite the
smaller facade; this is retained as an explicit integration and child-process
failure-testing follow-up rather than hidden by a coverage exclusion.

## QA-5.6 and QA-8.7 status-bar rendering checkpoint — 2026-08-25

The status-bar adapter received characterization coverage and a focused
rendering decomposition:

- `a3dc6ae` added 6 tests for no-profile selection, loading and cached quota
  rendering, error presentation, profile-only mode, fully hidden mode, and
  detector failure recovery.
- The shared VS Code test mock now provides the `MarkdownString` capability
  required by the real renderer, keeping tests at the adapter boundary instead
  of bypassing UI behavior.
- `refreshDisplay` now delegates account selection, loading, error, quota, and
  common status-item presentation to named private methods. The production
  behavior and existing public API remain unchanged.
- Repowise improved `src/ui/statusBarManager.ts` from 2.6/10 to 3.2/10 and
  reduced maximum CCN from 14 to 11. The remaining marker is retained as a
  follow-up because this VS Code adapter still coordinates configuration,
  profile state, persistence, and rendering.
- Current c8 coverage is 94.59% lines, 84.44% branches, and 93.33% functions
  for `statusBarManager.ts`; the focused suite passes 6/6.
- The full audit passes Clean Architecture checks for 295 production
  TypeScript files, localization parity for 26 locales and 428 keys, webview
  tests 18/18, selected VSIX verification, and global c8 totals of 79.66%
  lines, 74.03% branches, and 78.34% functions. The remote workflow for
  `a3dc6ae` is green.

Graphify now contains 5,190 nodes and 12,112 edges; SQL remains explicitly
excluded because `tree_sitter_sql` is not installed. No coverage exclusion or
architecture rule was weakened.

## QA-7.8 and QA-8.8 compiled proxy-entrypoint checkpoint — 2026-08-25

The process boundary now has one real child-process characterization in
addition to the injectable unit tests:

- `ce00ac0` executes the compiled `out/proxy/proxyServer.js` entry point with
  malformed `CURSOR_ACCOUNTS_PROXY_CONFIG`, and verifies the sanitized startup
  diagnostic and exit status `1`.
- The focused proxy process suite now passes 5/5 tests; the combined proxy
  configuration/process characterization boundary passes 13/13.
- The repeated full audit passes with c8 global totals of 79.68% lines,
  74.12% branches, and 78.53% functions. Child-process coverage now records
  `proxyServer.ts` at 100% lines, branches, and functions; the process adapter
  is at 92% lines, 90.91% branches, and 75% functions.
- The first audit attempt after adding the harness was transiently non-zero;
  the immediate diagnostic rerun passed completely, and the focused suite plus
  the remote workflow for `ce00ac0` are green. Repeated-run stability remains
  tracked under QA-1 rather than being hidden.

The remaining proxy-process work is deliberately integration-oriented:
native SQLite pool behavior, migration recovery, disk-full handling, and
child-process hang/crash recovery require dedicated environment-controlled
tests and are not simulated by this harness.

## QA-7.9 and QA-8.9 real proxy-runtime integration checkpoint — 2026-08-25

Commit `a27300b` adds a real integration boundary around
`ProxyServerRuntime`, using the production `ProxyApiServer`, the production
`PolyglotMitmProxyServer`, and a real `CertificateManager` backed by an
isolated temporary directory:

- The health test starts the real API, verifies the versioned health contract,
  requests shutdown through the HTTP control route, and confirms the runtime
  completes its shared shutdown path.
- The failure-path test occupies the API port, verifies startup rejects the
  collision, and proves that partially started MITM/tracking resources are
  cleaned up in the documented order.
- The end-to-end local listener test starts the actual MITM listener and API
  together, validates the status response and dynamic runtime metadata, then
  shuts both down and verifies that the API is closed and proxy statistics are
  zero.
- The focused integration suite passes 3/3 tests with loopback networking.
  The complete CI-equivalent audit also passes with 79.71% lines, 74.12%
  branches, and 78.86% functions, 295 production TypeScript files, 26
  locales/428 keys, webview tests 18/18, documentation links, and selected
  VSIX verification.
- The remote workflow for `a27300b` is green (run `32846756821`). Its only
  annotation is the repository-wide GitHub Actions Node.js 20 deprecation
  notice; it does not fail the workflow.

This checkpoint proves local composition and cleanup against real listeners,
but it does not claim outbound Cursor traffic, certificate installation,
multi-process SQLite/WAL behavior, migration recovery, disk-full handling, or
child-process crash/hang recovery. Those remain explicit QA-6/QA-7/QA-10
work.

## QA-7.10 and QA-8.10 SQLite fail-closed and multi-process checkpoint — 2026-08-25

Commit `6cce35c` closes a migration atomicity defect and adds real process-level
SQLite evidence:

- `SqliteExecutor.runScript()` now invokes the official SQLite CLI with
  `-bail`, so a migration stops at its first SQL error instead of continuing
  to a later `COMMIT` after a failed statement. The behavior is covered by a
  migration that deliberately conflicts at version 9: the failure remains at
  version 8, added columns are rolled back, and removing the conflict allows a
  clean retry to version 9.
- `BetterSqliteAgentTrackingSchemaInitializer` now propagates an unsuccessful
  `MigrationResult` instead of validating and accepting a partially migrated
  database.
- The concurrency suite now launches two separate compiled Node processes
  against the same WAL database, inserts 200 rows under contention, closes
  both processes, and reopens the database to verify persistence. The full
  SQLite persistence boundary passes 16/16 focused tests.
- The complete audit passes with 79.75% lines, 74.17% branches, and 78.86%
  functions; architecture checks cover 295 production TypeScript files,
  localization remains 26 locales/428 keys, webview tests remain 18/18, and
  VSIX verification passes. The remote workflow for `6cce35c` is green (run
  `32848056357`).
- The reliability assumptions follow the SQLite documentation for WAL
  concurrency, one-writer serialization, busy timeouts, checkpoints, and the
  CLI `-bail` command: [SQLite WAL](https://www.sqlite.org/wal.html),
  [SQLite pragmas](https://www.sqlite.org/pragma.html), and
  [SQLite CLI](https://www.sqlite.org/cli.html).

This checkpoint does not close disk-full/partial-deletion behavior, backup
and restore, checkpoint starvation from long-lived readers, or child-process
hang/crash recovery. Those remain explicit QA-6/QA-7/QA-10 work.

## QA-6.6/QA-7.11/QA-8.11 SQLite artifact and child-stop recovery checkpoint — 2026-08-25

Commit `87ff608` closes two concrete artifact-integrity defects and adds
process-level recovery evidence:

- `SqliteCleanupService.deepClean()` now creates the pre-cleanup backup with
  SQLite `VACUUM INTO` instead of copying only `state.vscdb`. This preserves a
  consistent logical snapshot when committed pages are still represented by a
  WAL sidecar. The integration test creates a real database, verifies that the
  backup contains both the deleted and retained rows, and verifies that the
  cleaned database contains only the retained row.
- `EfficiencyDatabase.fallbackRecreate()` now moves the main database and its
  `-wal`/`-shm` sidecars into the same timestamped `.corrupted-<ms>` artifact
  set. It no longer deletes sidecars or silently unlinks a database when a
  preservation rename fails. A deterministic failure-injection test verifies
  that both sidecars remain recoverable beside the corrupted database.
- `ProxyChildProcessStopCoordinator` now has a real child-process test in which
  the child ignores `SIGTERM`; the coordinator waits the grace period, sends
  `SIGKILL`, detaches the process wrapper, and confirms that the PID is no
  longer alive.
- The focused persistence/storage/process suite passes 56/56 tests. The full
  audit passes with 860 host tests, 79.79% lines, 74.19% branches, 78.94%
  functions, 26 locales/428 keys, webview 18/18, architecture checks, and
  VSIX verification. The remote workflow for `87ff608` is green (run
  `32850441389`).
- The backup choice follows SQLite's documented consistent-snapshot options:
  [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html), the
  [SQLite Online Backup API](https://www.sqlite.org/backup.html), and WAL
  checkpoint behavior in [SQLite WAL](https://www.sqlite.org/wal.html).

This checkpoint does not close disk-full/partial-deletion behavior, restore
automation, checkpoint starvation from a long-lived reader, or crash-restart
reconciliation. The current backup artifacts are preserved for manual
recovery, but a future slice must prove restoration and failure reporting.

## QA-6 security checkpoint — 2026-08-25

Commit `c7c28a8` closes a concrete disclosure path in the local proxy API:
`apiErrorHandler` no longer serializes raw exception messages, which could
contain filesystem paths, parser details, or synthetic secrets. It returns the
stable public message `Proxy API request failed`; a regression test verifies
that attacker-controlled error text is absent.

The threat model is documented in
[SECURITY-THREAT-MODEL.md](SECURITY-THREAT-MODEL.md), covering assets,
collection policy, loopback and capability-token decisions, webview safety,
header/body redaction, sidecar containment, rotation, and residual risks.

Focused security evidence passes 16/16 tests for API error serialization,
loopback validation, REST/WebSocket token parity, body redaction, sidecar
traversal, and selective cleanup. The full CI-equivalent audit also passes,
including coverage, localization, documentation links (49 files), webview
18/18, and selected VSIX verification.

Repowise history scanning on 2026-08-25 covered 168 commits, 4,340 blobs, and
2,516 files with zero inserted findings. This does not replace runtime tests:
disk-full/partial-deletion/WAL behavior, process and certificate diagnostics,
protobuf redaction, and removal of the legacy optional-token path remain open.

QA-6 remains PARTIAL until those residual risks have tests and an explicit
compatibility decision.

## QA-7.1 proxy tracking shutdown checkpoint — 2026-08-25

Commit `2f0352f` hardens the shared proxy's tracking ingress lifecycle. The
ingress still rejects new agent-metrics work after shutdown begins, drains all
per-profile tails before closing the database pool, and now shares one in-flight
close promise across concurrent shutdown callers. This prevents duplicate pool
closure when API shutdown, process cleanup, or an overlapping lifecycle path
reaches the same ingress.

The focused suite passes 4/4 tests, including per-profile ordering,
independent profiles, drain-before-close, and concurrent-close idempotency.
The implementation remains intentionally small and inside the application
boundary: the ingress coordinates the domain service and the database port;
the concrete SQLite pool remains in infrastructure.

This checkpoint does not close QA-7. Multi-process SQLite/WAL behavior,
failure-injection, migration recovery, disk-full/partial-cleanup behavior, and
child-process hang/crash recovery still require dedicated evidence.

## QA-6.4 certificate platform-boundary checkpoint — 2026-08-25

Commit `91f3586` fixes an unsupported-platform correctness and safety defect in
the certificate lifecycle. `installCaCertificateElevated` and
`uninstallCaCertificate` now reject platforms other than macOS and Windows
before running verification or spawning a process. Linux continues to return
the documented manual-install/manual-removal instructions. Previously,
uninstalling on an unknown platform could return success merely because the
certificate was not found.

The focused certificate suite passes 11/11 tests, including shell escaping,
command construction, Linux policy, unsupported-platform behavior, and the
regression case. The full CI-equivalent audit passes. Native process exit,
UAC/certificate command failure injection, and cross-platform execution remain
open because they require supported operating-system runners or injectable
process seams.

## QA-8.2 certificate process-boundary checkpoint — 2026-08-25

Commit `9ef232a` introduces the `CertificateProcessRunner` seam while keeping
the Node `spawn` implementation as the production default. Installation,
verification, and removal now use the same injected runner, so tests can cover
command ordering and post-operation verification without invoking privileged
macOS or Windows commands.

The focused suite passes 16/16 tests, including successful macOS installation,
permission normalization, cancelled Windows installation, successful
post-removal verification, and bounded process timeout escalation. The current
c8 record reports 262/337 lines, 36/51 branches, and 12/12 functions for
`installCaCertificate.ts`. The seam does not claim real administrator/UAC
execution; that remains a cross-platform release-matrix responsibility. After
the final Repowise re-index, its health report still shows approximately 26%
coverage for this file, so the c8 report is the authoritative coverage
evidence and the Repowise ingestion mismatch is tracked as an unresolved
tooling issue, consistently with `proxyDecode.ts`.

## QA-6.5 certificate process timeout checkpoint — 2026-08-25

Commit `542ae58` hardens the default certificate process runner. Certificate
commands now use an explicit 120-second timeout; a timed-out child receives
`SIGTERM`, followed by `SIGKILL` after a one-second grace period if it has not
exited. The promise resolves only after the child closes, and reports a
specific timeout error, preventing a hung `osascript` or PowerShell process
from surviving a failed installation attempt.

The focused certificate suite passes 16/16 tests, including a real child
process that exceeds the timeout and is terminated by the escalation path.
The full CI-equivalent audit passes. Native administrator/UAC behavior and
platform-specific command execution remain open because they require supported
macOS and Windows release runners.

Repowise now scores `installCaCertificate.ts` at 2.5/10 after re-indexing,
down from 1.0/10 before the module split. CCN decreased from 13 to 6 and NLOC
from 298 to 116. Coverage-gap, coverage-gradient, churn, and platform-command
evidence remain open; the score improvement does not make this file complete.

## QA-8.3 certificate platform module split — 2026-08-25

Commits `47526de` and `ef3d6e5` split certificate process execution, command
construction, and macOS/Windows operations into private infrastructure modules
behind the `installCaCertificate.ts` facade. Existing public builders and
result types remain re-exported, while platform strategies are no longer
exposed as unused public symbols. This keeps shell/PowerShell escaping,
process execution, verification, and install/removal orchestration in separate
responsibilities without changing the caller contract.

Repowise records the structural improvement from 1.0/10 to 2.5/10, CCN 13 to
6, and NLOC 298 to 116. The focused certificate suite remains 16/16 and the
full CI-equivalent audit passes. The remaining coverage-gradient and
platform-command evidence require native macOS/Windows runners.

## QA-7.2 proxy child failure cleanup checkpoint — 2026-08-25

Commit `e9cdc6c` closes two resource-lifecycle gaps in the standalone proxy
entrypoint. If API or MITM startup fails after resources have been constructed,
the failure path now attempts to stop the MITM server, drain and close the
tracking ingress, and stop the API server before exiting with status 1. The
child also registers `SIGTERM` and `SIGINT` handlers that use the normal
draining shutdown path, protecting queued SQLite writes when a supervisor
cannot reach the control API.

The focused proxy entrypoint suite passes 5/5 tests, the tracking lifecycle
suite passes 4/4 tests, and the full CI-equivalent audit passes. The signal and
startup-failure branches are composition-root behavior and remain candidates
for a future injectable lifecycle harness; this checkpoint therefore records
the implementation and compile/runtime evidence without claiming complete
failure-injection coverage.

## QA-7.3 proxy child lifecycle checkpoint — 2026-08-25

Commit `5599974` hardens the `NodeProxyProcess` application boundary. A
second `start()` call now fails while the existing child is alive, preventing
orphaned proxy processes and ambiguous exit ownership. The child reference is
cleared only when the exiting child is still the current child, so a natural
exit cannot erase a newer process reference. The existing stderr and exit
event forwarding behavior is characterized by focused tests.

The focused `NodeProxyProcess` suite passes 5/5 tests, including missing
script handling, non-running process state, absent IPC, duplicate-start
rejection, stderr forwarding, exit-code propagation, and reference cleanup.
The full CI-equivalent audit passes. This checkpoint does not claim complete
crash recovery or hang detection: supervisor escalation, forced termination,
child startup races, and multi-process behavior remain open QA-7 work.

## QA-7.4 proxy runtime orchestration checkpoint — 2026-08-25

Commit `93fdbb7` extracts the standalone proxy lifecycle coordinator into the
application-layer `ProxyServerRuntime`. The executable composition root now
assembles infrastructure and owns environment parsing and process exit, while
the runtime coordinates API-before-MITM startup, traffic persistence and
redaction, periodic statistics/diagnostics, proxy error publication, and
ordered shutdown. A shared shutdown promise ensures concurrent API and signal
shutdown requests wait for the same cleanup operation instead of allowing a
second caller to exit while the first is still draining resources.

The focused runtime suite passes 3/3 tests for startup ordering, startup
failure cleanup, traffic redaction, error publication, and concurrent shutdown
idempotency. The full CI-equivalent audit passes. Current c8 coverage for
`ProxyServerRuntime` is 132/147 lines, 15/17 branches, and 7/11 functions.
The remaining entrypoint composition and real signal/exit paths require a
process-level harness; this checkpoint does not claim those paths are fully
covered.

## QA-8.1 decoder hotspot checkpoint — 2026-08-25

Commit `2d9fe05` refactored `src/proxy/proxyDecode.ts` into explicit
responsibilities without changing its public decoder contract:

- JSON decoding and redaction are isolated from binary/protobuf decoding;
- RPC message-type resolution is separated from payload attempts;
- payload decoding and error capture are deterministic and bounded;
- shared insight finalization is performed through one helper;
- malformed, unknown, empty, JSON, binary, and relative/malformed URL cases
  are covered by focused tests.

The focused decoder/Connect suite passes 22/22 tests. The full audit passes,
including lint/typecheck, architecture (282 production files), all host tests,
coverage floors, webview 18/18, and VSIX verification. The current c8 lcov
record reports 199/217 covered lines (91.7%) and 50/50 covered branches (100%)
for `proxyDecode.ts`.

Repowise health after re-indexing reports the structural improvement from the
pre-refactor signal (CCN 24, nesting 5, duplication 31.65%) to CCN 11,
nesting 3, duplication 9.23%, and score 1.5. Its coverage field still reports
27.17% for this file despite the current c8 lcov record, so the discrepancy is
tracked as a tooling-integration issue rather than treated as resolved
coverage evidence.

QA-8 remains PARTIAL. The next risk-based candidates are `proxyServer.ts`,
`installCaCertificate.ts`, `statusBarManager.ts`, `profileLauncher.ts`, and
the high-fan-out contract barrels. Each requires characterization tests before
any extraction.

## Reclassification decisions

The following historical findings are reclassified from the current baseline:

| Historical finding | Current classification | Reason |
|---|---|---|
| Webview DOM leakage | PARTIALLY RESOLVED | Current webview suite passes 18/18; repeated and shuffled-run evidence remains |
| Localization key parity | RESOLVED FOR CURRENT BASELINE | All 26 locales currently contain 428 keys; fallback and translation policy still need explicit documentation |
| Source lint and coverage gate | PARTIALLY RESOLVED | Repository audit passes; generated-artifact policy and broader local floors remain |
| Current VSIX verification | RESOLVED FOR SELECTED ARTIFACT | Clean-room and release matrix remain open |
| Production advisories | PARTIALLY RESOLVED | Current `pnpm audit --prod` reports zero advisory records; clean-room shipped-tree evidence remains open |
| Domain/application dependency direction | PARTIALLY RESOLVED | Current resolved production graph has no violations; checker and fixtures now use TypeScript AST, package resolution, line-level rules, and fail-closed relative imports |
| Native runtime reproducibility | OPEN | Existing artifact passes; clean-room ABI matrix remains unverified |
| Token and cost semantic correctness | OPEN | No complete golden event-to-cost reconciliation corpus exists |
| Security/privacy residuals | PARTIAL | Several controls exist; retention, disk-full, process, and threat-model evidence remain |

## Commit and evidence log

| Date | Task | Commit | Evidence |
|---|---|---|---|
| 2026-08-25 | QA-0 baseline capture and register creation | fa1bb12 | Current audit outputs in /private/tmp/qa0-*; immutable baseline recorded before remediation |
| 2026-08-25 | QA-2 dependency/native cleanup slice | 03b9fe6 | SDK upgrade, sqlite3 removal, targeted overrides, clean install, production audit 0, native smoke test, and full audit pass |
| 2026-08-25 | QA-3 native packaging reproducibility slice | 50bdcc2 | Dynamic Electron ABI, official prebuild digest verification, native archive tests, runtime-tree sanitization, pnpm 10.34 frozen install, current-target build, production audit 0, signatures 830/830, and full audit pass |
| 2026-08-25 | QA-5 Clean Architecture enforcement slice | 7618984 | TypeScript-AST/resolver checker, package-source fallback, production test exclusion, line/rule/JSON diagnostics, negative fixtures, architecture contract, contributor guidance, full audit pass |
| 2026-08-25 | QA-6.1 safe API error serialization slice | c7c28a8 | Generic public API errors, sensitive-message regression test, security threat model, focused 16/16 security tests, Repowise history scan with zero findings, and full audit pass |
| 2026-08-25 | QA-8.1 proxy decoder hotspot slice | 2d9fe05 | Decoder branch extraction, 22/22 focused tests, c8 91.7% lines and 100% branches for proxyDecode.ts, Repowise CCN/nesting/duplication improvement, full audit pass, remote workflow success |
| 2026-08-25 | QA-7.1 tracking ingress shutdown lifecycle slice | 2f0352f | Idempotent concurrent close, drain-before-close guarantee, 4/4 focused tests, CI-mode lint/typecheck/pretest pass, Graphify refresh; multi-process and failure-injection evidence remain open |
| 2026-08-25 | QA-7.2 proxy child failure cleanup slice | e9cdc6c | Startup failure cleanup, graceful SIGTERM/SIGINT handling, 5/5 proxy entrypoint tests, 4/4 ingress lifecycle tests, full audit pass, remote workflow pending |
| 2026-08-25 | QA-6.4 certificate platform-boundary slice | 91f3586 | Unsupported-platform uninstall bug fixed, Linux policy preserved, 11/11 focused tests, c8 certificate coverage 39.39%, full audit pass, remote workflow pending |
| 2026-08-25 | QA-8.2 certificate process-boundary slice | 9ef232a | Injected process runner, 15/15 focused tests, c8 certificate coverage 69.96% lines/69.56% branches/91.66% functions, full audit pass; native privileged execution remains open |
| 2026-08-25 | QA-7.3 proxy child lifecycle slice | 5599974 | Duplicate-start guard, identity-safe natural-exit cleanup, stderr/exit characterization, 5/5 focused tests, c8 `nodeProxyProcess.ts` coverage 103/113 lines, 21/25 branches, and 10/10 functions, full audit pass; crash/hang recovery remains open |
| 2026-08-25 | QA-7.4 proxy runtime orchestration slice | 93fdbb7 | Application-layer runtime extraction, ordered cleanup, shared concurrent-shutdown promise, 3/3 focused runtime tests, c8 runtime coverage 132/147 lines, 15/17 branches, and 7/11 functions, full audit pass; process-level signal/exit harness remains open |
| 2026-08-25 | QA-6.5 certificate process timeout slice | 542ae58 | Explicit 120-second timeout, SIGTERM/SIGKILL escalation, 16/16 focused certificate tests, c8 coverage 262/337 lines/36/51 branches/12/12 functions, full audit pass; native privileged execution remains open |
| 2026-08-25 | QA-8.3 certificate platform module split | 47526de, ef3d6e5 | Separated process runner, command builders, and platform operations behind the public facade; Repowise installCaCertificate score 1.0→2.5, CCN 13→6, NLOC 298→116, 16/16 focused tests, full audit pass; native platform execution remains open |
| 2026-08-25 | QA-7.5/QA-8.4 profile launch and proxy composition slices | 4535d73, 1394eb4, d944663, f534f8c, 24ab634 | Process/proxy ports, launch workflow seams, ProxyManager dependency extraction and ordered coordinator setup; focused launcher suites 33/33, Repowise ProfileLauncher 1.86→4.3, ProxyManager 1.98→3.13, full audit pass, remote workflows green |
| 2026-08-25 | QA-7.6/QA-8.5 proxy command facade slice | d5f0d10, ace8c5d | Split command registration into focused helpers; 8/8 focused tests; c8 `proxyCommands.ts` coverage 94.59% lines/75% branches/100% functions; Repowise 2.7→3.6 and maximum CCN 11→4; repeated full audit pass; remote workflow green |
| 2026-08-25 | QA-7.7/QA-8.6 proxy process composition slice | f35f835 | Extracted configuration parsing, infrastructure composition, and injectable process lifecycle; focused proxy suites 12/12; c8 `proxyServer.ts` 87.5% lines, parser 100% lines/functions, process adapter 89.33% lines; full audit pass; remote workflow green |
| 2026-08-25 | QA-5.6/QA-8.7 status-bar rendering slice | a3dc6ae | Added 6/6 StatusBarManager characterization tests, extracted named rendering states and shared status-item presentation, c8 94.59% lines/84.44% branches/93.33% functions, Repowise 2.6→3.2 and CCN 14→11, full audit pass, remote workflow green |
| 2026-08-25 | QA-7.8/QA-8.8 compiled proxy-entrypoint slice | ce00ac0 | Added child-process characterization for malformed configuration; focused process suite 5/5 and combined proxy boundary 13/13; c8 `proxyServer.ts` 100% lines/branches/functions and process adapter 92% lines/90.91% branches/75% functions; full audit rerun pass; remote workflow green |
| 2026-08-25 | QA-7.9/QA-8.9 real proxy-runtime integration slice | a27300b | Added 3/3 real API/MITM lifecycle and failure-path integration tests; full audit pass at 79.71%/74.12%/78.86%; Graphify 3,936 nodes/10,665 edges; Repowise 4,044 nodes/10,227 edges and safe-only dead-code empty; remote workflow 32846756821 green |
| 2026-08-25 | QA-7.10/QA-8.10 SQLite fail-closed and multi-process slice | 6cce35c | Added SQLite CLI fail-fast execution, migration-result propagation, rollback/retry characterization, schema-initializer failure coverage, and two-process WAL/reopen coverage; 16/16 focused tests; full audit at 79.75%/74.17%/78.86%; Graphify 3,942 nodes/10,681 edges; Repowise 4,049 nodes/10,241 edges; remote workflow 32848056357 green |
| 2026-08-25 | QA-6.6/QA-7.11/QA-8.11 SQLite artifact and child-stop recovery slice | 87ff608 | Replaced raw database copying with `VACUUM INTO`, preserved corrupted database sidecars, added real SIGTERM-ignore/SIGKILL escalation coverage, 56/56 focused tests, full audit at 79.79%/74.19%/78.94%, Graphify 5,207 nodes/12,180 raw edges, Repowise average health 8.46/10 and safe-only dead-code empty, remote workflow 32850441389 green |

This register must be updated in the same commit as each task's implementation
or evidence change.
