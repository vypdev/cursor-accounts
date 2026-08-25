# Deep Architecture and Quality Audit — 2026-08-24

## 1. Scope and baseline

This audit reviews the repository after commit `9a116cf` on branch
`feature/3-mitm-proxy`. It covers:

- Clean Architecture and dependency direction.
- Module cohesion, coupling, cycles, and monolithic files.
- Tests, coverage, test isolation, and CI gates.
- Security boundaries, captured data, child processes, and dependencies.
- Documentation consistency and maintenance signals.
- Native runtime and VSIX packaging.

No production source changes were made while performing this audit. The only
repository change in this audit is this report.

The audit is evidence-based. Findings produced by Repowise and Graphify are
treated as prioritization signals and were checked against source code,
coverage output, executable repository checks, and package scripts.

## 2. Commands and tools used

Environment:

| Item | Observed value |
|---|---|
| Node.js | `v22.23.1` |
| pnpm | `11.19.0` |
| Repowise | `0.45.0` |
| Graphify | `0.9.48` |
| TypeScript | `5.9.3` from the workspace toolchain |
| Repository | 339 `src/**/*.ts` files, 125 extension test files, 40 documentation files |

Executed checks and analyses:

```text
CI=true pnpm run check:architecture
CI=true pnpm exec tsc --noEmit
CI=true pnpm exec tsc -p webview --noEmit
CI=true pnpm exec eslint .
CI=true pnpm exec eslint src webview/src packages --ignore-pattern 'src/test/**'
CI=true pnpm run test:types-sync
CI=true pnpm run verify:native:node
CI=true pnpm test
CI=true pnpm run test:coverage
CI=true pnpm --dir webview test
CI=true pnpm run validate:l10n
CI=true pnpm run compile
CI=true pnpm run build:current
CI=true pnpm audit --prod --json
repowise health --format json --refactoring-targets
repowise dead-code --safe-only
repowise security scan --history --format json
graphify extract . --code-only --out /private/tmp/cursor-accounts-audit-20260824 --no-cluster --max-workers 1
graphify god-nodes --top 30 ...
graphify diagnose multigraph --json ...
```

The Graphify graph was generated at:
`/private/tmp/cursor-accounts-audit-20260824/graphify-out/graph.json`.
Repowise state remains local and is excluded by `.gitignore`.

## 3. Executive summary

The project has a solid functional baseline, but the architecture is not yet
clean in the strict sense documented by the repository. The most important
issue is not the number of layers; it is the direction of their dependencies.
The domain ports currently depend on application DTOs, and application code
also depends on domain ports. The current architecture gate passes because it
does not model this boundary.

There are also release-quality blockers:

1. `pnpm audit --prod` reports 1 critical, 15 high, 14 moderate, and 4 low
   advisories. The critical advisory is in `tar@6.2.1` through the
   `@cursor/sdk -> sqlite3` dependency path. This must be triaged before a
   release; the audit output alone does not prove that every vulnerable path
   is reachable in the shipped runtime.
2. Webview tests fail 4 of 17 tests because rendered DOM is not cleaned up
   between test cases.
3. Localization validation fails for 24 of 25 non-English locales, each
   missing the same 18 keys.
4. Source-scoped ESLint reports 42 errors. The repository-wide command reports
   1,971 errors because generated staging output and generated documentation
   assets are not excluded from ESLint.
5. The current-platform packaging pipeline fails before VSIX verification
   because the expected `sqlite3` native binding is absent. It also contains a
   shell pipeline that can report a successful `better-sqlite3` prebuild even
   when `curl` fails.

The extension-host test suite is otherwise healthy: with loopback access
available, `CI=true pnpm test` passed 668 tests with zero failures. The Node
and webview TypeScript checks, architecture gate, type synchronization check,
Node-compatible SQLite verification, and compile command also pass.

## 4. Priority model

| Priority | Meaning |
|---|---|
| P0 | Release or security blocker requiring immediate triage. |
| P1 | High-risk architectural, quality, or operational issue that should be fixed before substantial feature work. |
| P2 | Important maintainability or test-debt issue with a bounded remediation path. |
| P3 | Cleanup, documentation, or tooling improvement. |

## 5. Findings

### P0-1 — Production dependency audit contains unresolved critical and high advisories

`CI=true pnpm audit --prod --json` reports 34 production advisories in 239
resolved production/optional dependency entries:

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 15 |
| Moderate | 14 |
| Low | 4 |

The most relevant paths are:

- `tar@6.2.1` through `@cursor/sdk -> sqlite3`, including a critical
  decompression/parse denial-of-service advisory patched in `tar >=7.5.19`.
- `undici@5.29.0` through `@cursor/sdk -> @connectrpc/connect-node`, with
  patched versions beginning at `6.23.0` to `6.28.0` depending on the issue.
- `protobufjs@7.6.3`, patched in `7.6.5`.
- `uuid@9.0.1` through `http-mitm-proxy`, patched in `11.1.1`.
- `body-parser@1.20.5` through Express, patched in `1.20.6`.

The existing VSIX artifacts also contain runtime copies of `@cursor/sdk`,
`sqlite3`, `undici`, and `protobufjs`, so this cannot be dismissed as only a
development dependency without inspecting the exact dependency tree produced
by the next successful package build.

Recommended action:

1. Generate an SBOM or exact shipped dependency list from a clean packaging
   workspace.
2. Upgrade `@cursor/sdk`, `sqlite3`, Express, `protobufjs`, and
   `http-mitm-proxy` where compatible.
3. Use lockfile overrides only with runtime smoke tests and a documented
   compatibility decision.
4. Add a CI policy that fails on critical/high production advisories unless a
   time-limited, reviewed exception exists.

Advisory links are emitted by the package registry audit and should be retained
in the dependency remediation issue, not copied into application code.

### P1-1 — The Clean Architecture dependency rule is currently violated

Graphify found 62 symbol-level edges from `src/domain` to `src/application` and
49 in the opposite direction. The domain-to-application edges resolve to 12
unique file pairs:

```text
src/domain/ports/IActiveConversationRepository.ts -> src/application/types/activeConversation.ts
src/domain/ports/IAgentTrackingRepository.ts -> src/application/types/agentPersistence.ts
src/domain/ports/IProxyApiClient.ts -> src/application/types/proxyApi.ts
src/domain/ports/IProxyApiServer.ts -> src/application/types/proxyApi.ts
src/domain/ports/IProxyEventBroadcaster.ts -> src/application/types/proxyApi.ts
src/domain/ports/IProxyProcess.ts -> src/application/types/proxyConfig.ts
src/domain/ports/IProxyServer.ts -> src/application/types/proxyConfig.ts
src/domain/ports/IProxyTrafficBus.ts -> src/application/types/proxyTraffic.ts
src/domain/ports/ITokenTurnDetectionService.ts -> src/application/types/agentTracking.ts
src/domain/ports/ITrafficDecoder.ts -> src/application/types/proxyInsights.ts
src/domain/ports/ITrafficDecoder.ts -> src/application/types/proxyLog.ts
src/domain/ports/ITrafficDecoder.ts -> src/application/types/proxyTraffic.ts
src/domain/services/tokenTurnDetectionService.ts -> src/application/types/agentTracking.ts
```

This creates a two-way layer relationship rather than an inward dependency
flow. It also makes the domain ports depend on transport/application DTOs such
as `ProxyLogEntry` and `ProxyTrafficSummary`.

Recommended target state:

- Move genuinely domain-owned records into `src/domain/types` or a dedicated
  domain contracts package.
- Keep transport-specific proxy records in the application/infrastructure
  boundary and map them before entering domain use cases.
- Split broad contracts such as `AgentSessionInfo` and `ProxyTrafficSummary`
  into identity, usage, correlation, and transport records where the use case
  does not need the entire object.
- Make the domain ports consume only domain-owned contracts and stable shared
  kernel entities.

### P1-2 — The architecture gate does not enforce the documented architecture

`pnpm run check:architecture` passes for 359 TypeScript files, but the script
in [`scripts/check-architecture.mjs`](../scripts/check-architecture.mjs) has
material blind spots:

- It uses regular expressions instead of the TypeScript AST and module
  resolver.
- It validates only relative imports; package imports, path aliases, package
  exports, and some generated/bundled boundaries are outside the graph.
- It has no rule for `src/application`, `src/proxy`, `src/ui`,
  `src/modelEfficiency`, `src/github`, `src/cursor`, or `src/composition`.
- It does not forbid `src/domain -> src/application`, which is the principal
  violation found by Graphify.
- It does not forbid the two compatibility imports from
  `src/proxy/*` to `src/ui/presentation/*`.
- It does not enforce the full package boundary for Node built-ins and
  infrastructure dependencies.
- It has no unit tests or negative fixtures proving that each rule fails when a
  forbidden edge is introduced.

Graphify also found four application-to-proxy file pairs and nine UI-to-service
pairs. Some are intentional orchestration or compatibility paths, but their
allowed status must be explicit rather than inferred from the current script.

Recommended action: replace the regex checker with an AST-backed import graph
or extend it with a resolver-backed implementation, define an explicit layer
matrix, and test the checker with fixture projects containing legal and illegal
imports. The gate should fail on the domain/application cycle at the contract
level even when there is no file-level import cycle.

### P1-3 — Documentation and implementation disagree about `src/application`

[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) states that there is no
`src/application/` directory and that the former application layer was removed.
The directory currently exists and contains application services and types.
[`docs/CLEAN-ARCHITECTURE-PRINCIPLES.md`](CLEAN-ARCHITECTURE-PRINCIPLES.md)
also documents application DTOs while describing the domain as independent.

This is more than a wording issue: the stale diagram and dependency table make
it difficult to review new imports correctly. The architecture docs must be
updated together with the dependency matrix and the strengthened checker.

### P1-4 — Webview test suite is failing because test isolation is incomplete

`CI=true pnpm --dir webview test` reports 4 failed tests out of 17 in
`webview/src/components/PricesModal.test.tsx`. The failures show multiple
dialogs and repeated filter buttons from previous test cases. The setup file
imports matchers but does not register an explicit `cleanup()` after each
test, and the Vitest configuration does not enable global test cleanup.

This is a test-infrastructure defect, but it can conceal real UI regressions
and blocks the CI webview job. Add explicit cleanup in the setup file, then
run the suite repeatedly to verify deterministic behavior. Add a test that
distinguishes the active-model table from the complete model table, because
`PricesModal` intentionally receives both `models` and `enabledModels` and can
render the same model in both groups.

### P1-5 — Localization validation is red across nearly every locale

`CI=true pnpm run validate:l10n` fails for 24 of 25 non-English locale files.
Each is missing the same 18 keys, including active-conversation labels and the
webview proxy JSONL warning/help/label keys. The English bundle contains 424
keys; all affected locales contain 406.

Recommended action:

- Add the 18 keys to every locale, using an explicit fallback policy if
  translations are not immediately available.
- Add a locale-generation or extraction step so new English keys cannot be
  merged without a tracked translation/fallback decision.
- Keep `validate:l10n` in the required CI path and add a test for the fallback
  behavior.

### P1-6 — Packaging is not reproducibly green

`CI=true pnpm run build:current` reached the packaging preparation stage but
failed before VSIX verification because
`node_modules/sqlite3/build/Release/node_sqlite3.node` was missing. The build
script expects a root-level `sqlite3` binding even though the package is
provided through the Cursor SDK dependency tree in the workspace.

The same run downloaded Node 22.23.2 and attempted to fetch the Electron 140
`better-sqlite3` prebuild. The GitHub asset request failed with
`SSL_ERROR_SYSCALL`, but [`scripts/download-electron-prebuild.mjs`](../scripts/download-electron-prebuild.mjs)
used `curl | tar` without `pipefail`. Because the binding path already existed,
the script printed a success message after the failed download.

Recommended action:

- Make the prebuild download fail closed (`curl --fail --location`, no unchecked
  pipeline, checksum verification, and a temporary archive).
- Resolve the exact production dependency location for `sqlite3`; do not rely
  on a root hoist that pnpm is free to change.
- Verify both Node and Electron native bindings by ABI, not only by file
  existence.
- Run `verify:vsix` against a newly produced artifact on every supported target.
- Add a clean-room packaging job that starts from an empty package store or
  documented cache state.

## 6. Architecture and coupling hotspots

### 6.1 Graphify god nodes

After filtering obvious generic symbols, the highest-risk nodes are:

| Symbol | Graphify degree | Interpretation |
|---|---:|---|
| `ProxyManager` | 54 | Lifecycle, state, routing, persistence, tailing, and notifications converge here. |
| `ProxyTrafficSummary` | 52 | Broad DTO crossing proxy, application, domain, UI, and tests. |
| `ProfileManager` | 49 | High fan-in profile/config coordinator. |
| `IProfileManager` | 41 | Broad port used across many workflows. |
| `IProxyManager` | 38 | Port exposes lifecycle, certificates, output, tailing, and shared-proxy concerns. |
| `InstanceDetector` | 35 | OS process discovery and parsing remain coupled. |
| `AccountsPanelProvider` | 35 | Webview lifecycle and many data refresh paths converge in one provider. |
| `AgentSessionInfo` | 31 | Identity, transport correlation, token usage, and turn data are combined. |
| `AccountsPanelHandlers` | 31 | Message routing and multiple use cases share one handler object. |
| `BetterSqliteAgentTrackingRepository` | 21 | Migration, schema validation, writes, reads, aggregation, and cleanup are combined. |
| `MitmProxyServer` | 24 | Proxy transport, event handling, decoding, diagnostics, and enrichment converge. |

The largest source files are:

| File | Lines |
|---|---:|
| `src/services/proxyManager.ts` | 1,285 |
| `webview/src/components/ProfileCard.tsx` | 875 |
| `src/ui/accountsPanel.ts` | 864 |
| `webview/src/App.tsx` | 794 |
| `src/proxy/proxyInsightExtractor.ts` | 753 |
| `src/persistence/betterSqlite/betterSqliteAgentTrackingRepository.ts` | 706 |
| `src/ui/accountsPanelHandlers.ts` | 705 |
| `src/proxy/mitmProxyServer.ts` | 619 |
| `src/profiles/profileLauncher.ts` | 546 |
| `src/persistence/efficiencyDatabase.ts` | 536 |

These numbers do not mean that every large file is wrong. Composition roots,
rendering components, and schema-heavy modules can legitimately be larger.
They do indicate where future changes have the greatest regression and merge
risk.

### 6.2 Repowise refactoring signals

Repowise independently identified these high-value targets:

- `src/proxy/types.ts`: critical untested hotspot with 28 dependents.
- `webview/src/types/index.ts`: critical untested hotspot with 15 dependents.
- `packages/types/src/index.ts`: high co-change scatter across 43 files.
- `src/commands/profileCommands.ts`: critical churn risk; 90-day churn rewrote
  approximately 41.5 times the file's current NLOC.
- `src/domain/ports/IProxyManager.ts`: high co-change scatter across 97 files.
- `src/application/types/proxyTraffic.ts`: high co-change scatter across 28
  files.
- `src/auth/tokenRefresh.ts`: 30.5% line coverage.
- `src/modelEfficiency/efficiencyService.ts`: 40.9% line coverage.
- `src/ui/statusBarManager.ts`: 36.4% line coverage.
- `src/proxy/proxyDecode.ts`: 18.3% line coverage and five nesting levels.
- `src/services/proxyManager.ts`: 40.9% line coverage.
- `src/profiles/profileLauncher.ts`: 52.2% line coverage.

The previous tracking extraction reduced the `AgentTrackingService.ingestTraffic`
method from 253 lines / CCN 26 to 97 lines / CCN 13. That was a useful
directional improvement, but Repowise now identifies the coordinator's
`persist` method as the next complexity hotspot. The next extraction should be
preceded by branch-level characterization tests so policy is not moved without
making it easier to verify.

### 6.3 Repository and port design

`IProxyManager` exposes 23 concerns in one port: start/stop/restart, status,
certificates, paths, ports, shared proxy, event listeners, output channels,
and traffic tailers. This is a violation of interface segregation even though
callers receive the interface through dependency injection.

Split it into use-case-specific ports such as:

- `IProxyLifecycle` — start, stop, restart, status, running state.
- `IProxyCertificatePort` — certificate state and installation.
- `IProxyTrafficSubscription` — traffic listeners and event publication.
- `IProxyOutputPort` — output/tailer controls.
- `IProxyTopologyPort` — shared proxy and used-port coordination.

`BetterSqliteAgentTrackingRepository` is 706 lines and contains migration
startup, schema checks, command writes, aggregate queries, tree queries, and
cleanup helpers. Keep the repository as the persistence boundary, but split
read models/query objects and write models/commands before the class grows
further.

## 7. Testing and coverage assessment

The extension host has broad test coverage by file count, but risk is uneven.
There are 214 non-test TypeScript source files and 125 extension test files;
the webview has only four test files for a substantially larger UI surface.
The webview `App.tsx`, `ProfileCard.tsx`, panel message protocol, and host
bridge have limited direct behavioral coverage.

The generated `lcov.info` from the attempted coverage run reported:

| Metric | Observed |
|---|---:|
| Lines | 70.4% (18,079 / 25,691) |
| Branches | 69.1% (2,369 / 3,426) |
| Functions | 73.7% (888 / 1,205) |

The configured thresholds are only 55% lines, 45% branches, 55% functions,
so the global threshold passes when the suite completes. The gap is that a
strong global number hides critical local holes. The lowest observed modules
were:

| Module | Lines |
|---|---:|
| `src/modelEfficiency/composerDbPoller.ts` | 13.8% |
| `src/commands/registerProfileImportExportCommands.ts` | 14.5% |
| `src/proxy/proxyDecode.ts` | 18.3% |
| `src/commands/registerProfileLaunchCommands.ts` | 20.0% |
| `src/proxy/installCaCertificate.ts` | 25.6% |
| `src/auth/tokenRefresh.ts` | 30.5% |
| `src/ui/statusBarManager.ts` | 36.4% |
| `src/services/proxyManager.ts` | 40.9% |

Recommended testing policy:

- Keep the global threshold, but add module-specific thresholds for proxy
  decoding, persistence, token refresh, and security-sensitive UI/bridge code.
- Add tests for negative paths, malformed frames, cancellation, native binding
  failure, migration failure, and retry/idempotency behavior.
- Add webview tests for `App` message dispatch and host-bridge failures.
- Add a deterministic integration test for a packaged extension or at least a
  clean staged runtime tree.
- Run the full suite with loopback permissions in CI; the proxy API test cannot
  bind its test port in a restricted sandbox.

## 8. Security and privacy assessment

### Positive controls

- `repowise security scan --history --format json` found zero historical secret
  findings across 112 commits, 3,580 blobs, and 2,110 files.
- The proxy API binds to `127.0.0.1` and applies a localhost middleware.
- The API uses a JSON body limit of 256 KB.
- SQLite writes use parameterized statements according to the repository
  implementation and comments.
- The webview sets a restrictive default CSP and uses a script nonce.

### Hardening findings

1. `webview/src/index.tsx` writes an exception message into `innerHTML`. The
   message originates from startup failure handling and should be rendered as
   text or escaped before interpolation. This is not proof of an exploitable
   path, but it is unnecessary HTML injection risk in a privileged webview.
2. The host HTML bootstrap uses `innerHTML` for a localized error message. The
   strings are repository-controlled today, but text-safe DOM APIs would remove
   the assumption.
3. Proxy body capture can persist raw request/response bodies, including large
   sidecar `.bin` files. The current documentation warns about disk usage, but
   a privacy policy should define explicit opt-in, retention, deletion, and
   redaction behavior for sensitive fields and headers.
4. `ProfileLauncher` uses `shell: true` on Windows while passing profile paths
   and launch arguments. Replace this with a non-shell spawn where possible or
   implement platform-specific, tested argument escaping.
5. The localhost validator interprets `x-forwarded-for` before the socket
   address. The service is loopback-bound, which limits practical exposure,
   but the trust model should be explicit and forwarded headers should not be
   trusted unless the process is behind a known local proxy.
6. The local proxy API has no capability token. Loopback binding is a useful
   boundary, but any local process can potentially query statistics or request
   shutdown. A random per-process capability token should be considered if the
   threat model includes other local processes.

## 9. Dead-code and cleanup assessment

Repowise found 14 safe-only unused-export candidates, representing about 145
cleanup lines. Examples include `shouldFetchWebUsageSummary`,
`createDefaultMitmProxyServer`, `resolveAvailablePort`, `listProxyLogFiles`,
`redactHeadersForLog`, `MitmCapturePipeline`, and
`MultiProfileQuotaServiceError`.

Do not remove these automatically. VS Code command registration, dynamic
imports, tests, package entrypoints, and backward-compatibility re-exports can
look unused to a static graph. Each candidate should be checked against the
compiled bundle and VSIX before removal, then deleted in a small isolated
commit.

## 10. Documentation and process gaps

The repository has unusually extensive technical documentation, which is a
strength. The main problem is synchronization:

- Architecture documentation contradicts the current `src/application`
  structure.
- The architecture docs describe stronger dependency rules than the executable
  checker enforces.
- Several research documents have review dates from June 2026 even though the
  proxy and tracking implementation changed afterward.
- The remediation plan correctly records that some rollout documentation still
  mentions the old experimental SQLite flag, but this should be resolved rather
  than left as a known contradiction.
- There is no documented dependency-security exception process, SBOM output,
  or clean-room VSIX acceptance checklist in the required CI flow.
- Documentation and generated API assets are not excluded from the repository
  lint command, causing generated code to obscure source lint failures.

Recommended process improvements:

- Add `Last reviewed` dates only when the corresponding implementation and
  executable checks were reviewed together.
- Add an architecture decision record for the final domain/application contract
  ownership.
- Add a documentation link checker and a generated-artifact policy.
- Keep the audit commands in a reproducible script, excluding build outputs and
  recording tool versions.
- Require a short privacy/security review whenever proxy capture fields or
  retention behavior changes.

## 10. Post-implementation checkpoint — 2026-08-24

The approved remediation work was implemented in verified slices after this
historical audit. The current checkpoint is materially healthier than the
baseline, but it is not presented as a completed final audit.

### Verified improvements

- The extension-host suite passes 741/741 tests with loopback and temporary
  filesystem access available.
- The webview suite passes 18/18 tests with explicit DOM cleanup.
- Localization validation passes for 26 locales with 428 keys each.
- The architecture checker resolves relative imports, fails closed on
  unresolved imports, rejects domain/application violations, detects cycles,
  and passes valid, boundary, cycle, and unresolved-import fixtures across
  401 TypeScript files.
- Domain-owned proxy and tracking contracts now live under
  `src/domain/types`; application re-exports are compatibility-only.
- Proxy traffic ingress, bus, cost enrichment, health polling, and presenter
  boundaries have been moved behind focused seams.
- The local REST and WebSocket control plane requires the same per-process
  capability token, and loopback validation does not trust forwarding headers.
- Proxy headers and persisted JSON bodies redact credentials; sidecar reads
  reject traversal and symlink escapes; a confirmed VS Code command now
  deletes only known JSONL and body-sidecar files while the proxy is stopped.
- Current-target VSIX contents are checked for native bindings, SDK/runtime
  assets, and development artifacts; sanitization runs on the staged artifact
  rather than the workspace dependency tree.
- The broad proxy manager contract is now composed from lifecycle, status,
  certificate, output, routing, and traffic capabilities; the main consumers
  receive only the capability ports they use.
- Status-bar quota presentation was extracted into a tested module. The new
  presentation module reaches 98.79% line coverage in the current run, while
  the remaining manager coverage is 71.71% and remains a UI-state follow-up.
- A deterministic documentation-link gate now validates 43 Markdown files and
  corrected stale references to the former application-layer proxy ingress
  path before being added to `pnpm run audit`.
- Profile-scoped tracking service creation, SQLite repository wiring, pricing,
  turn detection, cache ownership, and initialization notifications now live
  in `ProxyAgentTrackingCoordinator`; the facade retains only the surrounding
  traffic orchestration and compatibility wrappers.
- API/JSONL mode selection, attach/restart state, and output notifications now
  live in `ProxyTrafficIngressCoordinator`; `ProxyManager` delegates ingress
  setup while retaining lifecycle ownership. The coordinator reaches 100% line
  coverage in the current run.
- Agent-traffic classification, shared/per-profile ingestion decisions, and
  persisted-usage notifications now live in
  `ProxyTrafficUsageCoordinator`; `ProxyManager` retains only presentation and
  listener dispatch at that boundary. The coordinator reaches 99.1% line and
  100% function coverage in the current run.
- Shared child-process startup, persisted ownership recovery, health polling,
  exit cleanup, and shutdown now live in
  `SharedProxyLifecycleCoordinator`; the manager supplies narrow runtime,
  process, settings, and ingress callbacks. The coordinator reaches 80.37%
  line and 85.71% function coverage.
- Per-profile attach, API shutdown, child cleanup, ingress stop, settings
  restore, and state deletion now live in
  `ProxyProfileLifecycleCoordinator`; its focused tests preserve shared and
  multi-window behavior. The coordinator reaches 77.72% line and 100% function
  coverage.
- Persisted and in-memory proxy status reconciliation now lives in
  `ProxyStatusCoordinator`; stale process and port state cleanup is covered by
  focused tests. It reaches 98.51% line and 100% function coverage, while
  `ProxyManager` reaches 71.71% line coverage after the extraction.
- Shared, persisted, in-memory, and profile fallback discovery for API/JSONL
  tailers now lives in `ProxyTrafficTailerCoordinator`; output-tail options and
  capability-token forwarding are covered by focused tests. It reaches 97.34%
  line and 100% function coverage.
- JWT subject mapping and per-profile efficiency database routing now live in
  `ProxyProfileRoutingConfiguration`; disabled profiles and malformed or
  missing auth data are covered by focused tests. It reaches 91.30% line and
  100% function coverage.
- Child process ownership cleanup, PID fallback, SIGTERM/SIGKILL escalation,
  and process detach now live in `ProxyChildProcessStopCoordinator`; it reaches
  100% line, branch, and function coverage.
- Child-process configuration assembly now lives in
  `ProxyServerConfigurationBuilder`; defaults, overrides, body-size clamping,
  and logging/diagnostics settings are covered by focused tests. It reaches
  100% line and function coverage.
- Proxy and certificate webview actions now live in
  `AccountsPanelProxyHandlers`; the general panel handler delegates lifecycle,
  certificate, log, traffic, and install-guide actions through capability
  ports. Its focused tests cover enabled/absent profiles, start/stop, guide,
  and certificate flows.
- Storage inspection and cleanup now live in `AccountsPanelStorageHandlers`;
  missing profiles, cleanup failures, and refreshed post-cleanup breakdowns
  remain covered by the existing handler tests. The extracted module reaches
  97.53% line and 100% function coverage.

### Updated Repowise and Graphify signals

Repowise and Graphify were re-run after the latest proxy, Accounts Panel,
model-efficiency, and profile-port extractions. The graph now contains 4,783
nodes and 9,633 edges; nine SQL files remain
unparsed because
the installed Graphify environment does not include `tree_sitter_sql`. The
largest remaining source-level hubs are `ProxyManager`, `ProxyTrafficSummary`,
`IProfileManager`, `ProfileDetector`, `IProfileReader`, `MultiProfileQuotaService`,
and `ProfileManager`. These are decomposition priorities, not evidence that the
graph tool's generic god-node score is itself a defect.

The Accounts Panel extraction now separates profile CRUD/import/export into
`AccountsPanelProfileHandlers` and GitHub token actions into
`AccountsPanelGithubHandlers`. Their focused tests cover successful operations,
refresh orchestration, cancellation, missing profiles, and import/export
serialization. The full extension-host checkpoint passed 785/785 tests, the
webview suite passed 18/18 tests, and the architecture gate passed for 427
TypeScript files.

The provider's read-model and refresh responsibilities now live behind
`AccountsPanelDataRefresher`, reducing `AccountsPanelProvider` to 545 lines and
Graphify degree 29. The refresher is now 341 lines, has Graphify degree 19 and
55.13% line coverage, and its direct tests cover inactive-webview
short-circuiting, initial read-model publication, secondary refresh
coordination, and proxy-state publication. The latest full extension-host
checkpoint is 785/785 tests and the architecture gate covers 427 TypeScript
files.

The remote account, GitHub, and quota refreshes now live in
`AccountsPanelBackgroundRefreshCoordinator`, which has Graphify degree 11 and
88.11% line coverage. Its direct tests cover inactive-webview short-circuiting,
account loading/projections, GitHub and quota publication, and lock release
after a failed account fetch. The provider constructs this coordinator at the
composition boundary while the data refresher remains a compatibility facade
for existing panel actions and event subscriptions.

The Accounts panel no longer depends on the broad `IProxyManager` facade for
read-only proxy data. The new `IProxyPanelRead` port exposes only status,
certificate-state, and proxy-routing reads required by the panel; Graphify
reports degree 8 for the port and the architecture gate covers 427 TypeScript
files after the change. The concrete `ProxyManager` remains the composition
root implementation through structural typing, so runtime behavior is
unchanged.

Concrete `ProfileManager` dependencies in storage, workspace, quota,
efficiency, command, and Accounts panel consumers now depend on
`IProfileManager`. This reduces the concrete `ProfileManager` Graphify hub from
degree 51 to degree 33 and keeps concrete construction at the runtime and
composition boundaries. The latest full extension-host checkpoint remains
785/785 tests with 427 TypeScript files covered by the architecture gate.

`CursorProcessScanner` now owns OS-specific Cursor process inspection and
parser dispatch. `InstanceDetector` retains profile matching, detection cache,
polling, and change notifications; it is now 276 lines with 85.14% line
coverage and Graphify degree 30. The scanner has 79.41% line coverage and
Graphify degree 11, with direct tests for injected providers, Linux/macOS
parsing, helper filtering, and Windows PowerShell-to-wmic fallback. The latest
full extension-host checkpoint passed 785/785 tests and the architecture gate
covers 427 TypeScript files.

`proxyInsightEnricher` now owns Bidi and RunSSE session/token insight enrichment,
leaving `proxyDecode` responsible for body loading, RPC type resolution, and
decode orchestration. `proxyDecode` is now 173 lines with Graphify degree 29;
the enricher has 39.52% line coverage and direct tests for completed/streaming
token projections, unchanged insights, and unsupported directions. The latest
full extension-host checkpoint passed 785/785 tests and the architecture gate
covers 427 TypeScript files.

The MITM proxy extraction now separates session correlation and traffic
enrichment into `ProxyTrafficSessionCoordinator`, reducing
`MitmProxyServer` to 541 lines and Graphify degree 19. The coordinator has
Graphify degree 15 and 96.55% line coverage; its direct tests cover model and
conversation correlation, profile/workspace enrichment, unchanged summaries,
and cleanup on shutdown. The latest full extension-host checkpoint passed
785/785 tests.

`EfficiencyAnalyzer` now delegates scheduling to `EfficiencyAnalysisQueue` and
profile/API/classification/persistence work to `EfficiencyAnalysisWorkflow`.
The queue has 100% line, branch, and function coverage and Graphify degree 10;
the workflow has 97.30% line, 93.75% branch, and 100% function coverage with
Graphify degree 7. Direct tests cover FIFO ordering, concurrency limits,
pending-item deduplication, retries, disabled windows, missing API keys,
profile conflicts, successful scoring, and event persistence. The queue also
closes a deduplication gap for work waiting for a concurrency slot.

`ComposerDbPoller` now delegates pure `BubbleRow` eligibility and
`PromptMetadata` construction to `buildPromptMetadata` in
`composerPromptMetadata.ts`. The new boundary has 100% line, branch, and
function coverage and keeps SQLite reads, watermark updates, and analyzer
scheduling in the poller. Its focused tests cover text and rich-text prompts,
timestamp fallbacks, non-user/empty/pre-enabled bubbles, and malformed
timestamps.

`EfficiencyService` activation safety now has focused coverage for consent
cancellation and missing access tokens; the service reaches 69.61% line and
73.07% branch coverage, while the complete extension-host checkpoint passes
785/785 tests.

`composerPollerState` now owns empty-state creation and bounded FIFO
deduplication for seen Composer bubbles. It has 100% line and function
coverage, 88.88% branch coverage, and direct tests for duplicate detection,
membership checks, and eviction at the configured cap. `ComposerDbPoller`
remains responsible for persistence, SQLite reads, watermark handling, and
scheduling.

Read-only proxy, quota, workspace, detection, and panel consumers now depend
on the narrower `IProfileReader` port. Profile lookup by email and user-data
path is now included in that read-only contract, allowing `ProfileDetector` and
`ProfileExporter` to avoid the full CRUD dependency. Graphify reports
`IProfileManager` at degree 55 and `IProfileReader` at degree 40, down from
degree 87 for the broad port before this migration. `IProfileManager` remains
the full CRUD contract for workflows that create, update, import, or delete
profiles.

Repowise still identifies low-coverage or high-coupling targets including
`proxyDecode`, `ProxyManager`, `efficiencyAnalyzer`, `efficiencyService`,
`composerDbPoller`, `statusBarManager`, and several broad type barrels. The
new `statusBarPresentation` module is now well covered, while the manager's
VS Code state transitions remain a separate target. It
also reports duplicate-helper candidates in `ProxyManager`, profile handling,
panel handlers, and proxy decoding. The six safe-only unused exports identified
in the previous checkpoint were removed after source and test reference review;
the current dead-code scan reports zero safe-only findings and 30 medium-
confidence cleanup candidates retained for further evidence.

### Remaining findings

The dependency advisory register is still open for transitive `tar`, `undici`,
`uuid`, and optional dependency paths. Initial local floors now protect body
redaction, loopback validation, token refresh, and log cleanup; broader floors
for orchestration and UI modules remain open. The largest orchestration and UI
hubs still require decomposition, and the complete
release-platform VSIX matrix plus installed-extension acceptance test remain
open. These items are intentionally carried forward rather than hidden by the
improved global metrics.

## 11. Prioritized remediation plan

### Phase 0 — Release blockers and deterministic validation

1. Triage and remediate the production dependency advisories. Record which
   paths are shipped and which are build-only.
2. Fix webview test cleanup and make `pnpm --dir webview test` deterministic.
3. Add the 18 locale keys or implement an explicitly tested fallback policy.
4. Exclude `.tmp/**`, `docs/api/**`, staged VSIX output, and other generated
   artifacts from ESLint; then reduce the 42 source errors to zero.
5. Repair packaging dependency resolution and make native prebuild download
   fail closed.
6. Run the full extension suite and package verification from a clean staged
   tree.

### Phase 1 — Make the architecture contract real

1. Define the authoritative layer matrix in one document and one executable
   checker.
2. Move domain-owned contracts out of `src/application/types`.
3. Map transport-specific proxy records at the application boundary.
4. Remove proxy-to-UI compatibility imports or move presenters behind an
   application/UI port.
5. Add negative architecture fixtures and enforce package/import resolution.
6. Update `ARCHITECTURE.md` and `CLEAN-ARCHITECTURE-PRINCIPLES.md` in the same
   change.

### Phase 2 — Decompose high-risk hubs behind tested seams

1. Reduce `ProxyManager` to orchestration. Extract lifecycle, state/ports,
   traffic ingress, shared-proxy coordination, and output control.
2. Split `MitmProxyServer` into transport lifecycle, stream capture, decode
   coordination, and diagnostics.
3. Split `AgentTrackingPersistenceCoordinator.persist` by event strategy after
   adding characterization tests for turn-ended, context, live delta, batch,
   and snapshot paths.
4. Split the SQLite repository into write commands, read models, and migration
   startup/validation.
5. Split `AccountsPanel` and `AccountsPanelHandlers` by use case, and move
   webview state/message handling out of the monolithic `App` component.

### Phase 3 — Raise local test confidence

1. Add focused tests for all P1/P2 modules below 55% line coverage.
2. Add critical-module coverage floors rather than relying only on the global
   threshold.
3. Add native ABI, packaged runtime, proxy API authorization, body-retention,
   and malformed-protobuf tests.
4. Add webview bridge contract tests for every host-to-webview message family.

### Phase 4 — Security and privacy hardening

1. Replace error-path `innerHTML` with text rendering.
2. Review raw body capture, redaction, sidecar path validation, retention, and
   deletion guarantees.
3. Remove Windows shell spawning or add robust platform-specific escaping tests.
4. Decide whether loopback capability tokens are required and document the
   threat model.
5. Add dependency audit and SBOM checks to CI.

### Phase 5 — Keep documentation and tooling synchronized

1. Update architecture diagrams and all stale migration references.
2. Add a single `audit` command that runs architecture, lint, tests, coverage,
   localization, dependency audit, and packaging verification with clear
   failure categories.
3. Keep Repowise/Graphify output outside Git but document the exact commands,
   versions, and graph caveats.
4. Re-run this audit after Phases 0–2 and compare hotspot, coverage, and
   boundary metrics rather than optimizing one tool score in isolation.

## 12. Definition of done for the next audit

The next audit should not be considered complete until:

- `pnpm run lint` passes without generated-artifact noise.
- `pnpm run check:architecture` passes with negative fixtures proving the
  domain/application rule.
- `pnpm test` passes deterministically with 668 or more tests and no sandbox-
  specific assumptions.
- `pnpm run test:coverage` passes with both global and critical-module floors.
- `pnpm --dir webview test` passes with all current tests isolated.
- `pnpm run validate:l10n` passes for all 26 locale files.
- `pnpm audit --prod` has no unresolved critical/high findings, or each
  exception has an owner, rationale, expiry date, and reachability analysis.
- `pnpm run build:current` produces a VSIX and `pnpm run verify:vsix` validates
  the exact native/runtime contents.
- Architecture documentation describes the actual dependency graph.
- Proxy capture privacy behavior is documented and tested.
