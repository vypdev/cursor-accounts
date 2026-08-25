# Proxy Metrics Stabilization and Improvement Plan

**Status:** In progress; implementation started after explicit user approval on 2026-08-24.

**Audit date:** 2026-08-24

**Scope:** MITM proxy, Agent traffic capture, multi-profile attribution, token/cost persistence, native SQLite, tests, quality, security, packaging, and documentation.

## 1. Objective

Build a reproducible and verifiable flow that observes Cursor usage per profile and conversation while correctly distinguishing:

- streaming activity (`token_delta`);
- context snapshots (`token_details`);
- turn usage (`turn_ended`);
- usage identifiers (`usage_uuid`);
- model-based estimated cost;
- Cursor-reported cost (`chargedCents`, `totalSpend`, or `total_cents` where applicable).

The result must work in development, in the Extension Host, in the proxy child process, and inside supported VSIX packages.

## 2. Working rules

1. This document is the reference plan. No implementation changes are made until the relevant phase and scope are approved.
2. Every change must have a hypothesis, tests, and an acceptance criterion.
3. Native runtime, persistence, UI, and documentation changes must not be mixed in one commit unless there is an explicit dependency.
4. `token_delta` estimates must not be presented as billable spend.
5. Logs, captured bodies, certificates, databases, and tokens must not be committed.
6. Cursor data and protocols can change; every external protocol or endpoint must be verified with captured traffic and current primary documentation.
7. If Node, Electron, pnpm, `better-sqlite3`, Cursor, or an external tool behaves unexpectedly, consult primary sources before deciding.

## 3. Known current state

### 3.1 Observed architecture

The current flow is:

```text
Cursor / VS Code
        |
        v
MITM proxy HTTP/1.x, HTTP/2, SSE
        |
        +--> decode protobuf / Connect frames
        |
        +--> extract insights
        |       - agent requestId
        |       - conversationId
        |       - workspaceId
        |       - model
        |       - token_delta
        |       - turn_ended
        |
        +--> shared proxy: JWT sub -> profileId
        |
        +--> Proxy API WebSocket
        |       |
        |       +--> extension host / UI / live status
        |
        +--> ProxyAgentTrackingIngress
                |
                +--> per-profile DB pool
                        |
                        +--> better-sqlite3 repository
```

Main components:

- [src/proxy/mitmProxyServer.ts](../src/proxy/mitmProxyServer.ts): capture, incremental decoding, and summary enrichment.
- [src/proxy/proxyServer.ts](../src/proxy/proxyServer.ts): child process, API, SQLite pool, and persistence ingress.
- [src/proxy/proxyAgentTrackingIngress.ts](../src/proxy/proxyAgentTrackingIngress.ts): Agent traffic filtering and routing.
- [src/proxy/jwtProfileResolver.ts](../src/proxy/jwtProfileResolver.ts): JWT `sub` to profile resolution.
- [src/services/proxyManager.ts](../src/services/proxyManager.ts): lifecycle, shared proxy, settings, and API connection.
- [src/services/agentTrackingService.ts](../src/services/agentTrackingService.ts): persistence rules and event classification.
- [src/persistence/betterSqlite/](../src/persistence/betterSqlite/): SQLite connection, pool, and repository.
- [src/application/types/agentPersistence.ts](../src/application/types/agentPersistence.ts): token, turn, and conversation data contracts.

### 3.2 Current uncommitted worktree changes

The worktree contains a broad uncommitted change set, including:

- migration from `AgentTrackingDatabase` to `better-sqlite3`;
- removal of the experimental SQLite flag;
- shared multi-profile proxy;
- JWT-based attribution;
- per-profile database pool;
- instance detection, launchers, UI, and documentation changes;
- new JWT, shared-proxy, and instance tests.

This baseline must be preserved and the changes must be separated by subsystem before implementation work starts.

### 3.3 Audit validation results

Results obtained on 2026-08-24:

| Validation | Result | Interpretation |
|---|---:|---|
| `tsc -p ./ --noEmit` | Passes | Main code type-checks on the current Node runtime. |
| `tsc -p webview --noEmit` | Passes | Webview type-checks. |
| Compilation of `packages/types`, `packages/shared`, and `src` | Passes | `out`, migrations, and protos were generated successfully. |
| Isolated proxy/tracking tests | 36/36 pass | Capture, JWT, streaming, logical tracking, and shared proxy have unit-level coverage. |
| SQLite tests | Fail to open DB | The installed binding uses Node ABI 128 while the test runtime requires ABI 127. |
| Full suite | Does not finish cleanly | There are stale mocks and watcher tests that can leave open handles. |
| ESLint on source roots | 47 errors | There is real lint debt in persistence and proxy code. |
| ESLint on the whole tree | 1,970 errors | Generated artifacts and staging are also being linted; ignores must be fixed first. |

UI tests fail, among other reasons, because mocks do not include `onDidChangeViewState` and some scenarios do not implement `profileManager.getProfile`.

### 3.8 Implementation progress

The approved implementation has completed the first stabilization slice. The
following changes are now present in the worktree:

- Native SQLite runtime selection is explicit: Node and Electron rebuild
  commands are separate, and a Node smoke test validates ABI, WAL mode,
  `busy_timeout`, and foreign keys.
- Fresh database version detection no longer queries a missing metadata table;
  schema validation includes the `agent_tokens_delta` table.
- Agent token snapshots persist the complete current schema, and old
  conversation cleanup deletes snapshots through their request IDs.
- Agent tracking ingestion is serialized per profile, independent profiles can
  progress concurrently, and shutdown flushes queued persistence before the
  database pool closes.
- UI mocks and status-bar/watchers now have the lifecycle methods required to
  terminate tests cleanly. Temporary test data is kept in permitted, isolated
  directories.
- The process parser no longer treats the Cursor executable as a workspace
  path.
- The MITM certificate manager now materializes the public CA key required by
  `http-mitm-proxy` in addition to the certificate and private key.

Validation completed during this slice:

- `CI=true pnpm run compile` passes.
- `CI=true pnpm run verify:native:node` passes on Node `v22.23.1`, ABI `127`.
- Persistence, migration, queue, attribution, certificate, and profile test
  groups pass.
- The complete compiled test suite passes and terminates naturally with
  loopback networking enabled: 668 tests passed, 0 failed.
- The canonical `CI=true pnpm test` command also passes after rebuilding the
  Node-compatible native binding.

The idempotency slice is now implemented and covered by integration tests:

- Migration 009 adds stable event keys to snapshot and `turn_ended` rows.
- A separate `agent_tokens_delta_events` ledger makes minute-bucketed live
  increments atomic and replay-safe.
- The streaming decoder propagates an event sequence scoped to the source
  stream, while the application service derives deterministic keys with
  HTTP-request and value fallbacks for older paths.
- Replayed live deltas and completed turns are verified not to change totals.

After the first architecture extraction, the canonical suite was rerun and
passed with 668 tests, 0 failures, 0 cancellations, and 0 skipped tests.

The remaining phases are reconciliation hardening, formal architecture/import
checks, security review, lint cleanup, packaging validation, and a real
installed-extension acceptance test.

The first architecture gate is now executable with `CI=true pnpm run
check:architecture`. It scans 359 TypeScript files, checks the documented
layer restrictions, and detects static relative-import cycles. It also moved
the decoder input contract out of `src/proxy/types.ts` and broke the verified
certificate-manager/install-helper cycle. The remaining architectural work is
responsibility decomposition of the Repowise hotspots.

The first tracking-service decomposition is now complete. Persistence policy
and event-key construction moved to
`src/application/services/agentTrackingPersistenceCoordinator.ts`; the
profile/conversation service is now an orchestrator. Repowise reports for
`AgentTrackingService` improved from CCN 26 and 253 lines in `ingestTraffic` to
CCN 13 and 97 lines. The new coordinator is intentionally the next extraction
candidate because its `persist` method currently has CCN 21; no further split
will be made until characterization coverage is added for each persistence
branch.

### 3.4 Confirmed blockers

#### Native runtime

The observed error is:

```text
The module ... better_sqlite3.node was compiled against a different Node.js version
using NODE_MODULE_VERSION 128. This version of Node.js requires NODE_MODULE_VERSION 127.
```

This is consistent with the official Electron documentation: native modules must be rebuilt for the Electron ABI and may not work with the system Node runtime. References:

- [Electron: Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [electron/rebuild README](https://github.com/electron/rebuild/blob/main/README.md)

#### Persistence ordering and replay safety

This was a baseline blocker. The proxy now enqueues traffic through the
per-profile tracking ingress, serializes writes for each profile, observes
rejections, and flushes the queue before the tracking database is closed.
Migration 009 additionally makes replayed token events idempotent. End-to-end
  acceptance with a packaged extension is still pending.

#### Contradictory documentation

[docs/MIGRATION-STATUS.md](MIGRATION-STATUS.md) and [docs/ROLLOUT-PLAN.md](ROLLOUT-PLAN.md) describe the SQLite migration as complete, while parts of the rollout still refer to the old experimental flag and rollback process.

### 3.5 Structural analysis performed with Repowise

On 2026-08-24, Repowise was run locally in structural, model-free mode, without sending code and without editor configuration. Installed version: `0.45.0`. Initialization analyzed 605 files, included 564, found 2,148 symbols, 3,333 nodes, 8,452 edges, 50 external dependencies, 71 Git hotspots, 4 unreachable files, and 29 apparently unused exports. The index produced 1,019 health findings, with an average score of 8.26/10.

This result is a prioritization signal, not proof of a bug. Before removing any export or file, check dynamic exports, VS Code entrypoints, registered commands, reflection, tests, and packaging.

Relevant findings for proxy and tracking:

| Area | Signal | Consequence for the plan |
|---|---|---|
| `src/proxy/mitmProxyServer.ts` | 2.1/10; 510-line god class, 18 methods; `start` has CCN 37 | Separate lifecycle, transport, decoding, correlation, and enrichment behind testable contracts. |
| `src/services/proxyManager.ts` | 1.9/10; `getStatus` and `handleTraffic` are hotspots; `handleTraffic` has CCN 22 | Reduce it to an orchestrator and extract lifecycle, routing, state, and event publication. |
| `src/services/agentTrackingService.ts` | 3.5/10; `ingestTraffic` has CCN 26 | Split classification, identity resolution, persistence-command construction, and notification. |
| `src/proxy/proxyDecode.ts` | 3.2/10; five nesting levels and duplication | Separate protocol decoding from semantic enrichment. |
| `src/proxy/proxyInsightExtractor.ts` | 2.4/10; co-changes with 30 files | Reduce dependencies and isolate extractors by signal type. |
| `src/proxy/types.ts` | 4.5/10; 30 dependents; insufficiently covered hotspot | Stabilize public contracts and avoid adding fields indiscriminately. |
| `src/proxy/installCaCertificate.ts` -> `certificateManager.ts` | Verified static cycle | Resolved with a shared `certificateConstants.ts` module; the architecture gate now passes. |
| Apparently dead code | 14 safe-only findings, approximately 145 cleanup lines | Audit every case; clean only after runtime, test, and VSIX validation. |

Repowise also reports duplication in `mitmProxyServer.ts`, `proxyDecode.ts`, `agentStreamDecode.ts`, `proxyManager.ts`, and `agentTrackingService.ts`. These duplications must be handled after behavior is fixed with tests; extracting a shared function too early could hide semantic differences between protocols.

After the first tracking extraction, Repowise was re-run on both affected
files. The repository health moved from 8.33 average / 5.32 hotspot to 8.36
average / 5.36 hotspot. This small aggregate change is expected: the goal of
the slice was to reduce the high-risk application method while preserving
behavior, not to optimize a global score.

Reproducible command, with artifact exclusions and no editor configuration:

```bash
REPOWISE_NO_SAVE_KEY=1 repowise init --no-prose --no-editor-setup \
  --no-claude-md --no-agents --no-codex --no-onboarding --no-save-key \
  --no-workspace --yes \
  -x 'node_modules/**' -x 'out/**' -x 'webview-dist/**' \
  -x '.tmp/**' -x 'docs/api/**' -x '*.vsix'
repowise health --module src/proxy --format md --refactoring-targets
repowise health --module src/services --format md --refactoring-targets
repowise dead-code --safe-only
```

The local `.repowise/` index and its results are not considered versionable artifacts by default.

### 3.6 Structural analysis performed with Graphify

On 2026-08-24, Graphify was run locally. Installed version: `0.9.48`. Extraction had to run with a single worker because parallel extraction failed in this environment with `Operation not permitted`.

Extraction result: 507 code files, 3,206 nodes, and 8,613 raw edges. The multigraph diagnostic found 0 missing endpoints, 1 self-loop, 1,157 dangling edges, and 7,456 valid candidates. Normalization left 7,386 edges. Dangling edges are not automatically treated as errors: the diagnostic cannot recover every raw producer edge, and the graph contains generated-artifact noise.

The most connected nodes relevant to the design were:

| Node | Observed connections | Architectural reading |
|---|---:|---|
| `ProxyManager` | 53 | Lifecycle, proxy, state, tracking, and API hub; primary decomposition candidate. |
| `ProxyTrafficSummary` | 52 | High fan-out boundary DTO; risk of becoming a universal contract. |
| `IProfileManager` | 41 | Cross-cutting port; check whether every consumer needs all its operations. |
| `IProxyManager` | 38 | High fan-in and high co-change port; must not keep growing without use-case-specific ports. |
| `AgentTrackingService` | 28 | Application service with too much ingestion responsibility. |
| `IProxyRepository` | 26 | Existing persistence boundary worth preserving. |
| `EfficiencyService` | 26 | Cross-cutting dependency that must remain outside the tracking domain. |
| `MitmProxyServer` | 24 | Transport/capture component with concentrated responsibilities. |

Graphify explanations confirm that `BetterSqliteAgentTrackingRepository` implements `IAgentTrackingRepository`, and that the factory/pool are its infrastructure consumers. This is a useful foundation: the domain must not import `better-sqlite3`, and the proxy must not know concrete tables.

The broad graph query was noisy, and the call-path query was not reliable enough to prove a complete runtime path. In addition, 8 SQL files were not processed because `tree_sitter_sql` was unavailable, and generated distribution nodes appeared under `packages/*/dist`. Graphify will therefore be used to discover hubs, dependencies, and blast radius, while architecture rules will be validated with imports, architecture tests, and real execution.

Reproducible command, writing outside the repository:

```bash
graphify extract . --code-only --out /private/tmp/cursor-accounts-graphify --no-cluster --max-workers 1
graphify god-nodes --top 25 --graph /private/tmp/cursor-accounts-graphify/graphify-out/graph.json
graphify diagnose multigraph --json --graph /private/tmp/cursor-accounts-graphify/graphify-out/graph.json
graphify explain "ProxyManager" --graph /private/tmp/cursor-accounts-graphify/graphify-out/graph.json
graphify explain "IProxyManager" --graph /private/tmp/cursor-accounts-graphify/graphify-out/graph.json
graphify explain "AgentTrackingService" --graph /private/tmp/cursor-accounts-graphify/graphify-out/graph.json
graphify explain "BetterSqliteAgentTrackingRepository" --graph /private/tmp/cursor-accounts-graphify/graphify-out/graph.json
```

Before using Graphify as a gate, repeat extraction with explicit exclusions for `out`, `webview-dist`, `.tmp`, staging, and `packages/*/dist`, and decide whether to install a SQL parser. Record the version, commit, configuration, and output path for that run.

Follow-up extraction completed on 2026-08-24 with Graphify `0.9.48`,
`--code-only`, `--no-cluster`, and `--max-workers 1`, writing outside the
repository to `/private/tmp/cursor-accounts-graphify-current`. It found 513
code files, 3,248 nodes, and 8,692 raw edges. The multigraph diagnostic found
1,165 dangling edges, one self-loop, and 7,527 valid candidate edges. The
largest relevant nodes remain `ProxyTrafficSummary` (56), `ProxyManager`
(54), and `AgentSessionInfo` (36). Nine SQL files still contributed nothing
because `tree_sitter_sql` is not installed; this remains a tooling limitation,
not a code-quality failure.

### 3.7 Clean Architecture implications

The target architecture is defined as a dependency rule, not as an aesthetic folder layout:

```text
UI / VS Code / CLI
        ↓ uses
Application / use cases / orchestrators
        ↓ depends on ports
Domain / value objects / attribution and metric rules
        ↑ implemented by
Infrastructure / SQLite / HTTP / WebSocket / filesystem / MITM
```

Rules to verify before considering each phase complete:

1. `src/domain` must not import UI, VS Code, `better-sqlite3`, filesystem, HTTP, WebSocket, or concrete infrastructure classes.
2. Domain/application ports express required capabilities and data; they must not expose SQLite tables, sockets, `IncomingMessage`, or Cursor-specific DTOs.
3. The proxy captures and normalizes signals; it does not own persistence policy or calculate authoritative cost by itself.
4. Application code coordinates use cases through ports; the composition root is the only place that assembles concrete adapters.
5. `BetterSqliteAgentTrackingRepository` remains behind `IAgentTrackingRepository`; migrations and pragmas remain infrastructure concerns.
6. `IProxyManager` must not grow to solve every consumer's needs. Evaluate use-case-specific ports such as `IProxyLifecycle`, `IProxyTrafficReader`, and `IProxyControl`.
7. Treat `ProxyTrafficSummary` as a versioned boundary contract, or split it into narrower events (`ProxyTrafficEvent`, `AgentUsageEvent`, `ProxyDiagnosticsEvent`) if consumer analysis justifies it.
8. No import cycles may remain between layers. The possible certificate cycle must be confirmed with an import graph and actual module resolution.
9. Every god-service extraction must first preserve the observable contract and add characterization tests; refactoring must not change attribution or billing semantics.

These rules are now automated by `scripts/check-architecture.mjs`, exposed as
`pnpm run check:architecture`. The current gate uses the TypeScript AST and
module resolver, excludes test/generated output from the production graph,
scans 282 production TypeScript files, and passes with no boundary violations
or static import cycles. Its independent negative fixtures run through
`pnpm run test:architecture`.

## 4. Questions to resolve before implementation

These questions must not be answered by intuition:

1. Should SQLite tests run against Node 22, the VS Code Electron runtime, or both?
2. Does the `proxyServer` child process always run with the extension's embedded Node, or can it run with another runtime?
3. Should `cursor-accounts-efficiency.db` continue sharing the historical efficiency schema, or should Agent tracking use a separate database?
4. Is the cost objective approximate observability, billing reconciliation, or both?
5. Should there be an active `get-filtered-usage-events` integration, or only offline reconciliation tools?
6. May protobuf bodies be stored locally during investigation mode, or must metadata-only mode be the default?
7. Must the shared proxy support profiles being added or removed while it is running?
8. What is the expected behavior when an event cannot be attributed to a profile?
9. Should per-profile proxy mode be retained alongside the shared proxy?
10. Is any Repowise/Graphify report approved for versioning, or must all reports remain outside the repository?

Until these questions are answered, the plan uses conservative defaults and marks the decisions as pending.

## 5. Phased plan

### Phase 0 — Baseline and worktree separation

### Objective

Create a reproducible baseline before changing behavior.

### Work

- Create a work branch.
- Record `git status`, `git diff --stat`, and the base commit.
- Classify uncommitted changes by subsystem.
- Save compilation, test, lint, and build outputs.
- Confirm that generated artifacts and sensitive data are not part of the diff.
- Add an inventory of automatically generated files where appropriate.

### Acceptance criteria

- The initial state can be restored without losing user changes.
- Every change group has a file list and purpose.
- Baseline validations are stored in this document or in a CI artifact.

### Phase 1 — Native runtime and installation pipeline

### Objective

Ensure that `better-sqlite3` and every other native module is built and tested for the correct runtime.

### Work

- Identify and document:
  - development Node version;
  - test Node version;
  - VS Code/Cursor Electron version;
  - ABI for each runtime;
  - platform and architecture targets.
- Separate commands for:
  - rebuild for Node/tests;
  - rebuild for Electron/VSIX;
  - module-load validation.
- Review `scripts/rebuild-native-modules.mjs`.
- Review `scripts/build.mjs` and `scripts/download-electron-prebuild.mjs`.
- Configure allowed pnpm build scripts explicitly.
- Ensure `pnpm install` cannot leave a partially prepared environment without a clear failure.
- Add a smoke test that opens a DB and checks `journal_mode`, `busy_timeout`, and `foreign_keys`.
- Verify the module in Node, Extension Host, proxy child, and VSIX.

### Do not do yet

- Do not change the `better-sqlite3` version without comparing Node and Electron compatibility.
- Do not assume an Electron binding works for Node tests.
- Do not use a binding for another architecture merely because the file exists.

### Acceptance criteria

- `pnpm install --frozen-lockfile` is reproducible.
- The test runtime loads its correct binding.
- The Extension Host loads its correct binding.
- The proxy child loads its correct binding.
- VSIX verification detects incompatible ABI, platform, and architecture.

### Phase 2 — Test suite and resource lifecycle

### Objective

Make the full suite deterministic, prevent open watchers, and distinguish environment failures from functional failures.

### Work

- Create shared VS Code and Webview mock factories.
- Add every production method used by mocks, including:
  - `onDidChangeViewState`;
  - `onDidDispose`;
  - `profileManager.getProfile`;
  - proxy manager methods.
- Replace real watchers with fakes where the operating system is not under test.
- Guarantee `dispose` in every `afterEach`.
- Separate unit, SQLite integration, proxy integration, and packaging suites.
- Add open-handle detection.
- Run suites with controlled concurrency.

### Acceptance criteria

- The suite terminates with a deterministic exit code.
- No project-owned `EMFILE` errors occur.
- No tests hang.
- Mocks fail with typed errors when a contract is missing.
- UI and shared-proxy tests pass independently of execution order.

### Phase 3 — Persistence queue, retries, and shutdown

### Objective

Ensure that events are not silently lost and that required ordering is preserved.

### Design to evaluate

- One global FIFO queue or queues by `profileId`/`requestId`.
- Parallelism across profiles without unsafe parallelism within one session.
- Retries only for transient errors.
- Idempotency before enabling retries.
- Flush on process shutdown.
- Maximum queue size and degradation strategy.

### Work

- Replace `void ingest()` with an explicit dispatcher.
- Return an enqueue result and a persistence result.
- Record errors and discarded events.
- Drain before closing the pool, API, and proxy.
- Add tests for:
  - ordering;
  - concurrent events;
  - database errors;
  - retry;
  - shutdown during streaming;
  - profile isolation.

### Acceptance criteria

- No persistence promise remains unobserved.
- Shutdown does not close a connection with pending operations.
- A failure in one profile does not stop ingestion for other profiles.
- Every received event reaches a terminal state: persisted, discarded with a reason, or retried.

### Phase 4 — Idempotency and data model

### Objective

Prevent duplicates and represent each signal class correctly.

### Work

- Audit current migrations and tables.
- Define deduplication keys for:
  - `turn_ended`;
  - `usage_uuid`;
  - `httpRequestId`;
  - `requestId` plus turn;
  - `token_delta` buckets.
- Add constraints and indexes where appropriate.
- Add token/cost authority and source:
  - `streaming_delta`;
  - `context_snapshot`;
  - `turn_ended`;
  - `dashboard`;
  - `period_delta`.
- Distinguish estimated cost from authoritative cost.
- Define behavior for partial and out-of-order data.
- Review retention, deletion, and migration of existing data.

### Acceptance criteria

- Reprocessing the same event does not duplicate data.
- Queries distinguish observed tokens from billable tokens.
- Migrations are forward-only, verifiable, and tested against an existing DB.
- The origin of every displayed number can be reconstructed.

### Phase 5 — Multi-profile and conversation attribution

### Objective

Assign every event to the correct profile and conversation, including subagents and out-of-order events.

### Work

- Review JWT `sub` to `profileId` mapping.
- Define refresh behavior when profiles, tokens, or sessions change.
- Add TTL and cleanup to `requestId` caches.
- Resolve precedence among IDs found in JWT, protobuf, summary, and local state.
- Add attribution source and confidence.
- Test:
  - two profiles on the same proxy;
  - two simultaneous conversations;
  - parallel subagents;
  - first event without a conversation;
  - renewed token;
  - profile removed during a session;
  - unattributable traffic.

### Acceptance criteria

- No event is ultimately attributed to the `shared` runtime.
- Unattributable events are diagnosed rather than lost.
- Subagents can be related to their parent without mixing profiles.
- Mapping updates do not require an unnecessary proxy restart.

### Phase 6 — Metrics and reconciliation with Cursor

### Objective

Separate local observability from actual billing.

### Work

- Define the metrics contract:
  - live tokens;
  - turn tokens;
  - cache read/write;
  - estimated cost;
  - server-reported cost;
  - dashboard cost;
  - confidence and source.
- Implement or retain an offline reconciliation tool.
- If `get-filtered-usage-events` is added, define:
  - authentication;
  - pagination;
  - time windows;
  - rate limits;
  - API-change handling;
  - privacy.
- Compare controlled sessions against:
  - `turn_ended`;
  - `usage_uuid`/`GetTokenUsage` where available;
  - `chargedCents`;
  - `totalSpend` delta.
- Label the UI so that estimates are not called actual spend.

### Acceptance criteria

- There is at least one reproducible reconciliation report.
- Known differences are documented.
- Subagent metrics can be aggregated without double counting.
- The UI displays cost source and authority.

### Phase 7 — Security, privacy, and operations

### Objective

Prevent accidental exposure of credentials, prompts, code, or sensitive traffic.

### Work

- Audit stored headers and bodies.
- Verify sanitization of `Authorization`, cookies, and tokens.
- Add or confirm metadata-only mode.
- Review permissions for logs, CA, DB, and state files.
- Review body limits, spill files, rotation, and cleanup.
- Confirm that REST/WebSocket APIs listen only on loopback.
- Review shutdown and control endpoints.
- Document what is stored, for how long, and how it is deleted.
- Test certificates and trust stores on macOS, Windows, and Linux.

### Acceptance criteria

- An automated test proves secrets do not reach JSONL or the UI.
- Bodies are not stored unless explicit investigation configuration enables them.
- Local files have reasonable permissions.
- The control API is not reachable through external interfaces.

### Phase 8 — Lint, architecture, and documentation

### Objective

Reduce technical debt without hiding errors in generated artifacts.

Architectural quality is measured against the Clean Architecture rules in section 3.7. Repowise and Graphify discover hotspots and dependencies, but they do not replace automated rules or contract review.

### Work

- Adjust ESLint ignores to exclude:
  - `out`;
  - `webview-dist`;
  - `.tmp`;
  - generated `docs/api`;
  - VSIX staging;
  - dependencies.
- Then fix source errors by group:
  - SQLite;
  - proxy;
  - services;
  - tests;
  - webview.
- Review type imports, unnecessary `async`, `unknown`, async callbacks, and assertions.
- Add an architecture gate checking allowed layers, no cycles, and concrete adapters assembled only in the composition root.
- Progressively reduce the identified hubs, starting with `ProxyManager`, `MitmProxyServer`, and `AgentTrackingService`, without a big-bang refactor.
- Review `ProxyTrafficSummary` and `IProxyManager` as high fan-out contracts before adding fields or methods.
- Synchronize:
  - `ARCHITECTURE.md`;
  - `MIGRATION-STATUS.md`;
  - `ROLLOUT-PLAN.md`;
  - `BUILD.md`;
  - `SHARED-PROXY.md`;
  - `TOKENS-AND-USAGE.md`.
- Remove references to the old SQLite flag if it no longer exists.

### Acceptance criteria

- `eslint src packages webview` passes.
- `eslint .` does not lint generated builds.
- Documentation describes current code rather than the old historical rollout.
- Important decisions have an ADR or a decision section.
- Architecture checks pass with no forbidden imports or cycles.

### Phase 9 — Build, VSIX, and multi-platform validation

### Objective

Prove that development behavior also exists in the installable artifact.

### Work

- Run a clean build for the current target.
- Verify VSIX contents:
  - extension bundle;
  - webview;
  - `better-sqlite3`;
  - `sqlite3` if still required;
  - protos;
  - migrations;
  - SDK and runtime dependencies.
- Test installation on at least:
  - macOS arm64;
  - one Linux or Windows target.
- Verify proxy child, Extension Host, and persistence from a real installation.
- Add a post-packaging smoke test.

### Acceptance criteria

- `build:clean:current` completes successfully.
- `verify:vsix` detects files and bindings.
- The installed VSIX can start the proxy, capture traffic, and persist data.
- The tested target matrix is recorded.

### Phase 10 — Repowise and Graphify as complementary analysis

This phase is not a final phase: it is a diagnostic gate before implementation and a regression analysis repeated after phases 3, 5, and 8.

Verified on 2026-08-24:

- Repowise `0.45.0` is available at `/Users/efrain.espada@feverup.com/.local/bin/repowise`.
- Graphify `0.9.48` is available at `/Users/efrain.espada@feverup.com/.local/bin/graphify`.
- Repowise ran locally in structural/model-free mode, without editor wiring.
- Graphify wrote its graph outside the repository; extraction used `--max-workers 1` because of an environment restriction.

Mandatory work for this phase:

1. Preserve the baseline from sections 3.5 and 3.6 with version, commit, exclusions, command, and output path.
2. Repeat Graphify with generated-artifact exclusions to remove `packages/*/dist` nodes and compare graph size.
3. Manually confirm the possible `installCaCertificate.ts` -> `certificateManager.ts` cycle.
4. Convert section 3.7 rules into reproducible import/cycle checks.
5. Use scores only to prioritize work: acceptance depends on behavior, relevant coverage, stable contracts, and allowed dependencies.
6. Re-run both analyses after each decomposition of `ProxyManager`, `MitmProxyServer`, or `AgentTrackingService`, recording whether CCN, fan-out, and blast radius decrease without increasing duplication or coupling.

Code will not be removed solely because Repowise marks it as dead. Each candidate must pass checks for entrypoints, dynamic exports, registered commands, tests, `package.json`, bundle, and VSIX.

Known limitations that must be included in every analysis report:

- parallelism may fail in this environment and require one worker;
- Graphify did not process SQL in the first extraction because `tree_sitter_sql` was unavailable;
- dangling edges and generic nodes are not violations by themselves;
- broad graph queries may include generated code and produce noisy results;
- Repowise detects statistical risk and duplication but does not know billing semantics or dynamic entrypoints by itself.

## 6. Recommended execution order

1. Phase 0: baseline and worktree separation.
2. Phase 10: structural analysis and Clean Architecture gate.
3. Phase 1: native runtime.
4. Phase 2: reliable suite.
5. Phase 3: queue and shutdown.
6. Phase 4: idempotency and data model.
7. Phase 5: attribution.
8. Phase 6: cost reconciliation.
9. Phase 7: security.
10. Phase 8: lint, architecture, and documentation.
11. Phase 9: VSIX and multi-platform validation.
12. Repeat Phase 10 after phases 3, 5, and 8 to detect structural regressions.

Do not start with an aesthetic refactor or UI expansion: runtime, persistence, and metric semantics must be reliable first.

## 7. Definition of done

The work is complete when:

- the extension and webview compile;
- the full test suite terminates without hanging;
- SQLite passes with the correct runtime;
- persistence is ordered, idempotent, and observable;
- the shared proxy attributes profiles and conversations correctly;
- estimated and actual cost are separated;
- reconciliation with Cursor data exists;
- secrets and bodies are not exposed by default;
- lint and documentation are aligned;
- the VSIX works on the committed target matrix;
- there is a real two-profile test and, if possible, parallel subagent coverage.

## 8. Decision log

| ID | Decision | Status | Owner | Evidence |
|---|---|---|---|---|
| D-001 | `better-sqlite3` will be the sole Agent Tracking backend | Adopted; Node smoke test passes, Electron rebuild remains to be validated in packaging | — | Current code and documentation |
| D-002 | Shared proxy is the primary multi-profile mode | Pending operational validation | — | `SHARED-PROXY.md` |
| D-003 | Server-provided `turn_ended` is billing-grade | To confirm with real traffic | — | `TOKENS-AND-USAGE.md` |
| D-004 | `token_delta` is a live signal, not billable spend | Adopted | — | `TOKENS-AND-USAGE.md` |
| D-005 | Ingestion needs a queue and shutdown flush | Implemented for per-profile ingress; end-to-end packaging validation remains | — | `proxyAgentTrackingIngress.ts`, `proxyServer.ts` |
| D-006 | SQLite tests must cover Node and Electron | Node validation implemented; Electron validation remains in packaging phase | — | Native runtime scripts and smoke test |
| D-007 | Repowise/Graphify are local diagnostics, not the sole gate | Adopted for this plan | — | Sections 3.5, 3.6, and 3.7 |
| D-008 | Architecture is validated with dependency rules as well as scores | Adopted; executable import and cycle gate now passes | — | `scripts/check-architecture.mjs` |
| D-009 | `ProxyManager`, `MitmProxyServer`, and `AgentTrackingService` are refactored incrementally | In progress; tracking orchestrator extracted, coordinator and proxy hotspots remain | — | Repowise/Graphify hotspots |

## 9. Open questions and blockers

| Date | Question/blocker | Required action | Status |
|---|---|---|---|
| 2026-08-24 | Node ABI 128 vs 127 binding | Separate Node/Electron rebuilds and test both | Node side closed; Electron packaging validation open |
| 2026-08-24 | `trackingIngress.ingest()` without await/queue | Design dispatcher with flush | Implemented; end-to-end acceptance open |
| 2026-08-24 | Incomplete UI mocks | Create typed factories | Stabilized for current suite; broader typed-factory cleanup open |
| 2026-08-24 | Watchers destabilize the suite | Inject watchers and close handles | Current suite terminates; broader lifecycle audit open |
| 2026-08-24 | ESLint analyzes generated artifacts | Fix ignores before measuring real debt | Open |
| 2026-08-24 | Graphify includes `dist` artifacts and does not process SQL | Repeat with exclusions/parser and compare results | Open |
| 2026-08-24 | Possible CA installation/certificate-management cycle | Validate import graph and real module loading | Closed; cycle removed and architecture gate passes |
| 2026-08-24 | `ProxyManager`/`MitmProxyServer`/`AgentTrackingService` concentrate responsibilities | Characterize contracts and split by use case | Open |

## 10. External sources consulted

- [Electron — Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules): ABI incompatibility between Node and Electron and the need to rebuild native modules.
- [electron/rebuild](https://github.com/electron/rebuild): rebuild purpose, options, and platform/architecture limitations.
- [Repowise documentation](https://docs.repowise.dev/): indexing layers and documented local operation.
- [Graphify documentation](https://graphify.com/docs): installation, graph generation, and documented local operation.
- [Graphify concepts](https://graphify.com/concepts): nodes, edges, and graph traversal semantics.

Re-verify external references if time passes before implementing the corresponding phase, especially versions, commands, and runtime compatibility.
