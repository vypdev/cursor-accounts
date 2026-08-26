# Quality Hardening Task Register

Last reviewed: 2026-08-26

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
| QA-0 | Baseline and finding reclassification | COMPLETE | pnpm run audit passes; current Graphify/Repowise/dependency evidence captured on 2026-08-26 | Keep this baseline immutable and update it after every cross-cutting change |
| QA-1 | CI, tests, localization, lint | PARTIAL | Full audit passes with 888 host tests, 81.51% lines, 74.78% branches, and 78.26% functions; localization is 26 locales/428 keys and webview is 18/18 | Add repeated host-run evidence and review generated-artifact/source-lint policy |
| QA-2 | Dependencies and supply chain | PARTIAL | SDK `1.0.28`, legacy npm `sqlite3` removed, targeted `uuid@11.1.1` and `undici@6.28.0` overrides resolve; pinned pnpm 10.34 production audit reports 0 advisories; isolated pnpm 11.19 signature audit verifies 163/163 packages; CycloneDX 1.5 SBOM contains 163 components; clean VSIX tree has no package-manager store; `audit:supply-chain` now automates the checks and CI/release/hotfix upload the report for 14 days | Review Cursor vendor terms and semaphore MIT attribution, decide release SBOM retention, and close the final attribution policy before marking complete |
| QA-3 | Native runtime and packaging | PARTIAL | Current-target clean build passes with target-specific Electron ABI 128, official SHA-256 validation, sanitized runtime native tree, clean-room Node 24/pnpm 10 installation, and 49,430,263-byte (47.14 MiB) VSIX verification; darwin-arm64 and linux-arm64 cross-target builds pass with embedded native-header validation | Expand evidence across the complete darwin, Linux, and Windows target matrix on their intended runners |
| QA-4 | Token and cost correctness | PARTIAL | Accounting contract, authoritative server-cost precedence, model-aware fallback calculation, non-finite input guards, SQLite replay golden test, versioned pricing metadata, current visible Cursor model rates, exact fast-variant pricing, and migration 010 provenance persistence are implemented; focused provenance coverage passes | Complete decoder-shape, rounding, and unknown/cache-rate reconciliation coverage |
| QA-5 | Clean Architecture enforcement | PARTIAL | TypeScript-AST resolver-backed checker passes for 310 production files; negative fixtures cover domain/application/package/cycle cases; storage cleanup now keeps efficiency-event SQLite construction behind a domain port and persistence adapter; current Graphify/Repowise hotspots remain | Refactor the highest-risk low-coverage infrastructure modules without weakening the contract, then add characterization and failure-path tests |
| QA-6 | Security and privacy | PARTIAL | Threat model recorded; API error details are generic; loopback/token parity, redaction, sidecar safety, text-safe webview rendering, certificate platform validation, injected certificate-process failure tests, bounded certificate-process timeout/kill escalation, fail-closed migration execution, SQLite snapshot backup/restore validation, sidecar preservation, partial-cleanup accounting, and Repowise history scan are evidenced | Complete disk-full/crash-restart testing, native privileged command execution review on supported OS runners, protocol-specific redaction, and the legacy optional-token decision |
| QA-7 | Reliability and lifecycle | PARTIAL | Tracking ingress shutdown is idempotent; MITM startup is single-flight, transactional on listener failure, and bounded during close; proxy startup failures attempt MITM/ingress/API cleanup; direct `SIGTERM`/`SIGINT` uses graceful shutdown; the real runtime integration suite passes 3/3; SQLite persistence has 2-process concurrency/reopen, migration rollback/retry, consistent backup, validated restore, corrupted-database sidecar preservation, partial cleanup reporting, long-lived-reader checkpoint evidence, and real child hang escalation coverage | Add disk-full/crash-restart reconciliation and release-level recovery rehearsal |
| QA-8 | Local test confidence | PARTIAL | Full audit passes 888 host tests and 18 webview tests; overall c8 is 81.51% lines/74.78% branches/78.26% functions; the storage cleanup/persistence focused run passes 23/23 including real efficiency-event retention and adapter behavior; the SQLite/storage focused suites previously passed 27/27 including restore, partial cleanup, and long-lived-reader cases; `proxyDecode.ts` has 91.7% c8 lines and 100% c8 branches; certificate process/platform boundaries have 16/16 focused tests; `nodeProxyProcess.ts` has 91.15% lines, 88% branches, and 100% functions; `ProxyServerRuntime` has 3/3 real integration tests; the usage-extraction and agent/context split suites pass 43/43 focused tests; the MITM request-capture boundary passes forwarding 1/1, streaming 2/2, runtime integration 3/3, direct response-adapter coverage 1/1, summary-dispatch coverage 2/2, error-handler/filter coverage 6/6, lifecycle coverage 7/7, and handler-composition coverage 1/1; Repowise still identifies remaining hotspots | Reconcile static-analysis coverage ingestion, add risk-based floors, and cover the next proxy/profile/process hotspots |
| QA-9 | Documentation and operations | PARTIAL | Plan, audit links, dependency inventory, advisory register, and English docs are synchronized for this slice | Add task/decision records, reproducible audit artifact output, and runbooks |
| QA-10 | Independent final audit and release rehearsal | OPEN | Not started | Run only after QA-1 through QA-9 have current evidence |

## QA-0 evidence

### Repository and tooling

| Item | Value |
|---|---|
| Branch | feature/3-mitm-proxy |
| Latest implementation commit | 9d2e00c |
| Latest documentation checkpoint | Current branch HEAD (this register) |
| Node | v24.19.0 (nvm-managed via `.nvmrc`) |
| pnpm | 10.34.0 (Corepack, declared by `package.json#packageManager`) |
| Graphify | 0.9.48 |
| Repowise | 0.45.0 |
| Architecture gate | 308 production TypeScript files; tests excluded by contract |
| Documentation gate | 50 Markdown files |

### Reproducible audit

The latest `pnpm run audit` passed on 2026-08-26 with:

- extension-host tests: passed across the compiled host test suite;
- 885 host tests and coverage of 81.13% lines, 75.02% branches, and 78.02%
  functions;
- architecture rules and fixtures: passed for 308 production TypeScript files;
- localization: 26 locales with 428 keys each;
- webview tests: 5 files and 18 tests passed;
- current VSIX content verification: passed.

The current-target VSIX check proves the selected artifact is internally
consistent. It does not prove clean-room reproducibility or the full platform
matrix; those remain QA-3 work.

### Node 24 toolchain checkpoint

The repository now has one explicit Node.js toolchain contract:

- `.nvmrc` and `.node-version` select Node 24;
- `package.json#engines.node` requires `>=24 <25`;
- `package.json#packageManager` pins pnpm `10.34.0`, activated through Corepack;
- `@types/node` follows the Node 24 major line;
- CI uses `actions/setup-node@v6` with `node-version-file: .nvmrc` and
  `actions/checkout@v5`;
- local setup and build documentation instruct contributors to run
  `corepack enable` before using pnpm.
- `scripts/verify-toolchain.mjs` fails closed when either the Node major or the
  exact pnpm version differs from those declarations. It is executed by the
  audit runner, the build runner, and every CI/release packaging job.

Evidence collected on 2026-08-25 under Node `v24.19.0` (Node module ABI 137)
and pnpm `10.34.0`:

- `CI=true pnpm install --frozen-lockfile`: passed, including native rebuild
  and SQLite runtime verification;
- `CI=true pnpm run audit`: passed, including 296-file architecture checks,
  864 host tests, 18 webview tests, localization parity, documentation links,
  coverage floors, and VSIX contents;
- `CI=true pnpm run build:current`: passed, including the Electron ABI 128
  native binding, SDK platform package, `undici`, `bindings`, migration files,
  and forbidden-artifact checks;
- `pnpm run verify:vsix`: passed against the generated current-platform VSIX.
- `CI=true pnpm run audit` and `CI=true pnpm run build:current` passed again
  after the toolchain contract was added, with loopback and temporary-file
  access enabled for integration tests.

The packaging compatibility shim now maps hoisted transitive dependencies to
visible `node_modules` paths before VSCE invokes npm-packlist. VSIX verification
accepts both hoisted and virtual-store layouts, so it validates runtime
contents rather than a pnpm implementation detail. Clean-room installation and
the complete supported-target matrix remain open acceptance criteria.

The current dependency-security, signature, SBOM, and production-license
evidence is recorded in
[SUPPLY-CHAIN-EVIDENCE-2026-08-25.md](SUPPLY-CHAIN-EVIDENCE-2026-08-25.md).

### Graphify

The latest graph was generated with Graphify `0.9.48` on commit `9d2e00c` using
no clustering. It contains 5,395 nodes and 12,764 raw edges; 644 files were
uncached during extraction, and the post-build graph contains 11,008 edges.
The highest relevant
hotspots include:

- `t()`: degree 102;
- ProxyManager: degree 71;
- scripts: degree 63;
- ProxyTrafficSummary: degree 61;
- IAgentTrackingRepository: degree 38;
- IProfileReader: degree 45;
- IProfileDetector: degree 44;
- `activate()`: degree 42.

Graphify skipped ten SQL contributions because `tree_sitter_sql` is not
installed and skipped `.npmrc` as potentially sensitive. The multigraph
diagnostic reports 1,561 dangling endpoint edges, one self-loop, no missing
endpoints, and 104 same-endpoint relation groups; these are analysis signals,
not architecture violations by themselves. The generated graph is ignored by
Git and is not a release artifact.

### Repowise

- Safe-only dead-code analysis: no findings. The index reports three heuristic
  unreachable files and 26 unused exports, but none is safe for automatic
  deletion without entrypoint and bundle reachability review.
- Historical security scan: 0 findings across 214 commits, 4,539 blobs, and
  2,578 files.
- Current refactoring targets include proxyDecode.ts, proxyServer.ts,
  installCaCertificate.ts, statusBarManager.ts, efficiencyService.ts,
  profileCommands.ts, IProxyManager.ts, and high-fan-out type barrels.

The latest Repowise health report scores average health at 8.46/10, hotspot
health at 5.72/10, and performance at 9.91/10. The extracted insight facade
remains at NLOC 99 with max CCN 20; its remaining high-complexity function is
`extractInsightsForRpc` (CCN 20). The response adapter is now covered by a
direct unit test and scores 7.3/10 at NLOC 227 and max CCN 10. The lowest
current production targets include `src/proxy/mitmProxyServer.ts` (4.9/10,
NLOC 231, max CCN 6),
`src/services/proxyManager.ts` (3.14/10, NLOC 640), and
`src/services/storageCleanupService.ts` (3.26/10, NLOC 284, 37.17%
duplication). These are prioritization signals, not automatic extraction
requirements. Safe-only dead-code analysis remains empty.

The new `src/proxy/mitmProxyErrorHandler.ts` remains at 9.0/10 with NLOC 43,
max CCN 9, nesting 1, and a dedicated test. The new
`src/proxy/mitmProxyLifecycle.ts` scores 9.7/10 with NLOC 39, max CCN 3,
nested depth 2, and focused coverage; its only marker is a low-severity
historical defect signal. The new handler-registration boundary scores 10.0/10
with NLOC 26, max CCN 1, and nested depth 0. The server startup method remains
the next proxy hotspot and is intentionally retained as the composition root
while its lifecycle seams gain more characterization and failure-path coverage.

Repowise sync metadata still points to commit
`750e835d0cc55997aa30594eb8cf56f130d5f7e4`, with no embedding provider or
model configured. Its health output is therefore treated as a heuristic
source-code signal, not as a release gate; the missing real embedder is an
explicit tooling limitation and does not block the deterministic audit.

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

The historical baseline used `pnpm audit signatures --json` while the local
environment was still running a pnpm 11 fallback. The repository now pins pnpm
10.34.0, and the official pnpm documentation records the signature command as
introduced in pnpm 11.1.0. Running that command with the pinned tool therefore
does not provide signature evidence; it re-enters the normal advisory audit
path. This paragraph records the historical limitation and is intentionally
not a current signature result. The current evidence uses an explicitly
isolated pnpm 11.19.0 auditor and is recorded in
[SUPPLY-CHAIN-EVIDENCE-2026-08-25.md](SUPPLY-CHAIN-EVIDENCE-2026-08-25.md).
The [pnpm audit documentation](https://pnpm.io/cli/audit) is the source for
the version boundary.

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

The historical post-remediation signature check reported 830 verified
packages, with zero invalid and zero missing signatures; the immutable
pre-remediation baseline reported 852. The current production graph has a
separate 163/163 signature result documented in the current supply-chain
evidence checkpoint.

QA-2 remains PARTIAL until the clean shipped-tree evidence is complemented by
the supported signature-audit utility, SBOM/license review, and an independent
compatibility decision for the remaining build-only dependency paths.

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
- The earlier sanitized checkpoint was 28 MiB with 3,085 entries and retained
  the runtime `better_sqlite3.node` while removing the source tree and native
  build intermediates. The current artifact is 49,430,263 bytes (47.14 MiB)
  with 12,360 ZIP entries.
- The build was repeated after hardening `scripts/ensure-node.sh` against an
  inherited `npm_config_prefix`; the resulting artifact still passes native,
  dependency, and VSIX verification.
- A clean-room installation from the pushed commit downloaded 723 packages
  into an empty external store under Node `v24.19.0` and pnpm `10.34.0`. The
  current-target build and `pnpm run verify:vsix` both passed.
- A deliberately invalid first clean-room experiment placed the pnpm store
  inside the checkout and produced a 1.3 GB artifact. The corrected run keeps
  the store outside the checkout and produces a 49.46 MB artifact. The local
  `.pnpm-store/` and `pnpm-store/` paths are now excluded by `.vscodeignore`,
  and both build-time and standalone VSIX verification reject them if they are
  ever packaged.
- The clean-room artifact from this checkpoint was 49,429,715 bytes with
  12,360 ZIP entries and 700 package manifests. It contains `@cursor/sdk`,
  `undici`, `bindings`, the Electron ABI 128 `better_sqlite3.node`, and the
  efficiency migrations; no package-manager store is shipped. The extracted
  native file is a Mach-O arm64 binary.
- The latest target-specific build on 2026-08-26 is 49,430,263 bytes and
  independently confirms the same `darwin-arm64` native target inside the
  VSIX. The small byte difference is retained as build-run evidence rather
  than treated as a reproducibility failure.
- A cross-target `linux-arm64` build from the macOS host downloaded
  `better-sqlite3-v12.9.0-electron-v128-linux-arm64.tar.gz`, packaged the
  Linux ARM64 SDK and SQLite CLI, and passed both build-time and standalone
  native-target verification. This proves target selection and packaging;
  executable smoke testing still belongs to the Linux ARM64 runner gate.

QA-3 remains PARTIAL because the clean-room evidence covers the current
darwin-arm64 target only; the complete darwin, Linux, and Windows target matrix
has not yet been executed in this environment.

### Toolchain contract checkpoint — 2026-08-25

The repository now has one executable toolchain contract rather than relying
on the caller to select the correct global binaries:

- `.nvmrc` and `.node-version` declare Node 24;
- `package.json#packageManager` declares pnpm 10.34.0;
- `scripts/verify-toolchain.mjs` validates both values at runtime;
- `pnpm run audit`, `pnpm run build`, CI, release, and hotfix packaging invoke
  the validator before doing project work.

The validator was tested both positively and negatively on this host. Node
24.19.0 with pnpm 10.34.0 passed. The ambient Node 22.23.2 with pnpm 11.19.0
failed and reported both mismatches. This prevents audit or packaging results
from being attributed to a toolchain different from the one reviewed.

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

## QA-4 pricing snapshot checkpoint — 2026-08-26

Commit `eda7527` adds an explicit `ModelPricingCatalogMetadata` contract and
implements it in `CursorModelPricingProvider`. The current adapter records
catalog version `cursor-docs-2026-08-26`, the official source URL, the retrieval
date, and the bounded coverage declaration. The provider no longer assigns a
fabricated fixed rate to normal `auto` or `default` routing; the documented
legacy Enterprise Auto rate is isolated under explicit legacy IDs and hidden
by default.

The visible official model table is represented with exact entries for Grok
4.5/4.6, Composer 2.5 and Fast, Claude Fable/Opus/Sonnet 5, Gemini 3.1 Pro and
3.7 Flash, and GPT-5.6 Luna/Sol/Terra. Composer 2.5 Fast is independently
tested at `$3/$15` with `$0.50` cache-read pricing, rather than inheriting the
base model's `$0.50/$2.50` rates. The focused pricing and integration suites
pass 27/27, and the complete Node 24.19.0/pnpm 10.34.0 audit passes with 871
host tests and 18 webview tests.

Commit `ea362c3` adds migration 010 and persists calculation source and
pricing snapshot version on completed turns, minute aggregates, and the delta
idempotency ledger. Legacy rows default to `unknown`; aggregate provenance is
conservative and becomes `mixed` when accepted events disagree. Focused
provenance, migration, handler, writer, and integration tests pass 54/54.
The checkpoint commit and full-audit evidence must be recorded immediately
after this local slice is committed.

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

## QA-6.7/QA-7.12/QA-8.12 SQLite restore and partial-failure checkpoint — 2026-08-25

This worktree slice extends the previous artifact-integrity checkpoint with
explicit recovery and failure-reporting behavior:

- `IDatabaseCleanupService` now exposes a restore operation while keeping the
  capability behind the domain port. `SqliteCleanupService` accepts only a
  validated sibling backup with the expected `state.vscdb.backup-<timestamp>`
  name, requires a regular non-empty file, runs `PRAGMA integrity_check` before
  mutation, restores through the bundled SQLite CLI, and runs a second integrity
  check after restoration. The real SQLite test restores both deleted and
  retained rows, while a corrupt backup is rejected without changing the live
  database.
- `VSCodeCacheService` preserves the amount already removed when a later cache
  directory fails by raising `PartialCleanupError`. `StorageCleanupService`
  carries that value into the failed result instead of reporting zero bytes,
  making partial deletion visible to callers and the UI.
- A separate-process long-lived-reader test proves that
  `PRAGMA wal_checkpoint(TRUNCATE)` reports `busy=1` while the reader holds its
  transaction and completes with an empty WAL after the reader releases it.
  This captures the documented SQLite WAL behavior instead of treating a
  deferred checkpoint as data loss. See [SQLite WAL](https://www.sqlite.org/wal.html),
  [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html), and the
  [SQLite CLI restore command](https://www.sqlite.org/cli.html).
- Focused evidence passes 18/18 storage tests and 9/9 SQLite concurrency tests.
  The full audit passes 864 host tests, c8 79.84% lines/74.15% branches/79.05%
  functions, 18/18 webview tests, 296 architecture files, 26 locales/428
  keys, documentation links, and VSIX verification.
- Graphify was refreshed to 5,215 nodes and 12,200 raw edges. Its diagnostic
  reports 93 same-endpoint relation groups and 1,509 dangling endpoints; these
  are graph-extraction diagnostics, not new architecture violations. The
  affected-node query confirms the restore path remains connected through the
  storage composition root and test boundary.
- Repowise reports average health 8.46/10, maintainability average 9.38/10,
  performance average 9.91/10, zero safe-only dead-code findings, and zero
  findings across 214 commits, 4,539 blobs, and 2,578 files in the history
  security scan. Remaining hotspots are recorded rather than hidden; the
  principal candidates are `proxyInsightExtractor.ts`, `mitmProxyServer.ts`,
  `proxyManager.ts`, `StorageCleanupService`, and untested webview surfaces.

Disk-full behavior, crash-restart reconciliation, native privileged command
execution, and the broader release rehearsal remain open. The restore method is
an infrastructure capability for closed profiles; no user-facing restore action
is exposed until its operational UX, retention policy, and confirmation flow are
specified.

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

## QA-8.13 proxy insight extraction boundary checkpoint — 2026-08-26

Commit `7810ea5` extracted billing and token-usage normalization from
`src/proxy/proxyInsightExtractor.ts` into the focused
`src/proxy/insights/usageExtraction.ts` module. The original facade continues
to provide the established public exports, so this is a behavior-preserving
boundary change rather than a protocol change. The new module owns numeric
normalization, snake/camel field selection, billing-cycle conversion, and
streaming/metadata token-usage extraction. Context, agent, workspace, and RPC
routing responsibilities remain explicit in the facade and are candidates for
separate, test-backed slices.

Evidence for this checkpoint:

- the focused proxy/decoder suite passed 56/56 tests;
- `tsc --noEmit` and ESLint passed;
- `pnpm run pretest` passed, including compilation, native rebuild, migration,
  and protobuf fixture preparation;
- the complete Node 24.19.0/pnpm 10.34.0 audit passed, including 871 host
  tests, 18 webview tests, 299 production TypeScript files through the
  architecture checker, localization parity, documentation links, coverage
  floors, and selected Linux ARM64 VSIX verification;
- Graphify was regenerated at 5,301 nodes and 12,431 raw edges; its diagnostic
  reported 1,522 dangling endpoint edges, one self-loop, and 97 same-endpoint
  relation groups;
- Repowise reports the facade at NLOC 516 with 86.59% line coverage, 67.20%
  branch coverage, and 14.29% duplication. The module extraction improves the
  boundary, but the remaining facade is still the lowest-scoring production
  hotspot and requires further characterization before additional extraction.

This checkpoint does not close QA-5 or QA-8. The next production candidates
are the remaining context/agent portions of the proxy insight facade, followed
by `mitmProxyServer.ts` and `proxyManager.ts`. Each slice must preserve the
facade contract, add or retain focused tests, pass the architecture checker,
and rerun the deterministic audit before it is accepted.

## QA-8.14 agent and context extraction checkpoint — 2026-08-26

Commit `e4c5b04` completed the next boundary split. The public
`src/proxy/proxyInsightExtractor.ts` facade now coordinates only redaction,
RPC routing, and compatibility exports. Agent/session/workspace extraction is
implemented in `src/proxy/insights/agentExtraction.ts`; conversation context
is implemented in `src/proxy/insights/contextExtraction.ts`; and shared
snake_case/camelCase and numeric normalization is implemented in
`src/proxy/insights/fieldNormalization.ts`. Existing consumers continue to
import the facade, so the change preserves the runtime API while making each
responsibility independently testable.

Evidence for this checkpoint:

- the focused agent/decoder suite passed 43/43 tests after the split;
- lint, type checking, and the architecture fixtures passed;
- the complete Node 24.19.0/pnpm 10.34.0 audit passed with 871 host tests,
  18 webview tests, 302 production TypeScript files, localization parity,
  documentation links, coverage floors, and selected Linux ARM64 VSIX
  verification;
- c8 reports 87.90% lines / 82.60% branches / 92.85% functions for the
  compatibility facade, 85.81% / 67.54% / 100% for agent extraction, 86.95%
  / 14.28% / 100% for context extraction, 100% / 87.50% / 100% for field
  normalization, and 95.48% / 94.52% / 100% for usage extraction;
- Graphify was regenerated at 5,305 nodes and 12,460 raw edges, with 1,523
  dangling endpoint edges, one self-loop, and 102 same-endpoint relation
  groups;
- Repowise now ranks `src/proxy/mitmProxyServer.ts` as the worst production
  hotspot at 2.16/10. The former facade is reported at 3.38/10, NLOC 99,
  max CCN 20, 86.59% line coverage, 67.20% branch coverage, and 20.00%
  duplication.

This checkpoint does not close QA-5 or QA-8. The remaining architectural work
must address proxy runtime orchestration and high-fan-out service contracts,
starting with `mitmProxyServer.ts`, while preserving the existing protocol and
release contracts.

## QA-8.15 MITM request-capture boundary checkpoint — 2026-08-26

Commit `314acf3` extracted the request-side capture adapter from
`src/proxy/mitmProxyServer.ts` into
`src/proxy/mitmProxyRequestHandler.ts`. The adapter owns request stream
forwarding, body buffering/decompression, redacted log-entry construction,
request statistics, diagnostics, and timing correlation. It receives logging,
diagnostic, URL, protocol, and summary behavior through explicit dependencies;
the concrete MITM server remains the composition root. This preserves the
existing request protocol while removing transport-detail branching from
`start()`.

Evidence for this checkpoint:

- isolated real-loopback forwarding passed 1/1;
- isolated streaming decode passed 2/2;
- isolated proxy runtime lifecycle integration passed 3/3;
- lint and type checking passed;
- the complete Node 24.19.0/pnpm 10.34.0 audit passed, including 871 host
  tests, 18 webview tests, 303 production TypeScript files, localization
  parity, documentation links, coverage floors, and selected Linux ARM64 VSIX
  verification;
- c8 reports 92.37% lines / 44.44% branches / 100% functions for the new
  request handler. The remaining `mitmProxyServer.ts` reports 66.10% lines /
  47.05% branches / 66.66% functions and remains in scope for response,
  lifecycle, and failure-path extraction;
- Repowise reports `mitmProxyServer.ts` improved from a 259-line start method
  with CCN 37 to a 198-line start method with CCN 31. Its health improved to
  2.31/10, with NLOC 426 and 10.00% duplication, but it remains the worst
  production hotspot because response and lifecycle orchestration are still
  concentrated there;
- Graphify was regenerated at 5,310 nodes and 12,501 raw edges; its diagnostic
  reported 1,528 dangling endpoint edges, one self-loop, and 102 same-endpoint
  relation groups.

This checkpoint does not close QA-6, QA-7, or QA-8. The next slice must isolate
response-stream handling and explicitly test callback completion, decoder
cleanup, request timing cleanup, and response logging failure paths.

## QA-8.16 MITM response-capture boundary checkpoint — 2026-08-26

Commit `f1fdcbc` extracted response-side capture from
`src/proxy/mitmProxyServer.ts` into
`src/proxy/mitmProxyResponseHandler.ts`. The adapter owns response header
normalization, response-body buffering and decompression, incremental RunSSE
decoder lifecycle, redacted logging, response statistics, diagnostics, timing
correlation, and traffic-summary handoff. It receives all server-specific
behavior through explicit dependencies, leaving `MitmProxyServer` as the
composition root. Response finalization closes the MITM callback on both
successful and rejected asynchronous completion paths so a logging or decoder
failure cannot leave the transport open.

The new unit boundary verifies the normal response lifecycle independently:
the outer callback, response data forwarding, end callback, active-connection
accounting, byte accounting, request-timing cleanup, request correlation,
diagnostics, and summary handoff are all asserted. The existing real-loopback
tests continue to exercise the production composition and streaming path.

Evidence for this checkpoint:

- the direct response-adapter suite passes 1/1;
- real-loopback forwarding passes 1/1, streaming decode passes 2/2, and
  proxy-runtime integration passes 3/3;
- `pnpm run pretest`, lint, and type checking pass under Node 24.19.0 and pnpm
  10.34.0;
- the complete audit passes with 872 host tests, 18 webview tests, 304
  production TypeScript files, 80.78% lines, 74.87% branches, and 78.11%
  functions; localization remains 26 locales/428 keys, documentation links
  pass, and selected Linux ARM64 VSIX verification passes;
- c8 reports 71.54% lines / 57.14% branches / 66.66% functions for the new
  response handler. The remaining `mitmProxyServer.ts` reports 74.59% lines /
  63.15% branches / 72% functions and remains in scope for lifecycle and
  summary-orchestration work;
- Repowise reports `mitmProxyServer.ts` at 3.4/10 with NLOC 271, max CCN 15,
  and nesting 3. The response adapter is covered by a direct test and scores
  7.3/10 with NLOC 227, max CCN 10, and nesting 4;
- Graphify was regenerated at 5,325 nodes and 12,567 raw edges. Its diagnostic
  reports 1,538 dangling endpoint edges, one self-loop, and 103 same-endpoint
  relation groups. These remain graph-extraction signals, not architecture
  violations.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. Remaining work is
the server lifecycle/summary boundary, high-fan-out profile orchestration,
disk-full and crash-restart evidence, native privileged execution on
supported runners, and the release recovery rehearsal.

## QA-8.17 traffic-summary dispatch boundary checkpoint — 2026-08-26

Commit `1e2e1f9` extracted asynchronous traffic-summary construction and
publication from `src/proxy/mitmProxyServer.ts` into
`src/proxy/proxyTrafficSummaryDispatcher.ts`. The dispatcher now owns the
summary-builder handoff, incremental-persistence marker, fallback summary
publication when decoding fails, session tracking/dispatch, and agent-tracking
debug output. It receives the traffic consumer, session tracker, summary
builder, and debug writer through explicit dependencies; the MITM server only
composes the dispatcher and passes it to the request and response adapters.

The focused tests cover successful decoded-summary publication with streaming
deduplication metadata and the decode-failure fallback path. They also assert
that the dispatcher remains asynchronous and does not call the fallback when
the primary path succeeds.

Evidence for this checkpoint:

- the dispatcher suite passes 2/2 and the response-adapter suite passes 1/1;
- real-loopback forwarding passes 1/1, streaming decode passes 2/2, and
  proxy-runtime integration passes 3/3;
- `pnpm run pretest`, lint, and type checking pass under Node 24.19.0 and pnpm
  10.34.0;
- the complete audit passes with 874 host tests, 18 webview tests, 305
  production TypeScript files, 80.95% lines, 74.76% branches, and 78.06%
  functions; localization remains 26 locales/428 keys, documentation links
  pass, and selected Linux ARM64 VSIX verification passes;
- c8 reports 95.93% lines / 33.33% branches / 100% functions for the new
  dispatcher. The remaining `mitmProxyServer.ts` reports 83.90% lines /
  64.71% branches / 65.22% functions;
- Repowise reports the dispatcher at 10.0/10 with NLOC 106, max CCN 6, and
  nesting 2. The server remains at 3.4/10 with NLOC 233, max CCN 15, and
  nesting 3; its remaining hotspot is startup/lifecycle orchestration;
- Graphify was regenerated at 5,339 nodes and 12,607 raw edges. Its diagnostic
  reports 1,540 dangling endpoint edges, one self-loop, and 103 same-endpoint
  relation groups. These remain graph-extraction signals, not architecture
  violations.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. The next proxy
boundary should address startup/error lifecycle orchestration or move to the
high-fan-out `ProxyManager`, while preserving the existing release and
accounting contracts.

## QA-8.18 MITM error-handling boundary checkpoint — 2026-08-26

Commit `e3a4f9f` extracted MITM transport-error filtering, diagnostic
accounting, redacted error-entry construction, traffic-summary publication,
and extension error emission from `src/proxy/mitmProxyServer.ts` into
`src/proxy/mitmProxyErrorHandler.ts`. The server now remains responsible for
composition and lifecycle ownership, while the handler receives every runtime
side effect through explicit dependencies. The callback safely handles a
missing transport context and suppresses known certificate-noise errors before
performing logging, diagnostics, summary, or event-emission side effects.

The focused tests cover contextual errors, null-context errors, and filtered
certificate noise. The existing MITM error-filter suite is run with the new
handler suite so the boundary currently passes 6/6 tests.

Evidence for this checkpoint:

- the handler and filter focused suites pass 6/6;
- the complete audit passes with 877 host tests, 18 webview tests, 306
  production TypeScript files, 81.08% lines, 74.94% branches, and 77.94%
  functions; localization remains 26 locales/428 keys, documentation links
  pass, and selected Linux ARM64 VSIX verification passes;
- c8 reports 100.00% lines / 82.35% branches / 100.00% functions for the new
  error handler. The remaining `mitmProxyServer.ts` reports 90.73% lines /
  64.71% branches / 55.56% functions;
- Repowise reports the error handler at 9.0/10 with NLOC 43, max CCN 9, and
  nesting 1. The server improved to 4.5/10 with NLOC 214, max CCN 7, and
  nesting 3; its remaining marker hotspot is the startup/lifecycle method;
- Graphify was regenerated at 5,350 nodes and 12,645 raw edges. Its
  post-build graph contains 10,907 edges and its diagnostic reports 1,544
  dangling endpoint edges, one self-loop, and 103 same-endpoint relation
  groups. These remain graph-extraction signals, not architecture violations.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. Remaining work is
startup/lifecycle characterization, high-fan-out profile orchestration,
disk-full and crash-restart evidence, native privileged execution on
supported runners, the final attribution decision, and release recovery
rehearsal.

## QA-7.13 / QA-8.19 MITM lifecycle transaction checkpoint — 2026-08-26

Commit `d625f7d` extracted the callback-to-Promise listener and bounded close
contracts into `src/proxy/mitmProxyLifecycle.ts` and hardened
`src/proxy/mitmProxyServer.ts` startup ownership. Startup is now single-flight,
so concurrent callers share one initialization path; `stop()` waits for an
in-flight start; listener failure closes the partially created transport,
clears runtime state, closes an initialized logger, and leaves the server
retryable. Proxy close now has a cancellable timeout and does not let a broken
transport block shutdown.

The focused lifecycle tests cover successful and failed listener callbacks,
callback-based close, close timeout, synchronous close failure, concurrent
startup, stop/start ordering, rollback, and a subsequent successful retry. The
boundary currently passes 7/7 tests.

Evidence for this checkpoint:

- the lifecycle focused suite passes 7/7;
- the complete audit passes with 884 host tests, 18 webview tests, 307
  production TypeScript files, 81.12% lines, 75.02% branches, and 78.01%
  functions; localization remains 26 locales/428 keys, documentation links
  pass, and selected Linux ARM64 VSIX verification passes;
- c8 reports 95.45% lines / 90.91% branches / 100.00% functions for
  `mitmProxyLifecycle.ts`. The server reports 92.31% lines / 71.05% branches /
  58.62% functions;
- Repowise reports the lifecycle helper at 9.7/10 with NLOC 39, max CCN 3,
  and nesting 2. The server remains at 4.5/10 with NLOC 237, max CCN 6, and
  nesting 3; the remaining marker hotspot is startup/lifecycle orchestration;
- Graphify was regenerated at 5,371 nodes and 12,700 raw edges. Its
  post-build graph contains 10,954 edges and its diagnostic reports 1,552
  dangling endpoint edges, one self-loop, and 103 same-endpoint relation
  groups. These remain graph-extraction signals, not architecture violations.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. Remaining work is
release-grade crash/restart and disk-full evidence, native privileged command
execution on supported runners, the final dependency-attribution decision,
high-fan-out profile orchestration, and independent release rehearsal.

## QA-5 / QA-8 efficiency-event cleanup dependency-inversion checkpoint — 2026-08-26

Commit `9d2e00c` moved efficiency-event database construction, retention
cleanup, vacuuming, and database-size accounting out of
`src/services/storageCleanupService.ts`. The service now depends on the
domain-owned `IEfficiencyEventsCleanupService` port, while
`src/persistence/efficiencyEventsCleanupService.ts` owns the SQLite adapter and
is wired only from `src/composition/createStorageServices.ts`. The same change
replaced the concrete `InstanceDetector` dependency with the
`IInstanceDetector` port.

The adapter contract takes a profile id, a validated profile data directory, and
an explicit Unix-seconds cutoff. It returns the removed-event count and a
non-negative reclaimed-byte value. This preserves the existing retention and
message behavior while allowing the orchestration service to be tested without
constructing SQLite or reading persistence files.

Evidence for this checkpoint:

- the complete Node 24.19.0/pnpm 10.34.0 audit passes with 888 host tests,
  18 webview tests, 310 production TypeScript files, 81.51% lines, 74.78%
  branches, and 78.26% functions;
- the storage cleanup/persistence focused run passes 23/23 tests, including
  profile-scoped retention, empty-database initialization, the service-to-port
  delegation contract, and the existing cache/SQLite cleanup cases;
- the new adapter has 100% c8 lines, branches, and functions in the full run;
  Repowise reports it at 10.0/10 with NLOC 38, max CCN 1, and no findings;
- the refactored orchestration service remains a deliberate follow-up target:
  Repowise reports 3.26/10, NLOC 284, max CCN 12, 37.17% duplication, and a
  103-line `cleanProfileStorage` method. The duplication signal includes test
  fixtures, while the complexity and low-cohesion markers still require a
  behavior-preserving orchestration split;
- Graphify was regenerated at 5,395 nodes and 12,764 raw edges. Its post-build
  graph contains 11,008 edges, and its diagnostic reports 1,561 dangling
  endpoint edges, one self-loop, no missing endpoints, and 104 same-endpoint
  relation groups. These remain graph-extraction signals, not architecture
  violations.

This checkpoint does not close QA-5 or QA-8. The next code-quality slice must
reduce `cleanProfileStorage` complexity without hiding action policy, while QA-6
and QA-7 still require disk-full and crash/restart evidence.

## QA-8.20 MITM handler-composition boundary checkpoint — 2026-08-26

Commit `5155c9c` moved the registration of the error, request, and response
callbacks from `src/proxy/mitmProxyServer.ts` into the typed
`registerMitmProxyHandlers` composition boundary. The individual transport
adapters retain their own contracts and side effects; the registration module
only composes those adapters and does not introduce domain or application
dependencies.

The focused registration test verifies that the three callbacks are registered
exactly once and in the transport order expected by the MITM library. Existing
forwarding and lifecycle tests remain in the same focused run, which passes
9/9 tests.

Evidence for this checkpoint:

- handler-composition, lifecycle, and forwarding focused tests pass 9/9;
- the complete audit passes with 885 host tests, 18 webview tests, 308
  production TypeScript files, 81.13% lines, 75.02% branches, and 78.02%
  functions; localization remains 26 locales/428 keys, documentation links
  pass, and selected Linux ARM64 VSIX verification passes;
- c8 reports 100.00% lines / 100.00% branches / 100.00% functions for
  `mitmProxyHandlerRegistration.ts`. The server reports 92.08% lines /
  71.05% branches / 58.62% functions;
- Repowise reports the registration boundary at 10.0/10 with NLOC 26, max CCN
  1, and nesting 0. The server improves to 4.9/10 with NLOC 231, max CCN 6,
  and nesting 3; its remaining marker hotspot is startup/lifecycle
  orchestration;
- Graphify was regenerated at 5,382 nodes and 12,725 raw edges. Its
  post-build graph contains 10,975 edges and its diagnostic reports 1,556
  dangling endpoint edges, one self-loop, and 103 same-endpoint relation
  groups. These remain graph-extraction signals, not architecture violations.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. Remaining work is
release-grade crash/restart and disk-full evidence, native privileged command
execution on supported runners, the final dependency-attribution decision,
high-fan-out profile orchestration, and independent release rehearsal.

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
| Security/privacy residuals | PARTIAL | Several controls exist; retention, disk-full, crash-restart, privileged-process, and threat-model evidence remain |

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
| 2026-08-25 | QA-6.7/QA-7.12/QA-8.12 SQLite restore and partial-failure slice | 57d4314 | Added validated SQLite backup restore, corrupt-backup rejection, partial cleanup byte reporting, separate-process long-reader checkpoint evidence, 27/27 focused storage/concurrency tests, full audit at 79.84%/74.15%/79.05%, Graphify 5,215 nodes/12,200 raw edges, Repowise health 8.46/10, safe-only dead-code empty, and zero history security findings |
| 2026-08-25 | QA-2/QA-3 clean-room packaging and store-exclusion evidence | 9a9c8bf | Empty external pnpm store, Node 24.19.0, pnpm 10.34.0, current-target build and VSIX verification passed; local store contamination reproduced and prevented; production audit 0 advisories; signature/SBOM evidence was completed separately |
| 2026-08-25 | QA-2 signature, SBOM, and license evidence slice | 1cdff99 | Isolated pnpm 11.19 signature audit verified 163/163 production packages; lockfile-only CycloneDX 1.5 SBOM contains 163 components; pnpm 10.34 production license inventory contains 157 records in 10 groups; Cursor vendor terms and semaphore attribution remain under review |
| 2026-08-25 | QA-3 toolchain contract and target-matrix documentation slice | a992832 | Runtime contract validation added to audit/build/CI/release/hotfix; Node 24.19.0/pnpm 10.34.0 full audit and current-target build passed; six-target packaging remains a remote runner gate |
| 2026-08-26 | QA-3 target-native packaging hardening slice | 0a02efb | Target-specific Electron prebuild selection and Mach-O/ELF/PE VSIX validation added; release-style argument parsing fixed; darwin-arm64 and linux-arm64 builds passed locally; complete runner matrix and remote workflow evidence pending |
| 2026-08-25 | QA-2 supply-chain evidence automation slice | 449d85b | Added strict supply-chain argument parsing, project package-manager reporting, automated advisory/license/signature/SBOM collection, and workflow artifact upload; remote workflow evidence pending |
| 2026-08-26 | QA-4 pricing catalog snapshot slice | eda7527 | Added versioned catalog provenance, removed the fixed normal Auto rate, added current visible Cursor model prices and exact fast variants, added regression coverage, and passed the full Node 24.19.0/pnpm 10.34.0 audit; SQLite provenance migration remains open |
| 2026-08-26 | QA-4 cost provenance persistence slice | ea362c3 | Added migration 010, persisted source and pricing snapshot evidence across completed turns, minute aggregates, and the idempotency ledger; added conservative `mixed` aggregation, read-model exposure, 54/54 focused tests, and a full Node 24.19.0/pnpm 10.34.0 audit pass |
| 2026-08-26 | QA-8.13 proxy insight extraction boundary slice | 7810ea5 | Extracted billing/token normalization behind a focused module while preserving facade exports; 56/56 focused tests, architecture check for 299 production TypeScript files, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise hotspot evidence |
| 2026-08-26 | QA-8.14 agent/context extraction boundary slice | e4c5b04 | Split the public proxy insight facade into agent/session, conversation-context, field-normalization, and usage modules; 43/43 focused tests, architecture check for 302 production TypeScript files, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise hotspot improvement |
| 2026-08-26 | QA-8.15 MITM request-capture boundary slice | 314acf3 | Extracted request stream capture behind injected transport/logging/diagnostic dependencies; real forwarding 1/1, streaming 2/2, runtime integration 3/3, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise start-method improvement |
| 2026-08-26 | QA-8.16 MITM response-capture boundary slice | f1fdcbc | Extracted response stream capture behind injected transport/logging/diagnostic dependencies; direct response-adapter test 1/1, real forwarding 1/1, streaming 2/2, runtime integration 3/3, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise response/server hotspot evidence |
| 2026-08-26 | QA-8.17 traffic-summary dispatch boundary slice | 1e2e1f9 | Extracted async summary construction/publication behind injected builder, tracker, consumer, and debug-writer dependencies; dispatcher 2/2, response adapter 1/1, real forwarding 1/1, streaming 2/2, runtime integration 3/3, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise dispatcher/server evidence |
| 2026-08-26 | QA-8.18 MITM error-handling boundary slice | e3a4f9f | Extracted error filtering, diagnostics, log-entry construction, summary publication, and event emission behind injected dependencies; handler/filter 6/6, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise handler/server evidence |
| 2026-08-26 | QA-7.13/QA-8.19 MITM lifecycle transaction slice | d625f7d | Extracted callback lifecycle helpers; added single-flight startup, stop/start ordering, bounded close, failed-listener rollback, and retry coverage 7/7; complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise lifecycle/server evidence |
| 2026-08-26 | QA-8.20 MITM handler-composition boundary slice | 5155c9c | Extracted typed registration of error/request/response adapters; composition 1/1, lifecycle/forwarding combined 9/9, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify refresh, and Repowise registration/server evidence |
| 2026-08-26 | QA-5/QA-8 efficiency-event cleanup dependency-inversion slice | 9d2e00c | Added `IEfficiencyEventsCleanupService`, SQLite adapter, interface-based instance detection, 23/23 focused storage tests, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify 5,395 nodes/12,764 raw edges, Repowise adapter 10.0/10 and service 3.26/10 |

This register must be updated in the same commit as each task's implementation
or evidence change.
