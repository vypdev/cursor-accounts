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
| QA-1 | CI, tests, localization, lint | PARTIAL | Full audit passes with loopback access: 800 tests, 26 locales, 428 keys, webview 18/18, coverage floors; three repeated webview runs pass | Add repeated host-run evidence and review generated-artifact/source-lint policy |
| QA-2 | Dependencies and supply chain | PARTIAL | SDK `1.0.28`, legacy npm `sqlite3` removed, targeted `uuid@11.1.1` and `undici@6.28.0` overrides resolve; `pnpm audit --prod` reports 0 advisories and signatures remain valid | Add clean-room shipped-tree scan, package-size review, and independent compatibility evidence before marking complete |
| QA-3 | Native runtime and packaging | PARTIAL | Current-target clean build passes with dynamic Electron ABI 128, official SHA-256 validation, sanitized runtime native tree, and VSIX verification | Execute clean-room install from an empty store/workspace and expand evidence across the supported target matrix |
| QA-4 | Token and cost correctness | PARTIAL | Accounting contract, authoritative server-cost precedence, model-aware fallback calculation, non-finite input guards, and SQLite replay golden test are implemented | Expand coverage across all decoder shapes, pricing refresh/versioning, rounding policy, and unknown/cache-rate reconciliation |
| QA-5 | Clean Architecture enforcement | PARTIAL | TypeScript-AST resolver-backed checker passes for 282 production files; negative fixtures cover domain/application/package/cycle cases; current Graphify/Repowise hotspots remain | Refactor the highest-risk low-coverage infrastructure modules without weakening the contract, then add characterization and failure-path tests |
| QA-6 | Security and privacy | PARTIAL | Threat model recorded; API error details are generic; loopback/token parity, redaction, sidecar safety, text-safe webview rendering, certificate platform validation, injected certificate-process failure tests, and Repowise history scan are evidenced | Complete retention/disk-full/WAL tests, native command/timeout execution review on supported OS runners, protocol-specific redaction, and the legacy optional-token decision |
| QA-7 | Reliability and lifecycle | PARTIAL | Tracking ingress shutdown is idempotent; proxy startup failures now attempt MITM/ingress/API cleanup; direct `SIGTERM`/`SIGINT` uses graceful shutdown; focused lifecycle/entrypoint/process/runtime tests pass 17/17 | Add multi-process/WAL, failure-injection, migration-recovery, disk-lifecycle, and child-process hang tests |
| QA-8 | Local test confidence | PARTIAL | `proxyDecode.ts` has 91.7% c8 lines and 100% c8 branches with 22 focused tests; certificate process/platform boundaries have 15/15 focused tests and 69.96% c8 lines, 69.56% branches, and 91.66% functions; `nodeProxyProcess.ts` has 103/113 c8 lines, 21/25 branches, and 10/10 functions with 5 focused tests; `ProxyServerRuntime` has 132/147 c8 lines, 15/17 branches, and 7/11 functions with 3 focused tests; Repowise still identifies remaining hotspots and retains stale coverage indexes | Reconcile static-analysis coverage ingestion, add risk-based floors, and cover the next proxy/profile/process hotspots |
| QA-9 | Documentation and operations | PARTIAL | Plan, audit links, dependency inventory, advisory register, and English docs are synchronized for this slice | Add task/decision records, reproducible audit artifact output, and runbooks |
| QA-10 | Independent final audit and release rehearsal | OPEN | Not started | Run only after QA-1 through QA-9 have current evidence |

## QA-0 evidence

### Repository and tooling

| Item | Value |
|---|---|
| Branch | feature/3-mitm-proxy |
| Latest implementation commit | 93fdbb7 |
| Latest documentation commit | de9e730 |
| Node | v22.23.1 |
| pnpm | 11.19.0 |
| Graphify | 0.9.48 |
| Repowise | 0.45.0 |
| Architecture gate | 284 production TypeScript files; tests excluded by contract |
| Documentation gate | 49 Markdown files |

### Reproducible audit

pnpm run audit passed on 2026-08-25 with:

- extension-host tests: 800/800 across 254 suites;
- coverage: 77.65% lines, 73.52% branches, 77.23% functions;
- architecture rules and fixtures: passed;
- localization: 26 locales with 428 keys each;
- webview tests: 5 files and 18 tests passed;
- current VSIX content verification: passed.

The current-target VSIX check proves the selected artifact is internally
consistent. It does not prove clean-room reproducibility or the full platform
matrix; those remain QA-3 work.

### Graphify

The latest code-only graph contains 5,056 nodes and 11,716 edges. The highest
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

The focused suite passes 15/15 tests, including successful macOS installation,
permission normalization, cancelled Windows installation, and successful
post-removal verification. The current c8 record reports 69.96% lines,
69.56% branches, and 91.66% functions for `installCaCertificate.ts`. The seam
does not claim real administrator/UAC execution; that remains a cross-platform
release-matrix responsibility. After the final Repowise re-index, its health
report still shows approximately 26% coverage for this file, so the c8 report
is the authoritative coverage evidence and the Repowise ingestion mismatch is
tracked as an unresolved tooling issue, consistently with `proxyDecode.ts`.

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

This register must be updated in the same commit as each task's implementation
or evidence change.
