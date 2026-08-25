# Master Remediation Plan — Cursor Accounts

## 1. Purpose

This is the implementation plan derived from
[`ARCHITECTURE-AUDIT-2026-08-24.md`](ARCHITECTURE-AUDIT-2026-08-24.md). Its
objective is to bring the repository to a maintainable, testable, secure, and
strictly enforced Clean Architecture state while preserving the extension's
current behavior.

The plan is intentionally broader than a proxy refactor. It covers the whole
repository:

- dependency direction and architectural boundaries;
- large and highly coupled modules;
- persistence, proxy, profiles, commands, model efficiency, UI, and webview;
- testing strategy and local coverage floors;
- security, privacy, dependency advisories, and secret handling;
- localization, documentation, CI, and developer tooling;
- native modules, platform packaging, and installed-extension acceptance.

The target is not to optimize a Repowise or Graphify score. The target is to
make responsibilities explicit, dependencies verifiable, behavior protected by
tests, and releases reproducible.

## 2. Execution status and execution rule

The plan was approved for implementation by the repository owner on
2026-08-24. Implementation is proceeding in small, verified slices on the
working branch. This document remains the source of truth for scope, gates,
decisions, and outstanding work.

Completed slices are recorded below so the plan cannot drift from the code.

### Implementation log

- **Baseline and release blockers:** webview test isolation, localization key
  parity, source lint/type errors, native dependency discovery, and current
  platform packaging were repaired and verified.
- **Architecture enforcement:** the checker now resolves existing imports,
  enforces domain/application/proxy boundaries, detects cycles, and is covered
  by valid, invalid-boundary, and invalid-cycle fixtures. It is a CI gate.
- **Contract ownership:** cross-layer proxy and tracking contracts were moved
  under `src/domain/types`, with compatibility re-exports retained at the
  application boundary. Proxy adapters and the traffic bus now live under
  `src/proxy`.
- **UI dependency inversion:** proxy orchestration consumes presenter ports;
  VS Code presenters are injected by the composition root.
- **Capability-oriented proxy contracts:** the broad proxy manager contract is
  now composed from lifecycle, status, certificate, output, routing, and
  traffic capabilities. Commands, profile launching, account panels, and
  certificate export receive only the capabilities they use.
- **Status-bar decomposition:** quota text, tooltip Markdown, progress
  thresholds, and usage-mode selection now live in a tested presentation
  module; the manager retains VS Code state and rendering responsibilities.
- **Proxy tracking decomposition:** profile-scoped tracking service creation,
  SQLite repository wiring, pricing, turn detection, cache ownership, and
  initialization notifications now live in `ProxyAgentTrackingCoordinator`;
  `ProxyManager` retains a compatibility facade for traffic orchestration.
- **Ingress decomposition:** API/JSONL mode selection, attach/restart state,
  and output notifications now live in `ProxyTrafficIngressCoordinator`;
  `ProxyManager` delegates ingress setup while retaining lifecycle ownership.
- **Security hardening started:** webview error rendering is text-safe, Windows
  process launch no longer enables `shell`, loopback validation ignores
  spoofable forwarding headers, persisted proxy headers redact credentials,
  sidecar paths are constrained to the log directory, the local API uses a
  per-process capability token for REST and WebSocket access, and child-process
  proxy configuration is validated before startup.
- **Privacy controls:** proxy capture now has a confirmed VS Code command for
  deleting known JSONL and spilled-body files. The operation refuses to run
  while a managed proxy runtime is active, preserves unrelated files, and is
  covered by filesystem tests. Retention policy and rotated/backup-file review
  remain explicit follow-up work.
- **Sidecar safety:** spill filenames are restricted to safe single-component
  names at write time, and log cleanup only removes generated `.bin` sidecars;
  traversal, symlink, and unrelated-file cases are covered by tests.
- **Evidence-backed cleanup:** the six Repowise safe-only unused exports were
  removed after source and test reference review. The current scan reports no
  safe-only findings; medium-confidence candidates remain deliberately
  retained until runtime and public-contract evidence is complete.
- **Reproducible audit:** `pnpm run audit` now executes lint/type checks,
  architecture fixtures, localization, documentation-link validation,
  extension coverage floors, webview tests, and exact VSIX verification in one
  ordered command.
- **Critical coverage floors:** the coverage gate now enforces staged local
  floors for body redaction, loopback validation, token refresh, and proxy-log
  cleanup in addition to the global thresholds.
- **Deterministic tooling:** VSIX verification now selects the latest artifact
  by default or an explicit `VSIX_FILE`, rather than failing on stale artifacts
  left by previous builds. The proxy child entrypoint is import-safe for tests,
  and the architecture checker fails closed on unresolved relative imports.

Outstanding work remains in the broad module decomposition, retention policy,
dependency advisory triage, broader critical-module coverage floors,
documentation checks, and final packaging/audit gates.

When execution starts, every implementation change must follow this protocol:

1. Work on a dedicated branch from the approved baseline.
2. Create a small task slice with a stated behavior contract and verification
   commands.
3. Characterize existing behavior before changing a high-risk module.
4. Make one coherent change at a time.
5. Run the smallest relevant tests, then the required repository gates.
6. Update the relevant English documentation in the same slice.
7. Record any deliberate deviation in an ADR or decision log.
8. Do not remove compatibility exports, migrations, or runtime artifacts until
   tests and packaging checks prove that they are not required.

No broad rewrite, speculative abstraction, dependency override, or automatic
dead-code deletion is allowed without the evidence and gates described below.

## 3. Current baseline and target state

### 3.1 Current baseline

The audit baseline is commit `9a116cf` on branch
`feature/3-mitm-proxy`, observed on 2026-08-24. That historical baseline had:

- a passing extension-host test suite of 668 tests when loopback access is
  available;
- passing TypeScript compilation, type synchronization, Node SQLite runtime
  verification, and the current architecture script;
- global coverage above configured thresholds but important local coverage
  holes;
- a failing webview test command due to DOM leakage between tests;
- failing localization validation in 24 non-English locales;
- 42 source-scoped ESLint errors, hidden by 1,971 repository-wide errors from
  generated output and documentation assets;
- unresolved production dependency advisories, including one critical and
  multiple high advisories;
- a failing current-platform packaging pipeline;
- real domain/application dependency violations that the current architecture
  checker does not detect;
- large, highly coupled hubs such as `ProxyManager`, `AccountsPanel`,
  `MitmProxyServer`, and the SQLite repository.

The implementation state after the completed slices is tracked separately from
that historical baseline:

- the latest full extension-host checkpoint passed 768 tests;
- the webview suite has 18 passing tests;
- localization has 26 locales with 428 keys each;
- the architecture gate checks 417 TypeScript files, with valid, boundary,
  cycle, and unresolved-import fixtures passing;
- current-target packaging produced and verified
  `cursor-accounts-darwin-arm64-0.1.34.vsix`; stale artifacts are excluded by
  default from `verify:vsix`, and post-packaging sanitization removes
  dependency documentation/test artifacts without mutating the workspace;
- `body-parser` and `protobufjs` advisory paths were addressed, while the
  remaining dependency paths are recorded in
  [`DEPENDENCY-ADVISORY-REGISTER.md`](DEPENDENCY-ADVISORY-REGISTER.md).
- `pnpm run audit` passes after the latest Accounts Panel handler extraction;
  the current-target VSIX was rebuilt, sanitized, and verified again.
- Documentation validation covers 43 Markdown files and caught stale links to
  the former application-layer proxy ingress path before the gate was enabled.
- Graphify was refreshed after the latest proxy and Accounts Panel extractions;
  the graph now contains 4,748 nodes and 11,116 edges. Repowise reports zero safe-only dead-code
  findings; its 30 medium-confidence candidates remain retained pending
  runtime/public-contract evidence.
- `ProxyTrafficUsageCoordinator` now owns agent-traffic classification,
  shared/per-profile ingestion decisions, and persisted-usage notifications;
  its focused tests pass and coverage is 99.1% lines / 100% functions.
- `SharedProxyStateStore` now owns the shared-runtime state file's read, write,
  and idempotent clear behavior; its tests cover private-file persistence,
  malformed/absent state, and repeated cleanup.
- `SharedProxyLifecycleCoordinator` now owns shared child startup, persisted
  ownership recovery, health polling, exit cleanup, and shutdown. Its focused
  lifecycle tests pass; `ProxyManager` remains a compatibility facade with
  configuration assembly, status, routing, and cleanup seams delegated.
- `ProxyProfileLifecycleCoordinator` now owns per-profile attach, API shutdown,
  child cleanup, ingress stop, settings restore, and state deletion. Its
  focused tests preserve shared and multi-window behavior.
- `ProxyStatusCoordinator` now owns persisted/in-memory status reconciliation,
  liveness checks, and stale-state cleanup. Its focused tests cover unknown
  profiles, shared state, local runtimes, dead processes, and unavailable ports.
- `ProxyTrafficTailerCoordinator` now owns output-tail and traffic-tail
  discovery across shared runtime, persisted shared state, in-memory profile
  runtime, and profile-status fallbacks. Its focused tests cover each route and
  option/token forwarding.
- `ProxyProfileRoutingConfiguration` now owns JWT subject mapping and
  per-profile efficiency database routing for shared proxy configuration. Its
  focused tests cover disabled profiles, missing auth, malformed JWT data, and
  namespaced subjects.
- `ProxyChildProcessStopCoordinator` now owns child ownership cleanup, PID
  fallback, SIGTERM/SIGKILL escalation, and process detach. Its focused tests
  cover absent runtimes, persisted PIDs, escalation, and clean termination.
- `ProxyServerConfigurationBuilder` now owns child-process configuration
  assembly, defaults, overrides, body-size clamping, and diagnostics/logging
  settings. Its focused tests cover the complete configuration shape.
- `AccountsPanelProfileHandlers` now owns profile CRUD, proxy-aware profile
  edits, and panel import/export messaging. Its focused tests cover creation,
  deletion, export serialization, and successful import refresh behavior.
- `AccountsPanelGithubHandlers` now owns per-profile GitHub token selection and
  removal. Its focused tests cover successful selection, cancellation, missing
  profiles, and clearing an existing token.
- `AccountsPanelDataRefresher` now owns panel read-model assembly, open-workspace
  state, proxy status, and live panel publications. Its focused tests cover
  inactive webviews, initial read-model publication, secondary refresh
  coordination, and empty proxy state; it is now 341 lines with 55.13% line
  coverage.
- `AccountsPanelBackgroundRefreshCoordinator` now owns remote account, GitHub,
  and quota refreshes, including loading state and per-source concurrency
  guards. Its focused tests cover inactive webviews, account projections,
  GitHub/quota publication, and lock release after failures; it reaches
  88.11% line coverage and Graphify degree 11.
- `IProxyPanelRead` now gives the Accounts panel a five-method read port for
  status, certificate state, and proxy routing. `AccountsPanelDataRefresher`
  no longer depends on the broad `IProxyManager` facade; Graphify gives the
  new port degree 8.
- `CursorProcessScanner` now owns platform-specific process inspection and
  parser dispatch; `InstanceDetector` retains profile matching, cached state,
  polling, and notifications. Its focused cross-platform tests cover injected
  providers, Linux/macOS parsing, and Windows PowerShell-to-wmic fallback.
  `InstanceDetector` is now 276 lines with 85.14% line coverage, while the
  scanner has 79.41% line coverage and Graphify degree 11.
- `ProxyTrafficSessionCoordinator` now owns model/conversation/profile session
  correlation, JWT profile enrichment, and traffic dispatch. Its focused tests
  cover correlation, enrichment, unchanged summaries, and state cleanup; it
  reaches 96.55% line coverage.
- `AccountsPanelProxyHandlers` now owns proxy and certificate webview actions;
  the general panel handler delegates through capability-oriented ports. Its
  focused tests cover profile guards, start/stop, install-guide, and certificate
  result flows.
- `AccountsPanelStorageHandlers` now owns storage inspection and cleanup
  actions; missing profiles, cleanup failures, and refreshed post-cleanup
  breakdowns remain covered by the existing handler tests.

### 3.2 Target state

The project is considered remediated when:

- the dependency graph follows one documented inward direction;
- domain code owns its contracts and has no dependency on application,
  infrastructure, UI, VS Code, proxy libraries, or Node-specific adapters;
- application use cases depend on domain contracts and ports, not on UI or
  concrete infrastructure;
- infrastructure and interface adapters implement ports and map external
  representations at explicit boundaries;
- composition is centralized and the composition root is the only place that
  constructs concrete implementations across layers;
- the large hubs are orchestration facades with focused collaborators;
- every critical behavior has deterministic unit, integration, or acceptance
  coverage;
- security and privacy behavior is explicit, bounded, and tested;
- dependency and packaging checks are reproducible in clean CI environments;
- documentation describes the implementation that actually exists;
- all required gates are green without generated-artifact noise or sandbox-only
  assumptions.

## 4. Non-negotiable engineering principles

### 4.1 Dependency rule

Dependencies point inward:

```text
Shared kernel / domain contracts
              ↑
        Application use cases
              ↑
   Infrastructure and interface adapters
              ↑
        Composition root / runtime
```

The arrows describe allowed dependency direction. A lower-level contract must
never import a higher-level DTO merely because the DTO already exists.

### 4.2 Ports are use-case specific

Interfaces must describe the smallest capability required by their consumer.
Large facades may exist at the composition boundary, but use cases should
receive narrow ports. In particular, lifecycle, certificates, traffic
publication, output/tailing, and shared-proxy topology must not be one port.

### 4.3 DTOs do not cross every boundary

Transport records, application commands, domain concepts, persistence records,
and UI messages are different representations. Mapping between them is
intentional code, not accidental duplication.

### 4.4 Tests protect behavior before structure

Refactoring begins with characterization tests for existing behavior. Tests
must assert outcomes and contracts rather than private implementation details.
Structural metrics are used to identify risk and to check progress, not to
justify behavior-changing rewrites.

### 4.5 Security and privacy are product behavior

Proxy capture, raw bodies, tokens, local API control, CA installation, native
processes, and profile paths are security-sensitive features. Each must have a
documented threat model, bounded data retention, and negative tests.

### 4.6 Every generated artifact has an owner

Build output, coverage, API docs, VSIX staging, native bindings, Repowise
state, and Graphify output must either be excluded from source checks or be
validated by a specific artifact check. Generated files must never obscure
source failures.

## 5. Workstream map and dependency order

The work is divided into ten workstreams. The order is deliberate:

| ID | Workstream | Depends on | Main outcome |
|---|---|---|---|
| W0 | Governance and baseline | None | Traceable tasks, decisions, and reproducible evidence |
| W1 | Release blockers | W0 | Green tests, lint, localization, dependency triage, and packaging baseline |
| W2 | Architecture contract | W0, W1 | Enforced layer matrix and approved contract ownership |
| W3 | Boundary migration | W2 | Domain/application contracts moved without behavior changes |
| W4 | Core decomposition | W2, W3 | Focused proxy, persistence, service, profile, and UI components |
| W5 | Testing and quality | W1, W2, W3, W4 | Local quality floors and deterministic acceptance suites |
| W6 | Security and privacy | W1, W2 | Hardened capture, local control plane, process execution, and webview |
| W7 | Dependencies and packaging | W1, W6 | Secure, ABI-correct, reproducible VSIX artifacts |
| W8 | Documentation and tooling | W2, W4, W6, W7 | Documentation and automation synchronized with reality |
| W9 | Final validation and cleanup | W3–W8 | Dead-code cleanup, full audit, and release sign-off |

No Phase 2 decomposition should begin until W1 and W2 have established a
green safety net and an approved dependency matrix.

## 6. W0 — Governance, inventory, and baseline freeze

### W0.1 Create the remediation register

Create a task register, either in this document's execution appendix or in the
project tracker, with one entry per task. Each entry must contain:

- task ID;
- affected files and public contracts;
- behavior being preserved or changed;
- dependencies on previous tasks;
- risk level and rollback strategy;
- tests to add or update;
- commands required for verification;
- documentation and ADRs required;
- final status and evidence links.

Use stable IDs such as `ARCH-01`, `TEST-04`, `SEC-07`, and `PKG-03` so commits,
PRs, and audit notes can be traced back to this plan.

### W0.2 Freeze and capture the baseline

Capture the following before implementation starts:

- commit SHA, branch, Node.js, pnpm, TypeScript, Repowise, and Graphify
  versions;
- `git status` and ignored generated artifact state;
- current source/test file counts and largest files;
- Graphify graph and top god nodes;
- Repowise health, dead-code, and security results;
- extension-host test count and webview test count;
- global and per-module coverage;
- dependency audit JSON and lockfile paths;
- current architecture gate output;
- packaging failure output and expected artifact contents.

Do not compare future metrics with a different tool version or a different
source inclusion policy without recording the difference.

### W0.3 Define decision records

Before boundary migrations, create ADRs for:

1. authoritative layer matrix and contract ownership;
2. domain/application DTO strategy;
3. native runtime and packaging strategy;
4. proxy capture privacy and retention policy;
5. dependency advisory exception policy;
6. local proxy API threat model and authentication decision.

Each ADR must state alternatives considered, chosen option, consequences,
rollback implications, and verification evidence.

## 7. W1 — Release blockers and deterministic validation

W1 must be completed before broad refactoring. It makes failures trustworthy
and prevents architecture work from being built on a red or unstable baseline.

### W1.1 Isolate and fix webview test cleanup

Affected files:

- `webview/src/test/setup.ts`;
- `webview/vitest.config.ts`;
- `webview/src/components/PricesModal.test.tsx`;
- `webview/src/components/PricesModal.tsx`.

Tasks:

1. Register explicit React Testing Library cleanup after each test, or enable
   the supported Vitest global cleanup mechanism after confirming the installed
   versions' behavior.
2. Run the webview suite repeatedly in a loop to prove that each test starts
   with an empty DOM.
3. Keep selectors scoped to the dialog where multiple model groups are
   intentional.
4. Add a test for the interaction between `models` and `enabledModels` so the
   active section cannot accidentally duplicate or hide rows without a
   deliberate product decision.
5. Add tests for loading, empty, filter, clear-filter, close, and error states.

Acceptance:

- `CI=true pnpm --dir webview test` passes repeatedly;
- no test depends on execution order or leaked DOM;
- the expected behavior for duplicate active/general model records is
  documented and tested.

### W1.2 Repair localization completeness

Affected files:

- `locales/en.json`;
- all 25 non-English locale files;
- `scripts/validate-l10n.mjs`;
- localization documentation and contributor instructions.

Tasks:

1. Decide whether missing translations temporarily fall back to English or
   whether every locale must contain a translated value.
2. Add the 18 missing keys to all affected locales. If fallback values are
   used, mark them explicitly so they are not mistaken for completed
   translations.
3. Add a key-extraction or generation check that reports newly introduced
   English keys before they reach a release branch.
4. Validate placeholder parity, including `{id}`, plural forms, and formatting
   placeholders, not only key presence.
5. Add a contributor procedure for adding a localized key.

Acceptance:

- all 26 locale files have the same key set;
- placeholder validation passes;
- the UI renders a safe fallback when a locale is incomplete;
- `CI=true pnpm run validate:l10n` is green.

### W1.3 Make lint output meaningful

Affected files:

- `eslint.config.mjs`;
- generated output directories and packaging staging paths;
- source files reported by the 42 source-scoped errors.

Tasks:

1. Add explicit ignores for `.tmp/**`, `docs/api/**`, VSIX staging trees, and
   every generated artifact that is not source-reviewed.
2. Decide whether scripts are intentionally excluded. If scripts are excluded,
   add a separate JavaScript lint configuration or a documented reason.
3. Fix the 42 source errors rather than suppressing them globally. Group the
   fixes by rule: unnecessary assertions, type-only imports, `require-await`,
   unsafe values, promise callback handling, and stringification.
4. Review every `any` suppression and replace it with `unknown`, a type guard,
   or a narrowly scoped adapter type.
5. Add a CI assertion that reports both source lint and generated-artifact
   policy failures separately.

Acceptance:

- `CI=true pnpm exec eslint src webview/src packages` passes;
- `CI=true pnpm run lint` passes;
- generated assets cannot add source-lint noise;
- no broad `eslint-disable` is introduced without an explanation.

### W1.4 Stabilize extension-host tests and coverage execution

Tasks:

1. Keep the loopback-enabled proxy API integration test, but make its port
   allocation deterministic and collision-resistant.
2. Document the required CI permission for local loopback sockets.
3. Add a test mode that injects an HTTP server factory or in-memory transport
   for unit-level API tests, leaving one real socket test as acceptance coverage.
4. Repeat the extension suite several times to detect the intermittent
   `AccountsPanel` failure observed during the audit.
5. Make `test:coverage` preserve the test failure reason while still emitting a
   useful partial report.

Acceptance:

- `CI=true pnpm test` passes repeatedly with 668 tests or more;
- `CI=true pnpm run test:coverage` completes and enforces its thresholds;
- tests do not require a particular test runner scheduling order.

### W1.5 Triage production dependency advisories

Do not immediately add overrides. First produce an exact dependency and reachability
matrix for:

- `tar` through `@cursor/sdk` and `sqlite3`;
- `undici` through Connect RPC;
- `protobufjs`;
- `uuid` through `http-mitm-proxy`;
- `body-parser` through Express;
- `brace-expansion` and `ip-address` in optional/build paths.

For each advisory, record:

- package version and lockfile path;
- whether it is included in the VSIX;
- whether it is loaded at runtime or only used by install/build tooling;
- reachable input and attack surface;
- patched version and compatibility result;
- mitigation if an upgrade is blocked;
- owner and expiry date for any exception.

Then, in dependency order:

1. upgrade direct dependencies where possible;
2. update `@cursor/sdk` and its platform packages as a coordinated unit;
3. update or replace the proxy dependency if `uuid` cannot be remediated;
4. use lockfile overrides only with targeted runtime tests;
5. regenerate the lockfile in a clean environment;
6. package and inspect the final VSIX, not only `node_modules`.

Acceptance:

- no unresolved critical/high advisory remains in shipped runtime paths;
- any exception is documented, time-limited, and approved;
- the dependency tree is reproducible from the lockfile;
- `pnpm audit --prod` output is archived as release evidence.

### W1.6 Repair native dependency discovery and packaging prerequisites

First determine the intended runtime ownership of `sqlite3`:

- direct extension dependency;
- nested Cursor SDK dependency;
- build-only dependency;
- or legacy dependency that should be removed.

Then:

1. Make the package preparation script locate dependencies through package
   resolution rather than assuming a root-level hoist.
2. Make `scripts/download-electron-prebuild.mjs` fail closed:
   - use `curl --fail --location --silent --show-error` or an equivalent HTTP
     client;
   - avoid unchecked `curl | tar` pipelines;
   - download to a temporary file;
   - verify archive integrity and expected binding path;
   - verify the native module ABI after extraction;
   - never report success when the network request failed.
3. Verify both `better-sqlite3` and `sqlite3` for Node and Electron runtimes
   separately.
4. Ensure cleanup and restoration always run after a failed package attempt.
5. Add a packaging smoke test that loads every native module from the staged
   extension tree.

Acceptance:

- `CI=true pnpm run build:current` produces and verifies a VSIX;
- the process fails with a precise error when a binary is unavailable;
- a stale binding cannot make a failed download appear successful;
- package state is restored after both success and failure.

## 8. W2 — Define and enforce the architecture contract

### W2.1 Approve the authoritative layer model

Before moving files, agree on the following conceptual layers:

| Layer | Owns | May depend on |
|---|---|---|
| Shared kernel | Stable entities, value objects, shared pure rules, cross-process contracts only when truly shared | TypeScript and other shared-kernel modules |
| Domain | Business rules, domain services, domain-owned ports, domain contracts | Shared kernel and domain modules |
| Application | Use cases, orchestration, application commands/results, mapping policies | Domain and shared kernel |
| Infrastructure | HTTP, auth, filesystem, SQLite, native process, MITM transport, external SDK adapters | Application ports, domain ports, shared kernel, external libraries |
| Interface adapters | VS Code UI, webview bridge, presenters, command handlers, API controllers | Application use cases, ports, shared contracts |
| Composition root | Concrete construction, lifecycle wiring, configuration | All implementation layers |

The table must explicitly answer whether proxy decoding is infrastructure,
application, or a combination. The answer must be represented in the checker,
not only in prose.

### W2.2 Define forbidden edges

At minimum, the checker must reject:

- domain -> application;
- domain -> infrastructure;
- domain -> interface adapters;
- domain -> VS Code, Node-specific adapters, `http-mitm-proxy`, or
  `httpolyglot`;
- application -> UI/webview;
- application -> concrete infrastructure;
- infrastructure -> UI/webview;
- proxy/infrastructure -> UI presenters unless explicitly mediated;
- shared kernel -> Node, VS Code, external runtime libraries, or extension
  implementation modules;
- test-only and generated code being included in production boundary checks;
- package imports that bypass the declared public package entrypoint.

Every allowed exception must have a named owner and an ADR reference.

### W2.3 Replace the regex architecture checker

Implement a resolver-backed checker, preferably using the TypeScript compiler
API already available in the repository. The current implementation is the
first enforced source-resolver slice; it must satisfy the following contract:

1. collect source files under explicit roots;
2. resolve relative, package, and configured alias imports;
3. distinguish type and runtime imports for reporting, while enforcing the same
   architectural direction unless an exception is deliberate;
4. understand barrel exports and package entrypoints;
5. detect static cycles and layer-level cycles;
6. emit machine-readable JSON for CI and readable text for developers;
7. report the exact source and target layer, file, line, and rule;
8. fail closed when a relative import cannot be resolved rather than silently
   ignoring it. Source imports ending in `.js`, `.mjs`, or `.cjs` must resolve
   against their TypeScript source counterpart.

### W2.4 Add architecture fixtures and tests

Create a small fixture tree containing:

- one legal domain port;
- one illegal domain-to-application import;
- one illegal application-to-UI import;
- one illegal shared-kernel-to-Node import;
- one legal infrastructure adapter;
- one package-entrypoint import;
- one static cycle;
- one documented exception.

Test the checker itself in the normal test runner. The architecture gate must
be tested independently from the production graph so a regression in the
checker cannot make the repository appear healthy.

### W2.5 Update the architecture documentation immediately

Update, in one coherent change:

- `docs/ARCHITECTURE.md`;
- `docs/CLEAN-ARCHITECTURE-PRINCIPLES.md`;
- the proxy metrics remediation plan;
- relevant ADRs;
- `CONTRIBUTING.md` architecture guidance.

Remove the false statement that `src/application/` does not exist. Add the
actual dependency matrix, examples of legal/illegal imports, and the exact
command used by CI.

## 9. W3 — Migrate contract ownership without behavior changes

This workstream fixes the current domain/application violations. It must be
executed as a staged migration with compatibility aliases only where necessary.

### W3.1 Inventory all application DTOs

Classify every type under `src/application/types` into one of four categories:

1. domain concept or value object;
2. application command/result;
3. infrastructure/transport record;
4. interface/webview/API contract.

Do not move a file based only on its current directory. Record the consumers,
producers, serialization requirements, and test fixtures for every type.

### W3.2 Move domain-owned contracts inward

Likely domain candidates include minimal forms of:

- agent identity and correlation;
- token usage signals;
- persistence commands needed by a domain port;
- protocol-independent token/turn concepts;
- domain configuration value objects.

The final names and locations must follow the inventory and ADR. Preserve
external representations through explicit mappers instead of exposing proxy
wire shapes to the domain.

### W3.3 Separate proxy transport from usage semantics

Split broad records such as `ProxyTrafficSummary` and `AgentSessionInfo` into
the smallest meaningful contracts, for example:

- transport metadata;
- request/response correlation;
- agent identity and parent relationship;
- live token delta;
- billed turn usage;
- context usage;
- diagnostic facts;
- persistence event.

The actual names must be selected after checking all consumers. Do not create a
large replacement DTO with the same fields under a new name.

### W3.4 Migrate ports and adapters

Update the following groups with tests at each step:

- `IAgentTrackingRepository` and persistence records;
- `ITrafficDecoder` and decode results;
- `IProxyServer`, `IProxyProcess`, and proxy configuration;
- `IProxyApiClient`, `IProxyApiServer`, and API events;
- `IProxyTrafficBus` and event publication;
- `ITokenTurnDetectionService` and session information;
- active conversation and workspace repository contracts.

The application layer may adapt infrastructure results, but domain ports must
not import application DTOs after this workstream.

### W3.5 Remove or isolate compatibility imports

The two proxy-to-UI presenter imports must be handled explicitly:

- move the presenter to the correct interface/application boundary; or
- expose a domain/application-facing formatting port; or
- retain a compatibility re-export only in a leaf adapter with a documented
  exception.

The chosen option must be enforced by the architecture checker.

### W3.6 Verify the migration

For each contract migration:

- compile extension and webview;
- run focused unit and integration tests;
- run architecture fixtures and the real architecture graph;
- inspect Graphify cross-layer edges;
- compare serialized JSON/protobuf/log shapes where applicable;
- verify no public command, webview message, migration, or VSIX entrypoint
  changed unintentionally.

## 10. W4 — Decompose high-risk modules behind tested seams

The goal is focused collaborators and a thin orchestration layer, not arbitrary
file splitting. Each extraction requires a responsibility statement, a port or
pure function where appropriate, characterization tests, and a rollback path.

### W4.1 `ProxyManager` decomposition

Current risk: 746 lines and Graphify degree 66, combining
profile lifecycle, shared proxy coordination, state persistence, certificate
operations, traffic ingress, agent tracking, output/tailing, and notifications.

Proposed seams:

1. `ProxyLifecycleCoordinator` — start, stop, restart, process liveness,
   cleanup, and status transitions.
2. `ProxyProfileSettingsCoordinator` — apply and restore per-profile settings.
3. `SharedProxyCoordinator` — shared process ownership, profile routing, port
   allocation, and attach/detach behavior.
4. `ProxyTrafficSubscriptionCoordinator` — traffic bus, cost enrichment,
   tracking ingress, and listener lifecycle.
   `ProxyTrafficUsageCoordinator` now implements the tracking-ingress portion
   with focused tests; the remaining bus/subscription concerns stay in the
   facade until their ownership is characterized.
5. `ProxyOutputCoordinator` — JSONL tailers, output channels, and diagnostics
   presentation.
6. `ProxyCertificateFacade` — only if the existing certificate service does not
   already own the full behavior.
7. A thin `ProxyManager` facade retained temporarily for compatibility.

Completed in this phase:

- shared child startup, persisted ownership recovery, health polling, exit
  cleanup, and shared shutdown are implemented by
  `SharedProxyLifecycleCoordinator`;
- per-profile attach and stop cleanup are implemented by
  `ProxyProfileLifecycleCoordinator`;
- profile status reconciliation and traffic-tail routing are implemented by
  `ProxyStatusCoordinator` and `ProxyTrafficTailerCoordinator`; the next
  candidates are configuration assembly and the remaining facade-level listener
  and process-cleanup helpers.

Execution order:

- first characterize start/stop/restart and shared-proxy behavior;
- extract one collaborator at a time;
- replace the broad `IProxyManager` dependency with narrow ports as consumers
  migrate;
- remove the facade only after all callers use focused ports.

Acceptance:

- no behavior changes in per-profile, shared-proxy, multi-window, certificate,
  or tracking integration tests;
- no collaborator owns unrelated lifecycle and UI concerns;
- the facade has no direct SQL, raw process parsing, or presenter formatting;
- coverage for failure and cleanup paths is higher than the baseline.

### W4.2 `MitmProxyServer` and proxy decoder decomposition

Split responsibilities into:

- transport/server lifecycle;
- request and response capture;
- protocol normalization;
- streaming frame accumulation;
- protobuf/Connect decoding;
- semantic insight extraction;
- diagnostics and metrics publication;
- log formatting and persistence events.

Keep HTTP/1.x and HTTP/2 differences behind protocol adapters. Ensure a new
transport does not require changes to semantic token accounting.

For `proxyInsightExtractor` and `proxyDecode`:

- isolate legacy Composer usage extraction;
- isolate Agent identity/correlation extraction;
- isolate token/turn usage extraction;
- isolate model and cost enrichment;
- isolate redaction and sensitive-field handling;
- use explicit result types for malformed, unsupported, and partially decoded
  frames.

Required tests:

- malformed protobuf and truncated Connect frames;
- compressed and uncompressed bodies;
- HTTP/1.0, HTTP/1.1, and HTTP/2 metadata normalization;
- multiple sessions and parallel subagents;
- token delta replay and turn-ended precedence;
- unknown RPCs and unsupported payloads;
- redaction and body-size limits.

### W4.3 Tracking service and persistence coordinator

The previous extraction reduced `AgentTrackingService.ingestTraffic`, but the
coordinator's `persist` method remains branch-heavy. Split persistence policy
into strategies or pure builders only after adding characterization tests for:

- turn-ended billing rows;
- context/token detail rows;
- live token delta aggregation;
- batch turn detection;
- token snapshots;
- no-op/invalid/incomplete events;
- event-key construction and replay behavior.

The service should orchestrate identity resolution, conversation/agent upsert,
and one persistence use case. It should not contain all event policy branches.

### W4.4 SQLite repository decomposition

Keep SQL and connection handling in infrastructure, but separate:

- migration/schema initialization;
- conversation and agent writes;
- token event writes and idempotency ledger;
- conversation aggregate queries;
- agent tree queries;
- cleanup and database-size queries.

Introduce read models where query shapes differ from write records. Preserve
transactions, WAL, busy timeout, event uniqueness, and multi-window behavior.
Add concurrency tests before changing write ordering or connection ownership.

### W4.5 Accounts panel and webview decomposition

For `AccountsPanel` and `AccountsPanelHandlers`:

- separate webview lifecycle from data refresh use cases;
- move each message family to a focused handler/use-case adapter;
- isolate proxy controls, storage controls, profile CRUD, account refresh,
  GitHub enrichment, and pricing data;
- centralize host-to-webview message creation and validation;
- keep presentation mapping out of service orchestration.

For `webview/src/App.tsx` and large components:

- create a typed message reducer or state machine;
- separate bridge subscription from state transitions;
- extract profile, quota, proxy, storage, and pricing containers;
- keep presentational components free of host-side policy;
- add contract tests for every message family and error state.

### W4.6 Profiles, commands, and model-efficiency hotspots

After the proxy/persistence boundaries are stable:

- split `profileCommands.ts` by CRUD, launch, import/export, and proxy actions;
- split `ProfileLauncher` into argument construction, platform launching, and
  process result handling;
- split `InstanceDetector` into OS command execution, parsing, and profile
  matching;
- split `composerDbPoller` into scheduling, database access, parsing, and
  cancellation;
- split `EfficiencyService` into use-case orchestration, aggregation, and
  presentation;
- split `statusBarManager` into usage state, formatting, and VS Code rendering.

Every split must preserve the public behavior documented in command,
configuration, and model-efficiency docs.

## 11. W5 — Testing strategy and quality gates

### W5.1 Test pyramid

Use four layers of tests:

1. Pure unit tests for domain rules, mappers, parsers, formatters, key
   construction, and state transitions.
2. Adapter tests for HTTP, filesystem, SQLite, process execution, proxy API,
   and VS Code boundaries using injected fakes.
3. Integration tests for tracking persistence, proxy decoding, multi-window
   coordination, migrations, and message contracts.
4. Acceptance tests for a staged/packaged extension, native bindings, startup,
   proxy operation, and clean shutdown.

### W5.2 Coverage floors

Keep the global thresholds only as a minimum. Add local floors for critical
modules after stabilizing their tests:

| Area | Initial floor | Long-term target |
|---|---:|---:|
| Domain services and rules | 90% lines / 80% branches | 95% / 90% |
| Proxy decoding and redaction | 75% / 65% | 90% / 80% |
| Agent tracking and persistence policy | 80% / 70% | 90% / 80% |
| Authentication and token refresh | 75% / 65% | 90% / 80% |
| Proxy API and localhost security | 85% / 75% | 95% / 85% |
| Webview bridge/reducer | 80% / 70% | 90% / 80% |
| UI rendering | 65% / 55% | 80% / 70% |

The floors must be introduced after measuring the refactored module boundaries,
not applied blindly to generated or composition-only code.

### W5.3 Missing test families

Add focused tests for:

- `proxyDecode` malformed and partial input;
- CA installation success, permission failure, unsupported platform, timeout,
  and rollback;
- token refresh database/secrets precedence, expiry, malformed state, and
  network failure;
- model efficiency poll cancellation, missing DB, malformed rows, and retry;
- status bar rendering for all quota modes and stale data;
- process launcher argument escaping and child failure;
- local API authorization, forwarded headers, shutdown, and client disconnect;
- body capture redaction, binary/text limits, sidecar retention, and path
  validation;
- native ABI mismatch and missing binary startup failures;
- webview host bridge message validation, unknown messages, and startup errors;
- every migration's upgrade, idempotency, rollback, and invalid-schema path.

### W5.4 Test isolation and determinism

Rules:

- no test may rely on global mutable state from another test;
- temporary databases, ports, files, and profiles must be unique per test;
- all timers, listeners, child processes, streams, and sockets must be closed;
- test fixtures must be immutable or recreated per test;
- retries may diagnose flakiness but must not hide it in CI;
- tests using local sockets must support an injected in-memory alternative.

Add a repeat mode to CI for the highest-risk suites, especially webview,
proxy API, proxy manager, and persistence concurrency tests.

## 12. W6 — Security and privacy hardening

### W6.1 Webview output safety

Replace error-path `innerHTML` assignments with text-safe DOM APIs or React
rendering. Review all other HTML string interpolation in host-generated webview
content.

Add tests proving that error messages containing `<script>`, quotes, newlines,
and template delimiters render as text and cannot alter DOM structure.

Review CSP directives:

- keep `default-src 'none'`;
- remove unnecessary broad origins where feasible;
- keep script nonce enforcement;
- restrict image/font sources to required origins;
- document why any inline style or external source is necessary.

### W6.2 Proxy capture privacy policy

Define and document:

- whether request and response bodies are captured by default;
- exactly which settings enable JSONL and sidecar capture;
- headers and body fields that are always redacted;
- maximum inline and total storage sizes;
- sidecar retention and cleanup behavior;
- user-visible deletion controls;
- behavior on permission errors and partial writes;
- whether sensitive data can remain in rotated or backup files.

Current implementation decision: proxy enablement and JSONL persistence are
separate controls. Proxy traffic is not written to JSONL unless the profile's
JSONL option is enabled; decoded insights may still be streamed in memory to
the extension UI and metrics pipeline. JSONL capture is bounded by the
configured total log size and inline body limit. Persisted headers redact
authorization, proxy authorization, cookies, API keys, and auth-token headers;
sidecar reads reject absolute paths, traversal, and symlink escapes. Body-field
redaction and a confirmed user-facing deletion action are implemented. The
deletion command removes only known JSONL and body-sidecar files, requires
confirmation, refuses to run while a managed proxy is active, and preserves
unrelated files. Retention policy, rotated/backup-file review, and disk-full
behavior remain open W6 tasks.

Implementation tasks:

1. Separate raw capture from decoded insight extraction.
2. Redact before persistence wherever possible.
3. Validate sidecar paths stay under the configured log directory.
4. Prevent arbitrary absolute paths from being resolved from untrusted log
   records unless an explicit offline-tool mode requires it.
5. Add retention cleanup tests and disk-full/error tests.
6. Add a privacy warning at the point where capture is enabled.

### W6.3 Local proxy API threat model

Decide whether loopback-only access is sufficient. If not, add a random
per-process capability token shared only with the extension host and child
process. Protect REST and WebSocket paths consistently.

Regardless of the decision:

- bind explicitly to loopback;
- do not trust `x-forwarded-for` unless a trusted local proxy is configured;
- validate origin and connection state for WebSocket clients;
- rate-limit or debounce shutdown/control requests;
- avoid returning secrets, raw headers, or raw bodies in status endpoints;
- test IPv4-mapped, IPv6, missing, malformed, and forwarded addresses.

### W6.4 Process execution hardening

Remove `shell: true` from Windows launching if the API permits. If a shell is
unavoidable, define a platform-specific escaping function and test paths with
spaces, quotes, shell metacharacters, Unicode, and trailing separators.

Use argument arrays and allowlisted executable paths for all process launches.
Do not interpolate user-controlled paths into shell command strings. Apply
timeouts, kill process trees where required, close streams, and avoid logging
tokens or full command lines.

### W6.5 Secrets and token handling

Continue the historical secret scan, but add runtime checks for:

- token values in logs and error messages;
- token values in proxy bodies and sidecars;
- child-process environment propagation;
- exported profile files;
- crash reports and debug output.

Use redacted test fixtures and make accidental secret output fail tests where
practical.

## 13. W7 — Dependency, native runtime, and packaging reliability

### W7.1 Dependency lifecycle

Create a dependency policy covering:

- direct dependency ownership;
- update cadence;
- production audit severity thresholds;
- advisory exceptions and expiry;
- lockfile review;
- SBOM generation;
- platform-specific package verification.

Pin or constrain dependencies where native ABI and protocol compatibility make
floating upgrades unsafe. Every update must run extension tests, webview tests,
proxy decode fixtures, persistence migrations, and packaging smoke tests.

### W7.2 Native runtime matrix

Document and verify separately:

| Runtime | Module | ABI source | Required check |
|---|---|---|---|
| Node test runtime | `better-sqlite3` | Node module ABI | `verify:native:node` plus load/query smoke test |
| Electron extension host | `better-sqlite3` | VS Code Electron ABI | staged extension load/query test |
| Extension SDK runtime | `sqlite3` if retained | SDK/extension runtime ABI | package contents and load smoke test |
| Platform binaries | Cursor SDK helpers | target platform/architecture | VSIX target verification |

Never infer runtime compatibility from file existence alone.

### W7.3 Packaging pipeline

Make the build pipeline transactional:

1. verify toolchain versions;
2. bundle packages and webview;
3. prepare a clean staging directory;
4. install exact production dependencies;
5. build/download native bindings with checksums;
6. materialize workspace packages;
7. prune only validated non-production content;
8. package the target VSIX;
9. inspect contents and load native modules;
10. restore the workspace even on failure.

Add artifact checks for:

- extension bundle;
- webview bundle and CSS;
- migrations and proto files;
- shared packages;
- expected native bindings;
- expected platform SDK package;
- absence of source, tests, secrets, `.env`, and development tools;
- absence of stale or unintended bodies/logs.

### W7.4 Platform matrix

Run at least current-target packaging on every PR affecting dependencies,
native modules, bundling, or packaging scripts. Run the full target matrix on
release candidates:

- macOS arm64;
- macOS x64;
- Linux x64;
- Linux arm64;
- Windows x64;
- Windows arm64.

Record skipped targets explicitly with a reason and owner.

## 14. W8 — Documentation and developer tooling

### W8.1 Documentation synchronization

Update all English documentation affected by implementation changes:

- architecture and Clean Architecture principles;
- proxy metrics remediation plan;
- proxy setup and tokens/usage semantics;
- database and migration docs;
- build and packaging docs;
- privacy and security docs;
- testing and multi-window guides;
- command/configuration references;
- research pages whose review dates predate changed behavior.

Every design document must state:

- status: proposed, active, deprecated, or historical;
- last reviewed date;
- implementation references;
- verification commands;
- known limitations and open decisions.

### W8.2 Documentation checks

Add:

- Markdown link validation for repository-local links;
- detection of missing source references;
- a check that generated docs are excluded from source lint;
- a docs index or ownership table;
- an audit command that records tool versions and outputs.

### W8.3 Improve contributor workflow

Update `CONTRIBUTING.md` with:

- architecture rules and how to run the checker;
- test/coverage expectations;
- webview test setup;
- native runtime requirements;
- dependency/security review procedure;
- proxy privacy review checklist;
- packaging and VSIX verification steps;
- when an ADR is mandatory.

## 15. W9 — Dead-code cleanup and final audit

### W9.1 Validate unused exports

For every Repowise candidate:

1. search source and generated bundle references;
2. inspect VS Code activation and command registration;
3. inspect package entrypoints and dynamic imports;
4. inspect tests and external-tool scripts;
5. decide keep, deprecate, or remove;
6. add a regression test or packaging assertion where the symbol is runtime
   relevant.

Remove only in small commits after all relevant tests and VSIX checks pass.

### W9.2 Re-run structural analysis

After W3 and W4:

- regenerate Graphify with the same inclusion policy;
- run god-node and cross-layer reports;
- run Repowise health and dead-code analysis;
- compare coupling, file size, coverage, and churn signals;
- investigate regressions even when aggregate scores improve.

### W9.3 Final independent audit

Run the complete command set from the audit baseline, plus:

- clean-room install;
- dependency/SBOM verification;
- all relevant target packaging jobs;
- staged extension load smoke test;
- repeated test runs for high-risk suites;
- local documentation link validation;
- secret scan on current history and release artifacts.

The final audit must classify every original finding as resolved, accepted with
an approved exception, or still open. “Not reproduced” is not a resolution
without an explanation.

## 16. CI and required checks

The required CI pipeline should be organized into explicit jobs rather than a
single opaque lint/test command:

### Job A — Static quality

- install with frozen lockfile;
- source ESLint;
- TypeScript extension and webview checks;
- localization key and placeholder validation;
- type synchronization;
- architecture checker and architecture fixture tests;
- documentation link validation.

### Job B — Unit and integration tests

- extension-host tests;
- webview tests;
- proxy decoding tests;
- persistence/migration/concurrency tests;
- security and redaction tests;
- coverage with global and local floors.

### Job C — Dependency and security

- production dependency audit;
- secret scan;
- SBOM generation;
- artifact scan for secrets and development-only files;
- advisory exception validation.

### Job D — Packaging

- Node native verification;
- Electron native preparation;
- current-target VSIX build;
- VSIX content verification;
- staged runtime load smoke test.

### Job E — Release matrix

- all supported target builds;
- per-target native checks;
- package size and contents report;
- release evidence archive.

Every job must distinguish code failures, environment failures, and external
network failures. A network failure must not be converted into a false success.

## 17. Rollback and migration strategy

### 17.1 Source refactors

Keep old facades and compatibility exports temporarily when they are required
by external consumers or runtime entrypoints. Mark them deprecated, add tests,
and remove only after a release or a documented migration window.

### 17.2 Database changes

Never rewrite existing migrations. Add forward migrations, test upgrade from
the oldest supported schema, test repeated startup, and define backup/restore
behavior before changing tables or indexes.

### 17.3 Dependency upgrades

Keep lockfile changes isolated. If a dependency upgrade changes protocol,
native ABI, or packaging behavior, revert the dependency slice independently
from unrelated refactors.

### 17.4 Packaging changes

Use staging directories and transactional restoration. A failed package command
must leave source files, `package.json`, workspace links, native module state,
and ignored build directories in a known documented state.

### 17.5 Privacy changes

Changes to body capture or redaction require a migration note for existing log
files and an explicit statement about what old logs may still contain.

## 18. Suggested execution sequence

This is the recommended order after plan approval:

1. **W0.1–W0.3:** create task register, capture baseline, approve ADRs.
2. **W1.1–W1.4:** make tests, coverage, localization, and lint trustworthy.
3. **W1.5–W1.6:** triage dependencies and repair packaging/native discovery.
4. **W2.1–W2.5:** approve and implement the architecture contract/checker.
5. **W3.1–W3.6:** migrate contract ownership and remove domain/application
   dependency violations.
6. **W5.1–W5.4:** add safety-net tests for newly separated contracts.
7. **W4.1–W4.4:** decompose proxy, tracking, and persistence hubs.
8. **W4.5–W4.6:** decompose UI, profiles, commands, and efficiency modules.
9. **W6.1–W6.5:** complete security and privacy hardening.
10. **W7.1–W7.4:** complete dependency, native, and packaging hardening.
11. **W8.1–W8.3:** synchronize all English documentation and tooling.
12. **W9.1–W9.3:** clean dead code, rerun structural analysis, and perform
    the final independent audit.

The sequence can be parallelized only when the dependency table says the tasks
are independent and the shared verification gates remain green.

## 19. Definition of done

The project is not complete until all of the following are true:

### Architecture

- domain/application dependency violations are gone;
- no undocumented forbidden layer edges remain;
- the architecture checker uses resolved imports and negative fixtures;
- static and layer-level cycles are detected;
- ports are use-case specific;
- the composition root owns concrete wiring;
- architecture documentation matches the code and checker.

### Code structure

- `ProxyManager`, `MitmProxyServer`, tracking persistence, SQLite persistence,
  panel handlers, and major UI components have focused responsibilities;
- broad DTOs have been replaced by boundary-appropriate contracts;
- large files remaining are justified by a documented responsibility;
- no new monolithic hub was introduced during remediation.

### Tests and quality

- extension-host and webview tests pass repeatedly;
- coverage thresholds pass globally and locally for critical modules;
- malformed input, failure, concurrency, cancellation, and cleanup paths are
  covered;
- source lint and TypeScript checks pass without generated-artifact noise;
- localization and type synchronization checks pass.

### Security and privacy

- no unreviewed critical/high production advisory remains in shipped paths;
- webview error rendering is text-safe;
- proxy capture has explicit opt-in, redaction, retention, and deletion rules;
- sidecar paths are constrained and tested;
- process execution is non-shell or robustly escaped;
- local API threat model and authentication decision are documented and tested;
- no secrets appear in logs, bundles, fixtures, or VSIX artifacts.

### Packaging and runtime

- Node and Electron native bindings are built and verified for their actual
  ABIs;
- current-target and release-matrix VSIX builds pass;
- VSIX contents are verified, reproducible, and free of development artifacts;
- a staged extension starts, loads the database, serves the webview, and can
  start/stop the proxy;
- failed packaging restores the workspace safely.

### Documentation and process

- all implementation-facing documentation is in English and synchronized;
- stale migration and architecture statements are resolved;
- ADRs exist for architectural, security, dependency, and packaging decisions;
- the audit command and release evidence are reproducible;
- every original audit finding has a closed or approved exception record.

## 20. Execution approval and current sign-off

The owner approved implementation on 2026-08-24. This checklist is retained
as a traceability record and is updated as implementation decisions are
validated:

- [x] The target layer matrix and checker rules are implemented and tested.
- [x] The domain/application contract migration strategy is implemented with
      compatibility exports where required.
- [ ] The dependency upgrade policy and advisory exception policy are fully
      closed for shipped runtime paths.
- [ ] The proxy privacy and local API threat model is fully implemented,
      including user-visible deletion and retention controls.
- [x] The current-target native packaging strategy is verified; the complete
      release matrix remains open.
- [ ] The proposed decomposition seams are fully implemented.
- [x] The local coverage floors are introduced after boundary stabilization.
- [x] The task order and rollback strategy are documented.
- [ ] The final implementation commit and push are pending completion of the
      remaining gates.

The remaining unchecked items are execution work, not requests for a new plan.
