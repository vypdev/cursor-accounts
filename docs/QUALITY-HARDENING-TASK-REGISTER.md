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
| QA-0 | Baseline and finding reclassification | COMPLETE | pnpm run audit passes; current Graphify/Repowise/dependency evidence captured on 2026-08-26 at `664705b` | Keep this baseline immutable and update it after every cross-cutting change |
| QA-1 | CI, tests, localization, lint | PARTIAL | Full audit passes with 923 host tests, 82.63% lines, 76.31% branches, and 80.20% functions; localization is 26 locales/428 keys and webview is 51/51 across 13 files with 84.97% lines, 78.24% branches, 83.87% functions, and explicit risk-based floors | Add repeated host/webview-run evidence and review generated-artifact/source-lint policy |
| QA-2 | Dependencies and supply chain | PARTIAL | SDK `1.0.28`, legacy npm `sqlite3` removed, targeted `uuid@11.1.1` and `undici@6.28.0` overrides resolve; pinned pnpm 10.34 production audit reports 0 advisories; isolated pnpm 11.19 signature audit verifies 163/163 packages; CycloneDX 1.5 SBOM contains 163 components; clean VSIX tree has no package-manager store; `audit:supply-chain` now automates the checks and CI/release/hotfix upload the report for 14 days | Review Cursor vendor terms and semaphore MIT attribution, decide release SBOM retention, and close the final attribution policy before marking complete |
| QA-3 | Native runtime and packaging | PARTIAL | Current-target clean build passes with target-specific Electron ABI 128, official SHA-256 validation, sanitized runtime native tree, clean-room Node 24/pnpm 10 installation, and 49,430,263-byte (47.14 MiB) VSIX verification; darwin-arm64 and linux-arm64 cross-target builds pass with embedded native-header validation; the shared VSIX verifier contract is covered by 4/4 tests and used by both build-time and standalone verification | Expand evidence across the complete darwin, Linux, and Windows target matrix on their intended runners |
| QA-4 | Token and cost correctness | PARTIAL | Accounting contract, authoritative server-cost precedence, model-aware fallback calculation, non-finite input guards, SQLite replay golden test, versioned pricing metadata, current visible Cursor model rates, exact fast-variant pricing, and migration 010 provenance persistence are implemented; focused provenance coverage passes | Complete decoder-shape, rounding, and unknown/cache-rate reconciliation coverage |
| QA-5 | Clean Architecture enforcement | PARTIAL | TypeScript-AST resolver-backed checker passes for 322 production files; negative fixtures cover domain/application/package/cycle cases; storage cleanup keeps efficiency-event SQLite construction behind a domain port and persistence adapter, policy-specific actions behind a cohesive runner, proxy insight dispatch/redaction behind focused application boundaries, ProxyManager construction behind a composition boundary, Composer polling behind injected state-reader, clock, branch-detector, and scheduler boundaries, efficiency toggling behind a dedicated workflow with narrow ports, extension activation construction and lifecycle orchestration behind focused composition modules, build-target selection behind a pure script boundary, VSIX artifact policy behind a shared verification boundary, ProfileCard presentation formatting behind a UI helper, inbound webview state transitions behind a typed reducer, the VS Code bridge behind an injectable message target, live usage accounting behind an application state policy, live usage rendering behind a presentation helper, Accounts HTML/CSP rendering behind a pure renderer, proxy traffic analysis behind a side-effect-free analysis module, and protobuf framing/report rendering behind shared pure script boundaries while retaining explicit composition-root storage seams for deterministic integration tests; current Graphify/Repowise hotspots remain | Split the remaining large composition functions and add direct contract tests without weakening the dependency direction |
| QA-6 | Security and privacy | PARTIAL | Threat model recorded; API error details are generic; loopback/token parity, redaction, sidecar safety, text-safe webview rendering, certificate platform validation, injected certificate-process failure tests, bounded certificate-process timeout/kill escalation, fail-closed migration execution, SQLite snapshot backup/restore validation, sidecar preservation, partial-cleanup accounting, typed ENOSPC classification with actionable error reporting, and Repowise history scan are evidenced | Complete physical disk-full/crash-restart testing, native privileged command execution review on supported OS runners, protocol-specific redaction, and the legacy optional-token decision |
| QA-7 | Reliability and lifecycle | PARTIAL | Tracking ingress shutdown is idempotent; MITM startup is single-flight, transactional on listener failure, and bounded during close; proxy startup failures attempt MITM/ingress/API cleanup; direct `SIGTERM`/`SIGINT` uses graceful shutdown; the real runtime integration suite passes 3/3; SQLite persistence has 2-process concurrency/reopen, migration rollback/retry, consistent backup, validated restore, corrupted-database sidecar preservation, partial cleanup reporting including reclaimed-byte preservation after ENOSPC, long-lived-reader checkpoint evidence, and real child hang escalation coverage; ProxyManager disposal is idempotent and unsubscribes its traffic bus listener; extension deactivation awaits tracked profile initialization so hermetic tests cannot race temporary-storage cleanup | Add physical disk-full/crash-restart reconciliation and release-level recovery rehearsal |
| QA-8 | Local test confidence | PARTIAL | Full audit passes 923 host tests and 51 webview tests across 13 files; overall c8 is 82.63% lines/76.31% branches/80.20% functions and webview V8 coverage is 84.97% lines/78.24% branches/83.87% functions; the webview gate enforces global 40/70/80/40 floors plus tested-boundary floors for the reducer, VS Code bridge, boot-error renderer, and ProfileCard; the Composer poller focused suite passes 8/8 and c8 reports 93.04% lines/81.82% branches for `composerDbPoller.ts`; the efficiency service/workflow focused run passes 14/14 and c8 reports 92.39% lines/92.59% branches for `efficiencyService.ts` and 98.15% lines/95.83% branches for `efficiencyToggleWorkflow.ts`; the filesystem-error/storage-cleanup focused run passes 24/24 and the storage cleanup/persistence focused run passes 26/26 including real efficiency-event retention, adapter behavior, direct action-runner policy tests, and deterministic ENOSPC partial-cleanup reporting; the SQLite/storage focused suites previously passed 27/27 including restore, partial cleanup, and long-lived-reader cases; `proxyDecode.ts` has 91.7% c8 lines and 100% c8 branches; certificate process/platform boundaries have 16/16 focused tests; `nodeProxyProcess.ts` has 91.15% lines, 88% branches, and 100% functions; `ProxyServerRuntime` has 3/3 real integration tests; the usage-extraction and agent/context split suites pass 43/43 focused tests; the MITM request-capture boundary passes forwarding 1/1, streaming 2/2, runtime integration 3/3, direct response-adapter coverage 1/1, summary-dispatch coverage 2/2, error-handler/filter coverage 6/6, lifecycle coverage 7/7, and handler-composition coverage 1/1; the insight dispatch/redaction boundary passes 25/25 targeted tests and `sensitiveRedaction.ts` reaches 100% c8 lines/branches/functions; the ProxyManager composition/facade-focused tests cover 22/22 cases, including direct token-precedence and idempotent disposal; the extension activation test passes 1/1 against isolated profile/proxy storage; the ProfileCard presentation helper suite passes 5/5; the app message-state reducer suite passes 7/7; the VS Code bridge contract suite passes 5/5; direct ProfileCard behavior coverage passes 6/6; direct App host-bridge coverage passes 5/5; AddProfileForm, EditProfileForm, and ProfileList behavior suites pass 5/5; the shared VSIX verifier contract suite passes 4/4; the proxy traffic analysis contract suite passes 3/3; the protobuf report renderer suite passes 2/2; the live usage state/presentation suites pass 10/10 and 9/9 respectively; the Accounts HTML/CSP focused suite passes 19/19; Repowise now ingests the merged host and webview LCOV reports | Standardize repeated static-analysis coverage ingestion and cover the next process, storage, and release hotspots |
| QA-9 | Documentation and operations | PARTIAL | Plan, audit links, dependency inventory, advisory register, and English docs are synchronized for this slice | Add task/decision records, reproducible audit artifact output, and runbooks |
| QA-10 | Independent final audit and release rehearsal | OPEN | Not started | Run only after QA-1 through QA-9 have current evidence |

## QA-0 evidence

### Repository and tooling

| Item | Value |
|---|---|
| Branch | feature/3-mitm-proxy |
| Latest implementation commit | 664705b |
| Latest documentation checkpoint | Current branch HEAD (this register) |
| Node | v24.19.0 (nvm-managed via `.nvmrc`) |
| pnpm | 10.34.0 (Corepack, declared by both package manifests) |
| Graphify | 0.9.48 |
| Repowise | 0.45.0 |
| Architecture gate | 322 production TypeScript files; tests excluded by contract |
| Documentation gate | 50 Markdown files |

### Reproducible audit

The latest `pnpm run audit` passed on 2026-08-26 at commit `664705b` with:

- extension-host tests: passed across the compiled host test suite;
- 923 host tests and coverage of 82.63% lines, 76.31% branches, and 80.20%
  functions;
- architecture rules and fixtures: passed for 322 production TypeScript files;
- localization: 26 locales with 428 keys each;
- webview tests: 13 files and 51 tests passed, with 84.97% lines, 78.21%
  branches, and 83.87% functions under the V8 coverage gate;
- current VSIX content verification: passed.

The current-target VSIX check proves the selected artifact is internally
consistent. It does not prove clean-room reproducibility or the full platform
matrix; those remain QA-3 work.

### Node 24 toolchain checkpoint

The repository now has one explicit Node.js toolchain contract:

- `.nvmrc` and `.node-version` select Node 24;
- `package.json#engines.node` requires `>=24 <25`;
- `package.json#packageManager` and `webview/package.json#packageManager` both
  pin pnpm `10.34.0`, activated through Corepack;
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

The latest graph was generated with Graphify `0.9.48` for the code tree at
`664705b` using no clustering. It contains 5,642 nodes and 13,542 raw edges,
and the post-build graph contains 11,668 edges.
The highest relevant
hotspots include:

- `t()`: degree 110;
- ProxyManager: degree 43; it remains a high-risk facade despite no longer
  being the dominant graph hub after composition extraction;
- ProxyTrafficSummary: degree 68;
- scripts: degree 65;
- IProfileDetector: degree 49;
- IProfileReader: degree 49;
- Quality Hardening Task Register: degree 53;
- IAgentTrackingRepository: degree 38;
- VSCodeAPI: degree 38;
- `IProfileManager`: degree 36.

Graphify skipped ten SQL contributions because `tree_sitter_sql` is not
installed and skipped `.npmrc` as potentially sensitive. The multigraph
diagnostic reports 1,670 dangling endpoint edges, one self-loop, no missing
endpoints, and 113 same-endpoint relation groups; these are analysis signals,
not architecture violations by themselves. The generated graph is ignored by
Git and is not a release artifact.

### Repowise

- Safe-only dead-code analysis: no findings. The current index reports zero
  unreachable files and zero unused exports; this is evidence that no safe
  deletion candidate was found, not proof that every heuristic is complete.
- Historical security scan: 0 findings across 214 commits, 4,539 blobs, and
  2,578 files.
- Current refactoring targets include `scripts/build.mjs`, `src/extension.ts`,
  `src/services/proxyManager.ts`, `webview/src/App.tsx`,
  `webview/src/components/ProfileCard.tsx`, `src/proxy/mitmProxyServer.ts`,
  `src/modelEfficiency/efficiencyService.ts`, and high-fan-out type barrels.

The latest Repowise index covers the code tree at `664705b`; the host and
webview lcov reports were explicitly merged with `repowise coverage add
coverage/lcov.info webview/coverage/lcov.info`. The coverage index reports 282
files after resolving the merged inputs. Detailed health reports average health
at 8.63/10, hotspot health at 6.08/10, worst-performer health at 3.44/10 for
`src/services/proxyManager.ts`, maintainability at 9.44/10, and performance at
9.93/10.
The detailed report
contains 38 hot-path synchronous-I/O, 55 I/O-in-loop, 106 complex-method, 316
duplication, 172 coverage-gradient, and 8 untested-hotspot findings. These
findings are prioritization signals, not release gates.

The current high-risk production targets include
`scripts/build.mjs` (6.50/10, NLOC 148, max CCN 4, max nesting 2, no direct
coverage record), `scripts/verify-vsix.mjs` (6.50/10, NLOC 76, max CCN 1,
max nesting 0, no direct coverage record), `scripts/vsixVerification.mjs`
(8.24/10, NLOC 133, max CCN 7, max nesting 5, 10.53% duplication),
`src/services/proxyManager.ts` (3.44/10, NLOC 349,
max CCN 4, max nesting 4, 85.75% lines and 82.14% branches),
`src/extension.ts` (5.88/10, NLOC 98, max CCN 4, max nesting 1,
88.14% lines and 57.14% branches),
`src/ui/agentLiveUsageStatusBar.ts` (6.02/10, NLOC 116, max CCN 4, max
nesting 1, 91.79% lines and 91.67% branches),
`scripts/analyze-proxy-traffic.mjs` (5.30/10, NLOC 59, max CCN 9, max
nesting 2), `scripts/lib/proxy-traffic-analysis.mjs` (7.20/10, NLOC 175,
max CCN 13, max nesting 4),
`scripts/verify-proto-jsonl.mjs` (6.20/10, NLOC 42, max CCN 3, max nesting 1),
`scripts/lib/proto-jsonl-report.mjs` (10.00/10, NLOC 104, max CCN 8, max
nesting 3), and `scripts/lib/connect-payload.mjs` (8.70/10, NLOC 33, max CCN
10, max nesting 2), and the remaining webview monoliths
`webview/src/App.tsx` (4.75/10, NLOC 572, max CCN 11, 95.52% lines and
83.17% branches in the merged report) and
`webview/src/components/ProfileCard.tsx` (NLOC 749, 73.34% lines and
68.25% branches in the webview report, with a direct component test file),
`src/modelEfficiency/efficiencyService.ts` (5.70/10, NLOC 169, max CCN 4,
max nesting 2, 92.39% lines and 92.59% branches),
`src/proxy/mitmProxyServer.ts` (5.81/10, NLOC 231, max CCN 6, max nesting 3),
and the protobuf verification helpers listed above.
The Composer poller now scores 6.07/10 with NLOC 279, max CCN 7, max nesting
2, and 93.04% lines / 81.82% branches after the explicit lcov ingestion.
These are prioritization signals, not automatic extraction requirements;
each candidate requires runtime, bundle, and VSIX reachability review.
Safe-only dead-code analysis remains empty.

The new `src/proxy/mitmProxyErrorHandler.ts` remains at 9.0/10 with NLOC 43,
max CCN 9, nesting 1, and a dedicated test. The new
`src/proxy/mitmProxyLifecycle.ts` scores 9.7/10 with NLOC 39, max CCN 3,
nested depth 2, and focused coverage; its only marker is a low-severity
historical defect signal. The new handler-registration boundary scores 10.0/10
with NLOC 26, max CCN 1, and nested depth 0. The server startup method remains
the next proxy hotspot and is intentionally retained as the composition root
while its lifecycle seams gain more characterization and failure-path coverage.

Repowise sync metadata points to commit `c0627e1`, with no embedding provider or
model configured. Its health output is therefore treated as a heuristic
source-code signal, not as a release gate; the missing real embedder is an
explicit tooling limitation and does not block the deterministic audit.

Coverage ingestion is now performed explicitly after each coverage-producing
audit run. The poller discrepancy that previously appeared in Repowise was
resolved by ingesting the current `coverage/lcov.info`; Repowise now reports
the same 93.04% line and 81.82% branch coverage for
`src/modelEfficiency/composerDbPoller.ts` as c8. c8 and the repository audit
remain the authoritative coverage gates.

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

## QA-5 / QA-8 storage action-runner extraction checkpoint — 2026-08-26

Commit `22bc487` extracted the seven policy-specific cleanup actions from
`src/services/storageCleanupService.ts` into the cohesive
`StorageCleanupActionRunner`. The public `StorageCleanupService` remains the
orchestration boundary: it resolves and validates the profile, decides whether
filesystem accounting is applicable, measures the before/after delta, and
translates failures including partial-cleanup byte information. The runner
owns current-window checks, closed-profile checks, action dispatch, retention
policy, and action-specific user messages.

This boundary is behavior-preserving: all existing cleanup actions keep their
same injected ports, safety conditions, result shape, and localized messages.
The runner now has direct tests for current-window chat cleanup, closed-profile
protection, and efficiency-event delegation; the existing facade tests remain
the regression suite for profile validation, filesystem accounting, and error
translation.

Evidence for this checkpoint:

- the complete Node 24.19.0/pnpm 10.34.0 audit passes with 891 host tests,
  18 webview tests, 311 production TypeScript files, 81.52% lines, 74.78%
  branches, and 78.31% functions;
- the storage cleanup/persistence focused run passes 26/26 tests; the new
  runner and facade preserve all existing storage cleanup behaviors;
- Repowise reports the facade at 5.36/10, NLOC 117, max CCN 6, nesting 2,
  and 8.46% duplication, improving from the previous NLOC 284 / max CCN 12
  hotspot. The runner reports 9.3/10, NLOC 193, max CCN 3, and nesting 1;
  its low-cohesion/duplication heuristic remains explicitly tracked for
  evidence-based follow-up;
- c8 reports the facade at 98.59% lines, 87.50% branches, and 100% functions;
  the runner is exercised by the full host suite and has a paired direct test;
- Graphify was regenerated at 5,406 nodes and 12,807 raw edges. Its post-build
  graph contains 11,044 edges, and its diagnostic reports 1,568 dangling
  endpoint edges, one self-loop, no missing endpoints, and 104 same-endpoint
  relation groups. These remain graph-extraction signals, not architecture
  violations.

This checkpoint does not close QA-5 or QA-8. Remaining code-quality work is
the risk-based coverage/static-analysis reconciliation and the next genuinely
cohesive profile/process hotspot; QA-6 and QA-7 still require disk-full and
crash/restart evidence.

## QA-8.21 proxy insight dispatch and redaction boundary checkpoint — 2026-08-26

Commit `5e93c8d` converted `src/proxy/proxyInsightExtractor.ts` into a
compatibility facade and separated RPC-path dispatch into
`src/proxy/insights/rpcInsights.ts` and recursive sensitive-field redaction
into `src/proxy/insights/sensitiveRedaction.ts`. The public exports remain
unchanged, while the application-facing selection policy and the privacy
boundary now have independent units that can be tested and reviewed without
reopening the protobuf extraction modules.

Commit `86d9180` added direct coverage for primitive and null redaction
returns. The focused insight boundary run passes 25/25 tests, including the
legacy facade tests, direct RPC dispatch tests, and direct recursive-redaction
tests. The complete audit passes with 908 host tests, 18 webview tests, 313
production TypeScript files, 81.62% lines, 75.04% branches, and 78.44%
functions. `sensitiveRedaction.ts` reaches 100% c8 lines, branches, and
functions; `rpcInsights.ts` reaches 100% lines and functions and 92.85%
branches.

Graphify `0.9.48` was refreshed at `86d9180`: 5,418 nodes, 12,840 raw edges,
649 uncached files, and 11,076 post-build edges. Its diagnostic reports 1,572
dangling endpoint edges, one self-loop, no missing endpoints, and 101
same-endpoint relation groups. Repowise is synchronized to the same commit;
its RPC dispatch module scores 9.65/10 at NLOC 110 and max CCN 6, while the
facade is intentionally retained as a stable public boundary.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. The remaining
quality work includes protocol-specific redaction review, risk-based coverage
for process/profile hotspots, disk-full and crash/restart evidence, native
privileged-command validation, and the final dependency-attribution decision.

## QA-5 / QA-8.22 ProxyManager composition boundary checkpoint — 2026-08-26

Commit `83f6303` extracted the concrete coordinator graph from
`src/services/proxyManager.ts` into `src/services/proxyManagerComposition.ts`.
The public `ProxyManager` remains a narrow facade for the extension-facing
contract, listener management, diagnostics presentation, and simple delegation.
The composition boundary now owns coordinator construction, runtime wiring,
API-port resolution, server configuration, shared-proxy state selection, and
the callback adapters required by the facade.

The shared-proxy persistence contract was moved to the domain-owned
`ISharedProxyStateStore` port. The filesystem-backed
`SharedProxyStateStore` remains an adapter and re-exports the port for
compatibility. Lifecycle coordinators and composition tests now depend on the
domain port rather than importing a persistence implementation. The
multi-window test injects an `IProxyTrafficIngress` fake instead of mutating
private facade methods, and the shared-proxy status test injects the shared
state port.

Evidence for this checkpoint:

- the complete Node 24.19.0/pnpm 10.34.0 audit passes with 908 host tests,
  18 webview tests, 315 production TypeScript files, 81.62% lines, 75.04%
  branches, and 78.44% functions;
- the ProxyManager integration, multi-window, shared-proxy, certificate,
  output, profile-lifecycle, shared-lifecycle, and composition contract focused
  suites pass 19/19; the direct composition contract verifies profile-runtime,
  shared-runtime, and persisted-token precedence;
- the architecture checker passes for all 315 production TypeScript files,
  with no new domain-to-adapter dependency; `git diff --check` passes;
- Repowise reports `src/services/proxyManager.ts` at 4.48/10, NLOC 330,
  max CCN 4, max nesting 4, and 72.07% line / 90.00% branch coverage. This
  is a material reduction from the previous 640-NLOC facade and its degree
  falls from 71 to 41 in Graphify;
- Repowise reports the new composition module at 8.5/10, NLOC 371, max CCN
  13, and max nesting 3. Its `createProxyManagerComposition` function is
  still a large composition root and has no dedicated direct test file; this
  is an explicit follow-up, not a reason to split infrastructure merely to
  improve a metric;
- Graphify `0.9.48` was refreshed at `83f6303`: 5,426 nodes, 12,907 raw
  edges, and 11,125 post-build edges. Its diagnostic reports 1,587 dangling
  endpoint edges, one self-loop, no missing endpoints, and 104 same-endpoint
  relation groups. These remain graph-extraction signals, not architecture
  violations.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. The next code slice
must make the composition root easier to verify through named construction
helpers and direct contract tests, while preserving the exact coordinator
startup order and profile-specific token precedence. Release-grade disk-full,
crash/restart, native privileged-command, attribution, and final-rehearsal
gates remain open.

## QA-5 / QA-8.23 named ProxyManager composition phases — 2026-08-26

Commit `c1af58b` completed the next composition step by turning the large
`createProxyManagerComposition` body into an explicit high-level outline:
path resolution, infrastructure foundations, lifecycle coordinators, and read
models. The named helpers keep the dependency graph and construction order
visible while leaving concrete adapters at the composition boundary. The
public facade and all coordinator contracts are unchanged.

The direct contract test added in `5597957` remains part of this boundary. It
proves profile-specific runtime token precedence over shared runtime and
persisted fallback state. The focused ProxyManager-related run passes 20/20
tests with loopback access, including per-profile orchestration, certificate
cache, facade integration, multi-window attachment, shared-proxy status,
composition token precedence, output coordination, profile lifecycle, and
shared lifecycle.

Evidence for this checkpoint:

- the complete Node 24.19.0/pnpm 10.34.0 audit passes with 909 host tests,
  18 webview tests, 315 production TypeScript files, 82.00% lines, 75.14%
  branches, and 78.94% functions;
- lint and the architecture checker pass; the latter reports no new
  dependency-direction violation across all 315 production TypeScript files;
- Repowise reports `src/services/proxyManagerComposition.ts` at 9.47/10,
  NLOC 488, max CCN 6, max nesting 3, and a dedicated test file. The former
  single large composition method is replaced by named construction phases;
- Graphify `0.9.48` was regenerated at `c1af58b`: 5,447 nodes, 12,973 raw
  edges, and 11,187 post-build edges. Its diagnostic reports 1,591 dangling
  endpoint edges, one self-loop, no missing endpoints, and 104 same-endpoint
  relation groups. `ProxyManager` is no longer in the top-eight god-node
  report;
- the selected Linux ARM64 VSIX contents still pass the release verification
  gate after the refactor.

This checkpoint does not close QA-5, QA-6, QA-7, or QA-8. The next code-quality
target is the remaining high-risk MITM lifecycle/capture boundary and its
coverage gradient. The release-grade disk-full, crash/restart, native
privileged-command, dependency-attribution, full target matrix, and final
rehearsal gates remain open.

## QA-6 / QA-7 / QA-8.24 deterministic storage-full failure classification — 2026-08-26

Commit `40d3661` makes storage-full handling explicit at the filesystem error
boundary. `FileSystemErrorCode` now includes `ENOSPC`, `isStorageFullError`
recognizes Node-style no-space errors, and `handleFileSystemError` emits an
actionable message that tells the user to free disk space and retry. The
filesystem port documentation records that remove and copy operations can fail
because of permissions or a full filesystem.

The storage cleanup regression uses a realistic `ENOSPC` error after a partial
cleanup. It verifies that the result preserves the 256 bytes already reclaimed
and exposes the original "No space left on device" detail through the typed
partial-failure result. The filesystem-error and full storage-cleanup focused
run passes 24/24 tests; the complete pinned Node 24.19.0/pnpm 10.34.0 audit
passes 910 host tests, 18 webview tests, 315 production TypeScript files, and
82.04% lines / 75.09% branches / 79.01% functions.

Current analysis evidence was refreshed after the commit:

- Graphify `0.9.48`: 5,449 nodes, 12,979 raw edges, 11,193 post-build edges,
  1,591 dangling endpoint edges, one self-loop, no missing endpoints, and 104
  same-endpoint relation groups;
- Repowise `0.45.0`: index synchronized to `40d3661`, average health 8.5/10,
  hotspot health 7.7/10, worst-file health 3.1/10,
  maintainability 9.4/10, and 108 performance findings; the changed
  `fileSystemErrors.ts` is scored at 7.87/10 with a dedicated test;
- the targeted source and test changes pass lint and the architecture checker.

This checkpoint closes deterministic classification and partial-cleanup
reporting only. It does not claim that a real filesystem has been exhausted:
physical disk-full execution, crash/restart reconciliation, native privileged
command review, protocol-specific redaction, attribution, the full target
matrix, and final release rehearsal remain open in QA-2, QA-3, QA-6, QA-7,
QA-8, and QA-10. Repowise's coverage ingestion also currently disagrees with
the c8 record for `fileSystemErrors.ts`; that mismatch remains an explicit
QA-8 follow-up.

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

## QA-5 / QA-8.25 Composer state-poller boundaries and webview synchronization — 2026-08-26

Commits `d0f8524` and `2bf5512` moved the Composer database poller's external
state boundaries behind explicit dependencies: database readers, profile-state
path resolution, clock, branch detection, polling interval, and scheduler.
The poller exposes one `pollOnce()` execution path shared by scheduled and
manual/test callers, keeps the in-flight guard, and preserves the existing
watermark and disabled-profile behavior. The focused poller suite passes 8/8,
covering initial seed, new eligible prompt detection, watermark persistence,
disabled profiles, reader failure/retry, and overlapping cycles.

Commit `4dae35f` also removed a timing race from the Accounts webview test
boundary. The message listener now returns the asynchronous handling promise,
and the test adapter awaits that promise instead of relying on a fixed delay.
Error handling remains inside the production message boundary, so this change
only makes completion observable to the test harness.

Evidence for this checkpoint:

- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 914 host
  tests, 18 webview tests, 315 production TypeScript files, and 82.74% lines /
  75.19% branches / 79.57% functions;
- the focused Composer poller suite passes 8/8, and c8 reports 93.04% lines /
  81.82% branches for `composerDbPoller.ts`;
- the AccountsPanel focused suite passes 17/17, while the complete webview
  suite passes 18/18;
- Graphify `0.9.48` reports 5,457 nodes, 13,004 raw edges, 11,212 post-build
  edges, 654 uncached files, 1,593 dangling endpoints, one self-loop, and 108
  same-endpoint relation groups; these remain extraction signals, not
  architecture violations;
- Repowise detailed health after explicit `coverage/lcov.info` ingestion
  reports 8.53/10 average health, 5.92/10 hotspot health, and
  `src/services/proxyManager.ts` as the worst file at 2.88/10. The poller is
  reported at 93.04% lines / 81.82% branches. The compact status view has a
  known rounded/stored-summary mismatch, documented in the QA-0 evidence.

This checkpoint improves testability and dependency direction but does not
close QA-5 or QA-8. Remaining work includes characterization and targeted
refactoring of the ProxyManager and efficiency-service hotspots, repeated
host/webview runs, static-analysis coverage policy, physical disk-full and
crash/restart evidence, the full native target matrix, supply-chain
attribution, operational runbooks, and the final release rehearsal.

## QA-5 / QA-8.26 efficiency toggle workflow and poller lifecycle boundary — 2026-08-26

Commit `8658284` separates the profile-level efficiency toggle into
`EfficiencyToggleWorkflow`. The workflow owns active-window validation,
consent, authentication-token retrieval, API-key operations, profile updates,
and statistics cleanup/loading. It depends on narrow API-key, profile,
authentication, and statistics boundaries and does not own the Composer
poller's lifecycle. `EfficiencyService` now remains responsible for
composition, initialization, poller synchronization, and user-facing restart
notification.

The same commit introduces explicit efficiency ports for the analyzer, output
presenter, API-key store, and poller, plus an injectable poller factory. This
allows lifecycle and failure behavior to be tested without mutating private
service state or starting a real database timer. Enabling analysis now resets
poller state before starting a newly created poller, preventing a previous
watermark from being reused after reactivation.

Evidence for this checkpoint:

- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 921 host
  tests, 18 webview tests, 317 production TypeScript files, and 82.96% lines /
  75.42% branches / 79.92% functions;
- the complete model-efficiency suite passes 80/80; the service/workflow
  focused suite passes 14/14, including enabled initialization, activation
  reset ordering, restart replacement, API-key failure translation, disabled
  cleanup ordering, and inactive-window rejection;
- c8 reports 92.39% lines / 92.59% branches / 81.82% functions for
  `efficiencyService.ts` and 98.15% lines / 95.83% branches / 100% functions
  for `efficiencyToggleWorkflow.ts`;
- the architecture checker passes for all 317 production TypeScript files and
  the full audit remains green after the new ports are introduced;
- Graphify `0.9.48` reports 5,491 nodes, 13,104 raw edges, 11,307 post-build
  edges, 658 uncached files, 1,597 dangling endpoints, one self-loop, and 109
  same-endpoint relation groups. Its top code hub remains `t()` at degree 110;
  `ProxyManager` is degree 41 and remains a review target, not an automatic
  extraction candidate;
- Repowise detailed health after explicit lcov ingestion reports 8.55/10
  average health, 5.89/10 hotspot health, and `proxyManager.ts` as the
  worst-file target at 2.88/10. `efficiencyService.ts` is reported at 5.70/10
  with NLOC 169, max CCN 4, and max nesting 2; the poller is at 6.07/10 with
  NLOC 279, max CCN 7, and max nesting 2.

This checkpoint closes the efficiency-service boundary and testability slice,
not the release program. Remaining gates are the ProxyManager/profile
hotspots, accounting decoder and rounding corpus, physical disk-full and
crash/restart evidence, full native target matrix, supply-chain attribution,
operational runbooks, repeated-run evidence, and QA-10 release rehearsal.

## QA-5 / QA-7 / QA-8.27 hermetic extension activation and facade lifecycle boundary — 2026-08-26

Commit `8b58635` removes an integration-test dependency on the developer's
real profile and shared-proxy directories. The extension composition root now
accepts optional profile-storage and shared-proxy-directory factories while
preserving the existing platform paths as production defaults. The activation
test provides isolated temporary adapters, so persisted proxy-enabled profiles
cannot start a real local proxy or connect to an unrelated runtime during the
test suite.

The same change tracks the asynchronous profile initialization promise and
awaits it during deactivation. This closes a teardown race in which a storage
write could occur after a test had started deleting its temporary directory.
Together with the earlier ProxyManager facade lifecycle change, disposal is
idempotent and its traffic-bus subscription is explicitly released.

Evidence for this checkpoint:

- the isolated extension activation test passes 1/1;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests, 18 webview tests, 317 production TypeScript files, and 82.35% lines /
  75.51% branches / 79.89% functions;
- compile, lint, architecture rules, and architecture fixtures pass;
- Graphify `0.9.48` reports 5,499 nodes, 13,140 raw edges, 11,336 post-build
  edges, 659 uncached files, 1,604 dangling endpoints, one self-loop, and 109
  same-endpoint relation groups;
- Repowise `0.45.0` is synchronized to `8b58635`, reports 8.54/10 average
  health, 5.89/10 hotspot health, 9.42/10 maintainability, 9.92/10
  performance, and no safe-only dead-code findings after explicit lcov
  ingestion. Its current worst file is `scripts/build.mjs` at 3.31/10;
  `src/services/proxyManager.ts` is 3.45/10 and `src/extension.ts` is
  3.46/10.

This checkpoint closes a determinism and lifecycle defect in the test
boundary, but does not close QA-5 or QA-7 globally. Physical crash/restart and
disk-full evidence, full native target coverage, supply-chain attribution,
remaining composition/webview hotspots, repeated-run evidence, operational
runbooks, and QA-10 release rehearsal remain open.

## QA-5 / QA-8.28 extension composition-root extraction — 2026-08-26

Commit `a8ac099` moves concrete service construction from `src/extension.ts`
into `src/composition/createExtensionRuntime.ts`. The entrypoint now focuses on
activation generation, migration kickoff, lifecycle wiring, command
registration, service startup, and asynchronous profile initialization. The
new composition module owns the adapter graph and returns a typed
`ExtensionRuntime`, while production storage defaults and deterministic test
factories remain explicit at the composition boundary.

This preserves the dependency direction enforced by the architecture checker:
the extension entrypoint and composition module are outer-layer wiring, while
domain ports continue to define the contracts consumed by application and
infrastructure services. The extraction is intentionally not treated as a
license to hide behavior in a generic service locator.

Evidence for this checkpoint:

- `src/extension.ts` is reduced from 520 to 373 lines, while the extracted
  composition module is 212 lines and has a direct activation-path test;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests, 18 webview tests, 318 production TypeScript files, and 82.39% lines /
  75.51% branches / 79.90% functions;
- the affected extension, ProxyManager composition, and ProxyManager facade
  contract tests pass 4/4;
- Graphify `0.9.48` reports 5,503 nodes, 13,142 raw edges, 11,335 post-build
  edges, 660 uncached files, 1,605 dangling endpoints, one self-loop, and 111
  same-endpoint relation groups. `ProxyManager` remains a degree-43 hub, while
  the extracted runtime is a composition boundary rather than a domain hub;
- Repowise `0.45.0`, after explicit lcov ingestion, reports 8.55/10 average
  health, 5.90/10 hotspot health, 9.42/10 maintainability, and 9.92/10
  performance. `src/extension.ts` improves to 3.11/10 (NLOC 330, max CCN 23,
  61.39% lines / 55.00% branches), and
  `src/composition/createExtensionRuntime.ts` scores 7.94/10 (NLOC 200,
  94.81% lines / 50.00% branches).

The extraction improves the composition boundary but does not close QA-5 or
QA-8 globally. Remaining work includes the script/build hotspot, the
ProxyManager/profile lifecycle hotspots, webview monoliths and direct UI
coverage, accounting reconciliation corpus, physical reliability evidence,
full native target coverage, supply-chain attribution, operational runbooks,
repeated-run evidence, and QA-10 release rehearsal.

## QA-3 / QA-5 / QA-8.29 build-target contract extraction — 2026-08-26

Commit `e99c6f7` extracts build-target constants and argument resolution from
`scripts/build.mjs` into the pure `scripts/build-targets.mjs` module. The
resolver has an explicit target matrix, target-specific SDK package mapping,
precedence rules, and fail-closed validation for unsupported targets. This
reduces the amount of policy hidden inside the build composition script while
keeping the actual packaging workflow unchanged.

Evidence for this checkpoint:

- the focused build-target suite passes 7/7 cases, covering defaults, current
  target selection, all-target selection, explicit target lists, precedence,
  Windows SDK mapping, and invalid arguments;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests, 23 webview tests, 318 production TypeScript files, and 82.39% lines /
  75.51% branches / 79.90% functions;
- lint and the architecture checker pass after introducing the script module;
- Repowise still classifies `scripts/build.mjs` as a hotspot at 3.31/10, but
  now measures it at NLOC 248 with max CCN 15 and max nesting 4. The extraction
  is therefore a partial boundary improvement, not completion of the build
  monolith or the native target-matrix gate.

The complete darwin, Linux, and Windows runner matrix, clean-room artifact
reproduction, and release-level packaging evidence remain open under QA-3.

## QA-5 / QA-8.30 ProfileCard presentation boundary — 2026-08-26

Commit `3318df3` extracts deterministic presentation rules from
`webview/src/components/ProfileCard.tsx` into
`profileCardPresentation.ts`. The helper owns reset-date formatting,
authentication-error classification, initials, dollar formatting, quota
remaining labels, and repository-name fallback rules. The component retains
the React rendering and interaction orchestration, so the extraction does not
pretend that the component monolith has been eliminated.

Evidence for this checkpoint:

- the new presentation-helper suite passes 5/5 cases, including invalid and
  near-term dates, non-finite monetary values, authentication errors, quota
  overage policy, and workspace path/name fallbacks;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests and 23 webview tests across 6 files, with 82.39% lines / 75.51%
  branches / 79.90% functions overall;
- the architecture checker and lint pass with the helper kept inside the
  webview presentation boundary;
- Repowise reports `ProfileCard.tsx` at 6.15/10 and NLOC 749, with no direct
  component test file yet. This confirms that the helper extraction improved
  test isolation but that rendering coverage and further component
  decomposition remain required.

This checkpoint improves the UI boundary and testability but does not close
QA-5 or QA-8. Direct rendering characterization, App/ProfileList composition,
webview message-boundary coverage, repeated and shuffled runs, and the
remaining release gates are still required.

## QA-5 / QA-8.31 webview host-message state boundary — 2026-08-26

Commit `be3d831` extracts the extension-to-webview message transition logic
from `webview/src/App.tsx` into the typed `appMessageState.ts` reducer. The
reducer owns host-derived profiles, accounts, quotas, workspaces, proxy state,
efficiency data, certificate/pricing responses, storage read-models, and
notifications. `App.tsx` retains browser and VS Code side effects such as
message subscription, downloads, logging, timers, and modal-only interaction
flags. This keeps the reducer deterministic and prevents the presentation
component from combining transport decoding with state transition policy.

The reducer also preserves two important correctness rules: storage responses
are accepted only for the currently selected profile, and certificate/storage
notifications are translated or surfaced with the same user-visible semantics
as before. The `exportData` message remains an explicit browser-side effect and
does not mutate application state.

Evidence for this checkpoint:

- the new reducer suite passes 7/7 focused cases, including initial hydration,
  incremental updates, certificate outcomes, stale storage responses, pricing,
  notifications, and reset transitions;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests and 30 webview tests across 7 files, with 82.39% lines / 75.51%
  branches / 79.90% functions overall;
- webview typecheck, webview build, repository lint, architecture rules,
  localization, protobuf validation, documentation links, and selected VSIX
  verification pass;
- Graphify `0.9.48` reports 5,531 nodes, 13,247 raw edges, 11,424 post-build
  edges, 666 uncached files, 1,621 dangling endpoints, one self-loop, and 111
  same-endpoint relation groups. The SQL parser limitation remains documented;
- Repowise `0.45.0`, after explicit lcov ingestion, reports 8.57/10 average
  health, 5.95/10 hotspot health, 9.43/10 maintainability, and 9.92/10
  performance. `webview/src/App.tsx` improves to 4.93/10 with NLOC 572,
  max CCN 11, and max nesting 1.

This checkpoint materially reduces the App composition hotspot but does not
close QA-5 or QA-8. Direct rendering coverage, `vscodeApi` transport
characterization, ProfileList/ProfileCard decomposition, repeated and
shuffled-run evidence, and the remaining release gates are still required.

## QA-1 / QA-2 / QA-8.32 webview behavior coverage and nested toolchain alignment — 2026-08-26

Commits `ffd1259`, `a0681b9`, and `c0627e1` close the next webview
testability and reproducibility gap. `VSCodeAPI` now exposes an injectable
message target for isolated contract tests, while production still uses the
browser window and the existing singleton bridge. `ProfileCard` now has direct
rendering and interaction coverage across identity, authentication failures,
quota expansion, workspace/GitHub actions, menu confirmation, and efficiency
breakdowns. The nested webview package manifest is also aligned with the root
Node 24/pnpm 10.34.0 contract.

Evidence for this checkpoint:

- the VS Code bridge contract suite passes 5/5 focused cases, covering pending
  message delivery, unsubscribe behavior, invalid payload rejection, all
  command mappings, persisted-state versioning, and missing-bootstrap failure;
- the direct ProfileCard suite passes 6/6 cases, covering the primary
  rendering and interaction paths listed above;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests and 41 webview tests across 9 files, with 82.39% lines / 75.51%
  branches / 79.90% functions overall;
- root and webview manifests now declare the same pnpm version; webview
  typecheck, build, repository lint, architecture rules, localization,
  protobuf validation, documentation links, native checks, and selected VSIX
  verification pass;
- Graphify `0.9.48` reports 5,545 nodes, 13,290 raw edges, 11,455 post-build
  edges, 668 uncached files, 1,633 dangling endpoints, one self-loop, and 111
  same-endpoint relation groups. `VSCodeAPI` is degree 38 and the
  `ProfileCard` test boundary is now represented in the graph;
- Repowise `0.45.0`, after explicit lcov ingestion, reports 8.57/10 average
  health, 5.95/10 hotspot health, 9.43/10 maintainability, and 9.92/10
  performance. `ProfileCard.tsx` is 6.15/10 with NLOC 749 and 8.54%
  duplication, and `vscodeApi.ts` is 5.25/10 with NLOC 192 and a paired test
  file. Webview coverage is not yet part of the root c8 report, so these
  tests improve confidence without changing the global c8 percentages.

This checkpoint improves behavior evidence and package reproducibility but
does not close QA-1, QA-2, QA-5, or QA-8 globally. Webview coverage reporting,
remaining component decomposition, full native runner evidence, supply-chain
attribution, physical recovery tests, and the final release rehearsal remain
open.

## QA-1 / QA-8.33 reproducible webview coverage gate — 2026-08-26

Commit `48bea53` makes the webview test suite produce an auditable coverage
artifact and makes that artifact part of the repository audit and CI workflow.
The implementation uses the version-matched `@vitest/coverage-v8@3.2.6`
provider with the repository's locked Vitest `3.2.6` runtime. Coverage is
explicitly limited to `webview/src/**/*.{ts,tsx}` while test files and the test
setup are excluded; the reports are written to the ignored
`webview/coverage/` directory as text, JSON summary, and LCOV outputs.

Evidence for this checkpoint:

- `CI=true pnpm --dir webview run test:coverage` passes 9/9 files and 41/41
  tests with 41.31% statements/lines, 74.48% branches, and 83.03% functions;
- the global webview floors are 40% statements, 40% lines, 70% branches, and
  80% functions, all below the measured baseline to prevent regression without
  blocking the planned App and component coverage work;
- risk-specific floors protect the already-tested boundaries: `appMessageState`
  at 80/45/100, `vscodeApi` at 90/95/90, `bootError` at 80/50/100, and
  `ProfileCard` at 70/65/70 for statements/lines, branches, and functions;
- `scripts/run-audit.mjs` now invokes the webview coverage script, and CI
  uploads `webview/coverage/` as a 14-day workflow artifact;
- Repowise ingests the host and webview reports together, resolving 275 input
  records into a 274-file coverage index; its updated health report identifies
  `webview/src/App.tsx` as the principal remaining coverage hotspot;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes at commit
  `48bea53`, including 923 host tests, 41 webview tests, architecture,
  localization, supply-chain evidence, native checks, and selected VSIX
  verification;
- Graphify `0.9.48` was refreshed after the change and reports 5,549 nodes,
  13,294 raw edges, 11,459 post-build edges, one self-loop, and 111
  same-endpoint relation groups.

This closes the missing webview coverage-reporting and CI-enforcement slice but
does not claim complete UI confidence. `App.tsx` still needs direct render and
host-bridge integration tests, uncovered profile/modals remain prioritized, and
repeated/shuffled-run, native matrix, attribution, physical recovery, and final
release-rehearsal evidence remain open.

## QA-5 / QA-8.34 extension activation orchestration decomposition — 2026-08-26

Commit `e958f64` decomposes the extension activation workflow at the existing
composition boundary. `src/extension.ts` now retains only activation-generation
state, migration kickoff, runtime creation, deactivation state, and calls to
explicit composition helpers. The extracted modules have one responsibility
each:

- `extensionInitialization.ts` owns guarded profile/proxy initialization and
  startup-panel policy;
- `extensionRuntimeWiring.ts` connects runtime events to the status bars,
  accounts panel, and traffic ingress;
- `extensionCommands.ts` registers profile, proxy, configuration, usage,
  efficiency, and diagnostic commands;
- `extensionServices.ts` starts configured periodic services and binds their
  disposal to the VS Code activation context.

This keeps lifecycle and dependency construction in the outer composition
layer while leaving domain policies, application workflows, and infrastructure
adapters behind their existing ports. The activation-generation guard remains
explicit, so an older asynchronous initialization cannot mutate or retain a
new activation's runtime.

Evidence for this checkpoint:

- `src/extension.ts` is reduced from 373 to 118 lines; the four focused
  composition modules total 316 lines and are covered through the activation
  integration path;
- the extension activation integration test passes 1/1, the complete audit
  passes 923 host tests and 51 webview tests, and coverage is 82.42% lines,
  75.56% branches, and 79.95% functions for the host plus 84.97% lines,
  78.21% branches, and 83.87% functions for the webview;
- the architecture checker and fixtures pass for 322 production TypeScript
  files, with tests excluded by contract;
- Repowise improves `src/extension.ts` to 5.88/10 (NLOC 98, max CCN 4, max
  nesting 1, 88.14% lines, 57.14% branches, and 8.08% duplication). The
  repository's current worst hotspot is now `scripts/build.mjs` at 3.31/10;
- Graphify `0.9.48` reports 5,571 nodes, 13,370 raw edges, 11,518 post-build
  edges, 1,650 dangling endpoint edges, one self-loop, and 111 same-endpoint
  relation groups. The SQL parser dependency limitation remains documented;
- the host and webview LCOV reports were re-ingested into Repowise, which now
  tracks 278 covered files. Safe-only dead-code analysis remains empty.

This checkpoint improves the activation composition boundary but does not
close QA-5 or QA-8 globally. The build-script hotspot, proxy/profile
orchestration, remaining UI modal coverage, physical reliability evidence,
complete native target matrix, supply-chain attribution, operational runbooks,
and QA-10 release rehearsal remain open.

## QA-3 / QA-5 / QA-8.35 shared VSIX verification boundary — 2026-08-26

Commit `d0c9e3d` centralizes VSIX artifact inspection and assertion policy in
`scripts/vsixVerification.mjs`. Both the build-time verifier and the standalone
`verify:vsix` command now use the same required-entry, forbidden-artifact, SDK
platform-package, and `better-sqlite3` native-target rules. The build keeps the
efficiency migration check enabled; the standalone verifier preserves its
previous lighter check set while still validating platform-specific artifacts
when the target can be derived from the VSIX name.

The shared boundary also removes shell interpolation from ZIP inspection. It
invokes `unzip` through `execFileSync` argument arrays, applies a bounded output
buffer, and keeps pattern matching in JavaScript. This prevents artifact names
or verification patterns from being interpreted by a shell and makes the
policy directly testable. The four contract tests cover a complete artifact,
missing required content, forbidden development content, wrong native target,
and missing native binding failure behavior.

Evidence for this checkpoint:

- `pnpm run test:vsix-verifier` passes 4/4 contract tests;
- the pinned Node 24.19.0/pnpm 10.34.0 `pnpm run audit` passes, including the
  new verifier contract gate, 923 host tests, 51 webview tests, webview V8
  coverage floors, architecture checks, and current-target packaging checks;
- `pnpm run build:current` and `pnpm run verify:vsix` pass against the selected
  current-platform artifact, including the webview bundle, Cursor SDK,
  `undici`, `bindings`, platform SDK package, and native target;
- Repowise reports 4,410 nodes and 12,551 edges, 0 unreachable files, and 0
  unused exports. Combined host/webview coverage remains 278 files at 82.7%
  lines and 75.3% branches. Aggregate health is 8.58/10, hotspot health is
  5.99/10, maintainability is 9.44/10, and performance is 9.93/10. The
  refactored `scripts/build.mjs` is 6.50/10 (NLOC 148, max CCN 4, max nesting
  2), `scripts/verify-vsix.mjs` is 6.50/10 (NLOC 76, max CCN 1), and the
  shared module is 8.24/10 (NLOC 133, max CCN 7, max nesting 5, 10.53%
  duplication);
- Graphify `0.9.48` reports 5,583 nodes, 13,395 raw edges, 11,541 post-build
  edges, 1,652 dangling endpoint edges, one self-loop, and 111 same-endpoint
  relation groups. The SQL parser limitation remains documented.

This closes the duplicated VSIX-policy implementation and its selected-target
contract-test gap. It does not close the complete native target matrix,
clean-room release reproducibility, physical recovery evidence, supply-chain
attribution, or QA-10 release rehearsal.

## QA-7 / QA-5 / QA-8.36 ProxyManager listener ownership — 2026-08-26

Commit `58cb88f` completes the external traffic-listener lifecycle in
`src/services/proxyManager.ts`. Every listener registered through `onTraffic`
now has an owned unsubscribe callback, registration is ignored after disposal,
and disposal releases both the internal coordinator subscription and every
external listener. The change preserves idempotent disposal and keeps listener
ownership in the service facade rather than leaking it to callers.

Evidence for this checkpoint:

- the ProxyManager facade lifecycle suite passes 2/2 focused cases for listener
  delivery and disposal cleanup;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes;
- Repowise reports the remaining facade at 3.44/10 with NLOC 349, max CCN 4,
  max nesting 4, 85.75% lines, and 82.14% branches; this remains a
  prioritization signal and not a deletion instruction.

This closes the identified external-listener leak boundary but does not close
QA-7 globally: physical restart/crash recovery, disk-full behavior, and the
release-level recovery rehearsal remain open.

## QA-4 / QA-5 / QA-8.37 live usage accounting state boundary — 2026-08-26

Commits `0b77b78` and `517e163` move live usage accounting policy out of the
VS Code status-bar adapter into `src/application/services/agentLiveUsageState.ts`.
The extracted policy owns session identity, traffic-agent merging, token-total
precedence, stale batch-event rejection, turn accounting, delta-cost
calculation, and completed-turn reset behavior. Its only infrastructure
dependency is a narrow live-cost calculator port plus an injected session merge
function; timers, VS Code APIs, and presentation state are not part of this
policy module.

The follow-up decomposition names the state transitions and cost-resolution
helpers explicitly. This keeps the application boundary deterministic and
allows the status-bar adapter to consume a read model without owning billing
semantics.

Evidence for this checkpoint:

- the direct state-policy suite contributes 5 tests and the combined live usage
  suite passes 10/10;
- Repowise rates `agentLiveUsageState.ts` at 9.67/10 with NLOC 279, max CCN 8,
  max nesting 1, and approximately 83.5% branch coverage;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with the current
  host and webview coverage gates.

This improves the application dependency direction but does not close QA-4:
decoder-shape, rounding, and unknown/cache-rate reconciliation still require
the planned golden corpus.

## QA-5 / QA-8.38 live usage presentation boundary — 2026-08-26

Commit `1a8238e` extracts deterministic live-usage display construction into
`src/ui/presentation/agentLiveUsagePresentation.ts`. Formatting, token
summaries, cost labels, model/context summaries, and tooltip construction now
live in a pure presentation helper. `AgentLiveUsageStatusBar` retains only
VS Code item lifecycle, configuration, timers, state ingestion, and rendering.

Evidence for this checkpoint:

- the presentation helper has 4 direct tests and the combined live usage suite
  passes 9/9;
- the status-bar adapter measures 91.79% lines, 91.67% branches, and 100%
  functions in the current host coverage report;
- Repowise rates the adapter at 6.02/10 (NLOC 116, max CCN 4, max nesting 1)
  and the pure presentation module at 7.79/10 (NLOC 185, max CCN 15, max
  nesting 2);
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes.

This closes the identified status-bar policy/presentation mixing boundary but
does not claim complete UI confidence; remaining webview component coverage
and the broader release gates remain open.

## QA-5 / QA-6 / QA-8.39 Accounts panel HTML and CSP boundary — 2026-08-26

Commit `6003034` extracts Accounts panel document generation into the pure
`src/ui/presentation/accountsPanelHtml.ts` renderer. Dynamic HTML attributes
and text are escaped, bootstrap data is serialized for safe inline-script
embedding, and the provider retains only webview resource validation, URI
construction, locale selection, and delegation. This keeps the CSP/bootstrap
policy testable without requiring the VS Code webview runtime.

Evidence for this checkpoint:

- the direct HTML/CSP renderer tests cover CSP/bootstrap output and malicious
  attribute/text/script payloads;
- the focused Accounts panel suite passes 19/19;
- the renderer measures 99.38% lines, 90% branches, and 100% functions, while
  the provider measures 76.88% lines and 85.36% branches in the current host
  report;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes.

This improves the security-sensitive presentation boundary but does not close
QA-6: protocol-specific redaction, privileged certificate execution, physical
disk-full behavior, and crash/restart evidence remain open.

## QA-5 / QA-8.40 proxy traffic analysis boundary — 2026-08-26

Commit `0b3c8c9` reduces `scripts/analyze-proxy-traffic.mjs` to a thin CLI
composition and reporting entry point. The reusable
`scripts/lib/proxy-traffic-analysis.mjs` module now owns deterministic log-file
resolution, JSON/protobuf body decoding, Connect framing and gzip handling via
the shared protobuf verifier, RPC classification, nested bidi insight merging,
and bounded report aggregation. The module has no CLI side effects, while the
CLI owns schema loading, input validation, and output formatting.

The boundary prevents the analysis command from maintaining a second framing
decoder and makes malformed JSON, missing types, compressed protobuf bodies,
interactive RPC classification, and nested token events directly testable.

Evidence for this checkpoint:

- `pnpm run test:proxy-traffic-analysis` passes 3/3 contract tests;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with 923 host
  tests and 51 webview tests;
- Repowise rates the CLI at 5.30/10 (NLOC 59, max CCN 9, max nesting 2) and
  the analysis module at 7.20/10 (NLOC 175, max CCN 13, max nesting 4), while
  the global worst hotspot remains `src/services/proxyManager.ts` at 3.44/10;
- Graphify reports 5,633 nodes, 13,517 raw edges, 11,647 post-build edges,
  1,668 dangling endpoint edges, one self-loop, and 111 same-endpoint
  relation groups. These are graph diagnostics, not architecture violations.

This closes the duplicated analyzer framing implementation and its missing
contract-test boundary. It does not close QA-5 or QA-8 globally; the remaining
high-risk production modules, full native matrix, physical recovery evidence,
supply-chain attribution, operational runbooks, and QA-10 rehearsal remain
open.

## QA-5 / QA-8.41 shared protobuf framing and verification reporting — 2026-08-26

Commit `664705b` makes `scripts/lib/connect-payload.mjs` the single framing
candidate implementation for the JavaScript proxy-analysis and protobuf
verification tools. It handles raw payloads, multiple Connect frames, the
historical compact two-byte prefix, and deduplication of equivalent payload
views. The protobuf verifier keeps its existing named export as a compatibility
re-export, while session summarization and the schema smoke test consume the
shared helper directly.

The same commit extracts stable summary calculation and text rendering from
`scripts/verify-proto-jsonl.mjs` into the pure
`scripts/lib/proto-jsonl-report.mjs` module. The CLI now retains only schema
loading, log-directory validation, report invocation, console output, and the
existing non-zero exit rule when dashboard usage RPCs have validation failures.

Evidence for this checkpoint:

- the existing protobuf verifier contract suite passes 5/5, the new report
  suite passes 2/2, and the schema smoke test passes;
- the complete pinned Node 24.19.0/pnpm 10.34.0 audit passes with the new report
  test included in the audit runner;
- Repowise rates `scripts/verify-proto-jsonl.mjs` at 6.20/10 (NLOC 42, max CCN
  3, max nesting 1), `scripts/lib/proto-jsonl-report.mjs` at 10.00/10 (NLOC
  104, max CCN 8, max nesting 3), and `scripts/lib/connect-payload.mjs` at
  8.70/10 (NLOC 33, max CCN 10, max nesting 2);
- Graphify reports 5,642 nodes, 13,542 raw edges, 11,668 post-build edges,
  1,670 dangling endpoint edges, one self-loop, and 113 same-endpoint
  relation groups. Ten SQL contributions remain outside the graph because
  `tree_sitter_sql` is not installed.

This closes the duplicated JavaScript framing implementation and the report
CLI's large-method boundary. It does not close QA-5 or QA-8 globally; the
remaining high-risk production modules, full native target matrix, physical
recovery evidence, supply-chain attribution, operational runbooks, and QA-10
release rehearsal remain open.

## Reclassification decisions

The following historical findings are reclassified from the current baseline:

| Historical finding | Current classification | Reason |
|---|---|---|
| Webview DOM leakage | PARTIALLY RESOLVED | Current webview suite passes 41/41 with explicit cleanup and coverage; repeated and shuffled-run evidence remains |
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
| 2026-08-26 | QA-5/QA-8 storage action-runner extraction slice | 22bc487 | Extracted policy-specific actions from the cleanup facade, added direct runner tests, 26/26 focused storage tests, complete Node 24.19.0/pnpm 10.34.0 audit pass, Graphify 5,406 nodes/12,807 raw edges, Repowise facade 5.36/10 and runner 9.3/10 |
| 2026-08-26 | QA-8.21 proxy insight dispatch/redaction boundary and coverage slice | 5e93c8d, 86d9180 | Split RPC dispatch and sensitive redaction behind focused modules while preserving facade exports; 25/25 focused insight tests, redaction primitive-branch coverage, complete Node 24.19.0/pnpm 10.34.0 audit pass at 81.62%/75.04%/78.44%, Graphify 5,418 nodes/12,840 raw edges, Repowise RPC module 9.65/10; native, crash/restart, disk-full, and attribution gates remain open |
| 2026-08-26 | QA-5/QA-8.22 ProxyManager composition boundary slice | 83f6303 | Extracted the coordinator composition root from the public facade, moved shared state behind a domain port, replaced private-method test mutation with injected ports, focused suites 18/18, complete Node 24.19.0/pnpm 10.34.0 audit pass at 81.62%/75.04%/78.44%, Graphify 5,426 nodes/12,907 raw edges, ProxyManager degree 71→41, Repowise ProxyManager NLOC 640→330; direct composition tests and release-grade QA gates remain open |
| 2026-08-26 | QA-5/QA-8.23 named ProxyManager composition phases slice | c1af58b, 5597957 | Named foundations, lifecycle, and read-model construction phases; added direct token-precedence contract coverage, focused ProxyManager-related suites 20/20, complete Node 24.19.0/pnpm 10.34.0 audit pass at 82.00%/75.14%/78.94%, Graphify 5,447 nodes/12,973 raw edges, Repowise composition 9.47/10 with max CCN 6; release-grade QA gates remain open |
| 2026-08-26 | QA-6/QA-7/QA-8.24 deterministic storage-full failure classification slice | 40d3661 | Added typed ENOSPC detection and actionable filesystem errors; preserved partial cleanup accounting after a realistic no-space failure; filesystem-error/storage-cleanup focused run 24/24; complete Node 24.19.0/pnpm 10.34.0 audit pass at 82.04%/75.09%/79.01%, Graphify 5,449 nodes/12,979 raw edges, Repowise synchronized with 108 performance findings; physical disk-full and crash/restart evidence remain open |
| 2026-08-26 | QA-5/QA-8.25 Composer state-poller boundaries and webview synchronization slice | d0f8524, 2bf5512, 4dae35f | Injected Composer state-reader, path, clock, branch-detector, and scheduler boundaries; added 8/8 poller tests for seed/watermark, disabled profiles, retry, and concurrency; fixed asynchronous Accounts webview test synchronization; complete Node 24.19.0/pnpm 10.34.0 audit pass at 82.74%/75.19%/79.57%, Graphify 5,457 nodes/13,004 raw edges, Repowise explicit lcov ingestion; physical reliability, native matrix, attribution, and final rehearsal remain open |
| 2026-08-26 | QA-5/QA-8.26 efficiency toggle workflow and poller lifecycle boundary slice | 8658284 | Extracted `EfficiencyToggleWorkflow`, introduced narrow analyzer/API-key/output/poller ports and an injectable poller factory, fixed reactivation watermark reset ordering, added 14/14 focused and 80/80 model-efficiency tests; complete Node 24.19.0/pnpm 10.34.0 audit pass at 82.96%/75.42%/79.92%, Graphify 5,491 nodes/13,104 raw edges, Repowise detailed health refresh; release gates remain open |
| 2026-08-26 | QA-5/QA-7/QA-8.27 hermetic extension activation and facade lifecycle boundary slice | 8b58635 | Isolated profile/proxy storage factories at the composition root, awaited tracked profile initialization during deactivation, and verified 1/1 extension activation, 923/923 host tests, 18/18 webview tests, complete Node 24.19.0/pnpm 10.34.0 audit pass at 82.35%/75.51%/79.89%, Graphify 5,499 nodes/13,140 raw edges, and Repowise 8.54 average / 5.89 hotspot health; physical reliability, native matrix, attribution, and final rehearsal remain open |
| 2026-08-26 | QA-5/QA-8.28 extension composition-root extraction slice | a8ac099 | Moved concrete service construction into `createExtensionRuntime`, reduced `extension.ts` from 520 to 373 lines, preserved explicit storage seams, passed 4/4 affected contract tests and the complete Node 24.19.0/pnpm 10.34.0 audit at 82.39%/75.51%/79.90%, Graphify 5,503 nodes/13,142 raw edges, and Repowise 8.55 average / 5.90 hotspot health; remaining release gates stay open |
| 2026-08-26 | QA-3/QA-5/QA-8.29 build-target contract extraction slice | e99c6f7 | Extracted pure target and argument-resolution policy from `scripts/build.mjs`, added 7/7 resolver tests, passed lint and the complete Node 24.19.0/pnpm 10.34.0 audit at 82.39%/75.51%/79.90%; full native runner matrix remains open |
| 2026-08-26 | QA-5/QA-8.30 ProfileCard presentation boundary slice | 3318df3 | Extracted deterministic ProfileCard presentation helpers, added 5/5 focused tests, passed the complete Node 24.19.0/pnpm 10.34.0 audit with 923 host and 23 webview tests, refreshed Graphify to 5,514 nodes/13,184 raw edges and Repowise to 8.56 average / 5.90 hotspot health; direct component rendering coverage and remaining release gates stay open |
| 2026-08-26 | QA-5/QA-8.31 webview host-message state boundary slice | be3d831 | Extracted the typed host-message reducer from `App.tsx`, added 7/7 focused reducer tests, passed the complete Node 24.19.0/pnpm 10.34.0 audit with 923 host and 30 webview tests, refreshed Graphify to 5,531 nodes/13,247 raw edges and Repowise to 8.57 average / 5.95 hotspot health; direct rendering and transport coverage plus remaining release gates stay open |
| 2026-08-26 | QA-1/QA-2/QA-8.32 webview behavior coverage and nested toolchain alignment | ffd1259, a0681b9, c0627e1 | Added injectable bridge transport coverage (5/5), direct ProfileCard behavior coverage (6/6), aligned both package manifests to pnpm 10.34.0, and passed the complete Node 24.19.0/pnpm 10.34.0 audit with 923 host and 41 webview tests; Graphify 5,545 nodes/13,290 raw edges and Repowise 8.57 average / 5.95 hotspot health; webview coverage reporting, native matrix, attribution, physical recovery, and final rehearsal remain open |
| 2026-08-26 | QA-1/QA-8.33 reproducible webview coverage gate | 48bea53 | Added version-matched V8 coverage, global and boundary-specific webview floors, audit/CI enforcement, and 14-day coverage artifact upload; 41/41 webview tests at 41.31% lines/74.48% branches/83.03% functions; merged host/webview LCOV in Repowise; full Node 24.19.0/pnpm 10.34.0 audit passed; App direct integration coverage and remaining release gates stay open |
| 2026-08-26 | QA-3/QA-5/QA-8.35 shared VSIX verification boundary | d0c9e3d | Centralized build-time and standalone VSIX inspection, removed shell-interpolated ZIP checks, added 4/4 verifier contract tests, passed current-target build/verification and the complete Node 24.19.0/pnpm 10.34.0 audit; Repowise 8.58 average / 5.99 hotspot health and Graphify 5,583 nodes/13,395 raw edges; complete native matrix, physical recovery, attribution, and final rehearsal remain open |
| 2026-08-26 | QA-7/QA-5/QA-8.36 ProxyManager listener ownership | 58cb88f | Added owned external-listener unsubscribe callbacks and post-disposal registration guards; focused lifecycle suite 2/2 and complete audit pass; physical recovery and release rehearsal remain open |
| 2026-08-26 | QA-4/QA-5/QA-8.37 live usage accounting state boundary | 0b77b78, 517e163 | Extracted and decomposed live session/accounting policy behind an application boundary; direct state suite 5/5 and combined live usage suite 10/10; Repowise state module 9.67/10; cost reconciliation corpus remains open |
| 2026-08-26 | QA-5/QA-8.38 live usage presentation boundary | 1a8238e | Extracted deterministic live usage display formatting and tooltip construction; direct presentation suite 4/4 and combined live usage suite 9/9; complete audit pass; remaining UI coverage and release gates stay open |
| 2026-08-26 | QA-5/QA-6/QA-8.39 Accounts panel HTML/CSP boundary | 6003034 | Extracted escaped HTML/bootstrap rendering with CSP-focused tests; Accounts panel focused suite 19/19, renderer 99.38% lines/90% branches/100% functions, complete audit pass |
| 2026-08-26 | QA-5/QA-8.40 proxy traffic analysis boundary | 0b3c8c9 | Isolated log/RPC/protobuf/bidi analysis from the CLI, added 3/3 contract tests, passed the complete Node 24.19.0/pnpm 10.34.0 audit, Graphify 5,633 nodes/13,517 raw edges, Repowise CLI 5.30/10 and analysis module 7.20/10 |
| 2026-08-26 | QA-5/QA-8.41 shared protobuf framing and verification reporting | 664705b | Centralized JavaScript Connect framing, kept the verifier compatibility export, extracted pure report summary/rendering, added 2/2 report tests, passed schema smoke and complete audit, Graphify 5,642 nodes/13,542 raw edges, Repowise report 10.00/10 and framing helper 8.70/10 |

This register must be updated in the same commit as each task's implementation
or evidence change.
