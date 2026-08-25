# Final Quality, Security, and Release Hardening Plan

## 1. Purpose and execution rule

This document turns the remaining quality, security, correctness, architecture,
and release risks into an executable remediation program. It complements the
[Master Remediation Plan](MASTER-REMEDIATION-PLAN.md) and is the authoritative
execution plan for the next program of work.

The objective is not to improve a static-analysis score. The objective is to
prove that the extension:

- records Cursor usage and cost data with correct semantics;
- follows the documented Clean Architecture dependency direction;
- protects captured data and local control surfaces;
- behaves deterministically under failure, concurrency, and restart;
- packages the correct runtime and native binaries for supported targets; and
- can be released with reproducible evidence rather than local-machine
  assumptions.

No production implementation work is authorized by this document alone. Each
work package must be approved for execution, implemented in a small isolated
commit, verified with the gates listed here, documented, and only then pushed.
If a finding invalidates an assumption in this plan, stop at the current
boundary, record the evidence, update the plan, and request a decision before
continuing.

All implementation-facing documentation, ADRs, test descriptions, and code
comments created during this program must be written in English.

## 2. Current baseline and evidence status

Baseline date: 2026-08-25. Branch: feature/3-mitm-proxy. Latest verified
implementation commit: a2b761b refactor: isolate sqlite retention cleanup.

The following facts are current evidence, not completion claims:

| Area | Current state | Interpretation |
|---|---|---|
| Extension-host tests | 795/795 passed across 253 suites | Strong global functional baseline; local risk remains uneven |
| Coverage | 76.1% lines, 72.77% branches, 76.33% functions | Global thresholds pass; critical-module floors are still required |
| TypeScript/ESLint | Full lint passed in the latest verified slice | Must be repeated after each dependency/build change |
| Architecture gate | Passed for 438 TypeScript files | The gate is useful but must be independently verified against resolved imports |
| Documentation links | Passed for 45 Markdown files | Does not prove semantic documentation consistency |
| Graphify | 3,742 nodes, 10,117 edges in the latest code-only graph | ProxyManager remains a high-coupling hotspot; metrics depend on tool policy |
| Repowise | Latest safe-only dead-code run returned no findings | Must be supplemented by health, security, and shipped-artifact analysis |
| SQLite tracking | Read, write, schema, and retention seams are separated | Correctness, concurrency, migration, and lifecycle behavior remain open |
| Remote CI | Copilot - Commit succeeded for the pushed commit | The full CI workflow is PR-triggered for develop and is not equivalent to a release gate |
| Packaging | Historical audit identified native dependency and fail-open prebuild risks | Must be re-run from clean staging before being marked resolved |
| Dependencies | Historical audit identified critical/high production advisories | Must be re-baselined against the current lockfile and actual VSIX contents |

Historical findings must not be marked resolved from age or from a passing
unrelated workflow. Every original finding needs one of three outcomes:

1. resolved, with current reproducible evidence;
2. accepted exception, with owner, rationale, mitigation, and expiry; or
3. still open, with a concrete next action.

## 3. Non-negotiable engineering principles

### 3.1 Evidence before modification

Before changing a subsystem, capture current command output and tool versions,
the relevant dependency and import graph, characterization behavior, artifact
contents where packaging is involved, and the current failure mode.

Do not infer runtime reachability from pnpm audit alone. Do not infer
architecture compliance from the existing checker alone. Do not infer native
compatibility from a file's existence. Do not infer token correctness from
aggregate totals without event-level fixtures.

### 3.2 Small reversible changes

Each implementation slice must have one primary responsibility, focused tests,
preserved public compatibility unless explicitly changed, English documentation,
applicable gates, and a rollback path that does not require destructive history
rewrites.

### 3.3 No broad suppressions

Do not solve a finding with a repository-wide lint disable, an unbounded
architecture exception, an unreviewed dependency override, a test skip, or an
unbounded coverage exclusion. Every exception must be narrow, named, justified,
tested, and time-limited.

### 3.4 Preserve user data and privacy

Do not delete or rewrite user logs, databases, profiles, credentials, or
generated artifacts during implementation without an explicit reviewed
operation. Test destructive behavior only against temporary fixtures. Any
retention or migration change must state what happens to existing data.

## 4. Program control and required records

Create or maintain these records before implementation:

The live register is [QUALITY-HARDENING-TASK-REGISTER.md](QUALITY-HARDENING-TASK-REGISTER.md).

| Record | Required contents | Owner |
|---|---|---|
| Task register | ID, finding, dependency, owner, status, commit, evidence, rollback | Repository maintainer |
| Decision log | Alternatives, decision, consequences, rejected options, review date | Repository maintainer |
| Dependency register | Package, path, shipped status, advisory, mitigation, expiry | Dependency owner |
| Artifact manifest | VSIX hash, files, native binaries, target, toolchain | Release owner |
| Metrics correctness matrix | Fixture, expected rows, totals, cost source, tolerance | Tracking owner |
| Security review | Threat, asset, control, test, residual risk, decision | Security reviewer |
| Final audit report | Every original finding classified with evidence | Independent reviewer |

Every task below has a stable ID. Commit messages should include the task ID,
for example fix(QA-3.2): make native download fail closed.

## 5. Execution order and dependencies

1. QA-0: freeze the baseline and re-audit current state.
2. QA-1: make CI, tests, localization, and lint trustworthy.
3. QA-2: close dependency and supply-chain uncertainty.
4. QA-3: repair native runtime and packaging reproducibility.
5. QA-4: prove token and cost correctness.
6. QA-5: enforce Clean Architecture with resolved imports.
7. QA-6: complete security and privacy hardening.
8. QA-7: add reliability, concurrency, and data-lifecycle guarantees.
9. QA-8: raise local coverage and reduce remaining hotspots.
10. QA-9: synchronize documentation, tooling, and operational runbooks.
11. QA-10: perform an independent final audit and release rehearsal.

QA-1 must precede broad refactoring. QA-2 and QA-3 must precede release claims.
QA-4 must precede pricing or dashboard expansion. QA-5 must precede new
cross-layer abstractions. QA-6 and QA-7 may run in parallel only after their
threat and data assumptions are recorded. QA-10 must be performed by someone
who did not implement the last substantial slice.

## 6. QA-0 — Freeze the baseline and re-audit current state

### QA-0.1 Reproduce the complete baseline

Record Node, pnpm, TypeScript, VS Code/Electron target, Graphify, Repowise,
operating system, architecture, git SHA, and dirty-tree state. Archive:

- pnpm install --frozen-lockfile
- pnpm run check:architecture
- pnpm run test:architecture
- pnpm run lint
- pnpm run validate:l10n
- pnpm run test:types-sync
- pnpm run verify:native:node
- pnpm test
- pnpm run test:coverage
- pnpm --dir webview test
- pnpm run compile
- pnpm run audit
- pnpm audit --prod --json
- pnpm audit signatures --json
- repowise health --format json --refactoring-targets
- repowise dead-code --safe-only --format json
- repowise security scan --history --format json
- graphify extract . --code-only with a unique output directory
- graphify god-nodes and graphify diagnose multigraph on that graph

Adapt the command set only when a command is unavailable, and record why.
Never compare graph metrics from different tool versions or source policies.

### QA-0.2 Reclassify historical findings

For every finding in ARCHITECTURE-AUDIT-2026-08-24.md:

- locate the current code and current test;
- run the original reproducer where possible;
- confirm whether the finding still exists;
- identify partial fixes and changed acceptance criteria;
- link current evidence in the task register.

Pay special attention to src/application documentation, webview cleanup,
localization, lint noise, native packaging, dependency advisories, innerHTML,
process spawning, and proxy retention.

### QA-0.3 Establish change-control gates

| Change type | Minimum gates |
|---|---|
| Domain/application contract | TypeScript, architecture checker, fixtures, affected tests |
| Proxy/parser | TypeScript, lint, parser fixtures, malformed-input tests, extension suite |
| Persistence/migration | TypeScript, focused SQLite integration, migration tests, full suite |
| Webview/UI | Webview typecheck, webview tests, localization, host message tests |
| Dependency/lockfile | Full test, webview test, audit, signatures, native checks, packaging |
| Packaging/native script | Clean build, ABI smoke tests, VSIX inspection, restore-on-failure test |
| Capture/privacy/security | Threat-model review, negative tests, redaction/retention fixtures |

Exit criteria: baseline artifacts are archived, every historical finding is
reclassified, and no implementation task starts with an unknown gate.

## 7. QA-1 — Make CI, tests, localization, and lint trustworthy

### QA-1.1 Separate source lint from generated-artifact policy

Inspect eslint.config.mjs, docs/api, staging directories, out, coverage output,
and VSIX preparation trees. Define which files are source-reviewed, which are
ignored, and which have their own checker. Scripts must be either linted under
a JavaScript policy or explicitly excluded. Add a CI assertion that prints
source and generated scopes separately. Do not add broad eslint disables.

### QA-1.2 Make extension-host tests deterministic

Review shared mocks, temporary paths, process cleanup, sockets, timers,
environment variables, and ordering. Add deterministic ephemeral-port
injection, explicit teardown for processes/servers/files/WAL/timers/listeners,
repeat execution, failure artifacts, and a server-factory seam. Retain at
least one real loopback acceptance test. Reproduce any intermittent
AccountsPanel failure in a loop before classifying it.

### QA-1.3 Stabilize webview isolation and bridge coverage

Inspect webview/vitest.config.ts and its setup file. Use explicit
afterEach(cleanup) or the supported global setup mechanism, then run repeatedly
and in shuffled order. Add contract tests for every host message family,
unknown and malformed messages, host errors/timeouts, startup/reconnect,
loading/empty/error/retry states, and active versus all model lists.

The official [Testing Library cleanup guidance](https://testing-library.com/docs/react-testing-library/api/#cleanup)
requires cleanup when the test framework does not provide it automatically.
Vitest [setup files](https://main.vitest.dev/config/setupfiles) are the
appropriate shared setup boundary.

### QA-1.4 Close localization validation correctly

Choose one policy: every locale contains a reviewed translation, or missing
translations explicitly fall back to English and remain reported as incomplete.
Implement key-set parity, placeholder parity, plural/format validation, key
extraction, a fallback test, and contributor instructions.

Exit criteria: source lint, architecture fixtures, extension tests, coverage,
webview tests, localization, type synchronization, and repeat runs are green.

## 8. QA-2 — Dependency and supply-chain hardening

### QA-2.1 Build the shipped dependency inventory

Produce direct, lockfile, production-only, staged-VSIX, runtime-loaded, native
module, integrity/signature, and license inventories. Use pnpm why, pnpm list,
pnpm audit --prod --json, pnpm audit signatures --json, and pnpm sbom where
supported. The [pnpm audit documentation](https://pnpm.io/cli/audit) defines
production/optional scopes and GHSA-based current audit ignores.

### QA-2.2 Triage every advisory by reachability

For tar, undici, protobufjs, uuid, body-parser, brace-expansion, ip-address,
and every newly reported package, record advisory ID, severity, versions,
dependency path, VSIX inclusion, runtime/build reachability, attacker input,
patched-version compatibility, mitigation, owner, expiry, and test evidence.

Upgrade direct dependencies before overrides. If an override is necessary,
test the declared API and actual extension runtime. Never ignore an advisory
merely because it is inconvenient.

### QA-2.3 Add supply-chain controls

Evaluate frozen lockfiles, registry pinning, signatures/provenance, trusted
build scripts, minimum release age, exotic-source blocking, SBOM/license
artifacts, and expiry for exceptions. Use the [pnpm supply-chain
guidance](https://pnpm.io/supply-chain-security) as the reference.

Exit criteria: no unreviewed critical/high advisory exists in a shipped runtime
path, accepted exceptions expire, and the dependency inventory matches the VSIX.

## 9. QA-3 — Native runtime and packaging reproducibility

### QA-3.1 Define the runtime matrix

For every supported target, document operating system/architecture, VS Code and
Electron versions, module ABIs, Node test runtime, native modules, local versus
remote execution, and load/open/migrate/query/write/close/restart checks.

VS Code documents that native modules may need Electron-specific rebuilding and
that remote hosts can use standard Node. Apply the [VS Code native-module
guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions#using-native-node-js-modules)
to the supported-target decision. If remote execution is unsupported, state
that explicitly and fail gracefully.

### QA-3.2 Make native preparation fail closed

Review scripts/download-electron-prebuild.mjs and native rebuild scripts. Add
HTTP failure handling, temporary downloads, checksum or signed verification,
archive traversal protection, expected binding load tests, ABI inspection,
stale-binding invalidation, atomic replacement, finally cleanup, and precise
target/runtime/module errors. Never use an unchecked curl-to-tar pipeline.

### QA-3.3 Make packaging transactional

Build in a clean staging tree and restore the workspace on success or failure.
Verify that the VSIX contains the bundle, webview assets, migrations, protos,
production dependencies, target native binaries, and required metadata. Verify
that it excludes source/tests unless required, credentials, profiles, logs,
coverage, source maps, temporary files, package stores, development tools,
unrelated native binaries, and stale artifacts.

Generate a SHA-256 manifest and inspect both the archive and unpacked runtime.
Use the [VS Code publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for manifest and compatibility verification.

### QA-3.4 Add clean-room acceptance tests

From a fresh temporary workspace: install the frozen lockfile, build the target
VSIX, inspect/hash contents, load the staged extension, initialize/query/write
SQLite, render the webview, start/stop the proxy, verify logs/cleanup, repeat
the build, and compare normalized manifests.

Exit criteria: clean current-target packaging and verification pass, native
modules load under intended runtimes, and failure paths restore the workspace.

## 10. QA-4 — Token and cost correctness audit

This phase protects the project's core purpose and precedes new dashboards or
billing-grade accuracy claims.

### QA-4.1 Define the accounting contract

Document cumulative streaming counters versus per-event deltas,
server-calculated turn-ended usage versus live estimates, token-detail versus
billing rows, context observations versus billable tokens, estimated versus
authoritative cost, missing/partial/replayed/delayed/out-of-order events,
model/pricing identity, currency, and rounding.

Every persisted field needs a unit, time basis, source, confidence, and
deduplication identity. State which totals are billing-grade.

### QA-4.2 Build a golden event corpus

Create redacted fixtures for normal Bidi traffic, multiple turns,
parent/children, cumulative counters and resets, duplicates, missing finals,
turn completion without deltas, partial context, unknown models/prices,
out-of-order timestamps, malformed/truncated JSON/protobuf, authoritative
billing responses, and identity collisions.

Each fixture must define normalized events, persisted rows, token totals, cost
totals, and explicitly tolerated discrepancies.

### QA-4.3 Verify the complete pipeline

Trace fixtures through capture, decoding, insight extraction, classification,
identity, persistence, read projections, pricing, UI/API presentation, and
export. Assert idempotency, no cumulative-counter double counting, no
turn-ended double counting, correct parent linkage, explicit unknown values,
reproducible pricing identity, and atomic read/write behavior.

### QA-4.4 Reconcile authoritative data

Where Cursor provides authoritative usage/billing data, compare redacted
fixtures and controlled sessions. Explain differences caused by rounding,
cached input, hidden/system tokens, unknown pricing, delay, unsupported
endpoints, or local capture loss. Do not call an estimate exact spend without
this reconciliation.

### QA-4.5 Test persistence lifecycle

Cover fresh databases, every migration boundary, interrupted/retried
migrations, corrupt rows, retention, WAL checkpoints, database-size reporting,
disk full, and rollback.

Exit criteria: the accounting contract and golden fixtures pass end-to-end;
unknown, estimated, and authoritative values are distinct; every metric has a
traceable source and confidence level.

## 11. QA-5 — Strict Clean Architecture enforcement

### QA-5.1 Approve one layer matrix

Maintain one matrix for shared kernel, domain, application, infrastructure,
interface adapters, and composition root. For each layer document ownership,
permitted/forbidden dependencies, exceptions and expiry, mapping boundaries,
test style, and required gates.

### QA-5.2 Remove domain/application contract violations

Use Graphify's current edge list as the migration inventory. Classify each
domain-to-application edge, move domain-owned records to domain types/shared
kernel, map transport DTOs at boundaries, narrow broad ports, retain only
necessary compatibility exports, and remove them after a measured window.
Domain must not import VS Code, Node adapters, proxy libraries, SQLite, UI
types, or application transport DTOs.

### QA-5.3 Replace checker blind spots

Implement a resolver-backed import graph using the TypeScript compiler API or
another deterministic resolver. Handle relative/package/workspace imports,
aliases/exports, type-only imports, statically resolvable dynamic imports,
generated boundaries, file/layer cycles, and reviewed exceptions.

The checker must fail on the known domain/application violation and all
negative fixtures, explaining source edge, target edge, rule, and remediation.
The checker itself requires unit and fixture tests.

### QA-5.4 Control coupling hotspots

Use Graphify and Repowise as prioritization signals for ProxyManager,
MitmProxyServer, AccountsPanel/handlers, low-coverage efficiency modules,
and broad DTO/port barrels. Before extracting a seam, write its responsibility,
dependency direction, characterization tests, and composition-root plan.

Exit criteria: no undocumented forbidden edges remain; docs, checker, graph,
and source agree; major hubs have explicit responsibilities and local tests.

## 12. QA-6 — Security and privacy hardening

Use the [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
as a structured checklist adapted to a local extension.

### QA-6.1 Webview and error rendering

Replace error-path innerHTML with text-safe DOM APIs or React. Review CSP,
nonces, resource roots, message origins, external links, and error
serialization. Test attacker-controlled errors, localized strings, malformed
host messages, and unexpected object values.

### QA-6.2 Capture, redaction, and retention

Classify headers, bodies, tokens, profile paths, conversation IDs, model names,
usage totals, and sidecars. For each class specify default collection,
opt-in, pre-persistence redaction, size, retention, deletion, rotation/backup,
partial-error behavior, and user warning.

Test auth headers, cookies, API keys, JSON secrets, binary bodies, symlinks,
traversal, rotation files, disk-full, and partial deletion. Confirm deleted
data cannot remain in sidecars or WAL/backup artifacts contrary to policy.

### QA-6.3 Local API threat model

Decide whether loopback-only binding is sufficient. If not, add a random
per-process capability token shared only with trusted components. Regardless,
bind explicitly to loopback, do not trust forwarded headers without a trusted
proxy, validate IPv4/IPv6/mapped/malformed/missing addresses, protect REST and
WebSocket paths consistently, rate-limit control requests, avoid returning raw
secrets/bodies/headers, and test disconnect/shutdown races.

### QA-6.4 Processes, certificates, and secrets

Review every spawn, fork, shell invocation, argument, environment variable,
certificate path, and log. Use argument arrays, allowlisted executables,
validated paths, timeouts, process-tree cleanup, and redacted diagnostics.
Test spaces, quotes, Unicode, metacharacters, traversal, and trailing
separators. Run historical scanning plus runtime assertions that synthetic
secret values never appear unredacted in logs, exports, errors, records, or VSIX.

Exit criteria: threat decisions are recorded, controls are tested, and residual
risks have owners and acceptance dates.

## 13. QA-7 — Reliability, concurrency, and data lifecycle

### QA-7.1 Multi-window and multi-process behavior

Test two extension hosts/proxy processes against the same database and log
directory. Cover concurrent reads/writes, WAL locks, busy timeout, reopen,
shutdown during transactions, stale state, and process ownership. Assert no
duplicates, lost rows, partial aggregates, or stale PID ownership.

### QA-7.2 Failure injection

Add controlled fakes or hooks for connection failure, migration failure,
malformed schema/SQL, disk full, permission denied, native load failure,
network timeout/truncation, child crash/hang, bind conflict, corrupt
JSONL/protobuf, and cancellation during cleanup/shutdown.

Every failure must have bounded errors, deterministic cleanup, no secret leak,
and clear retry/recovery behavior.

### QA-7.3 Migration and backup safety

For every migration test the previous version and representative older
versions. Verify idempotency, schema validation, rollback, data preservation,
and backup/restore. Do not make destructive migration irreversible without a
documented recovery plan.

### QA-7.4 Retention and disk lifecycle

Define separate policies for SQLite rows, JSONL, sidecars, rotated files,
backups, WAL, and staging. Verify profile scope, cutoff semantics, atomic
dependent deletion, recoverable failures, and disk-full behavior.

Exit criteria: concurrency, failure, migration, and lifecycle tests pass
repeatedly on supported runtimes without silent data loss.

## 14. QA-8 — Local test confidence and hotspot remediation

### QA-8.1 Establish critical-module floors

Keep the global threshold, but add risk-based floors for proxyDecode,
ProxyManager/proxy lifecycle, tokenRefresh, composerDbPoller, ProfileLauncher,
statusBarManager, migrations/native loaders, webview App, host bridge, and
panel handlers. Floors must emphasize malformed input, failure, cancellation,
and cleanup branches rather than only happy paths.

### QA-8.2 Add negative and property-style tests

Use table-driven or property-style tests for identity/event keys,
cumulative-to-delta conversion, redaction/path containment, pricing/rounding,
protocol truncation, port/retry state machines, and retention cutoff/deletion.

### QA-8.3 Keep tests independent

Every test owns its temporary directory, process, connection, timer, mock,
environment, and DOM. Add repeated/shuffled runs for global-state suites. Do
not increase coverage with tests that merely assert implementation details.

Exit criteria: critical modules meet documented floors, negative paths are
covered, webview and host suites are deterministic, and coverage identifies
rather than hides risk.

## 15. QA-9 — Documentation, tooling, and operational readiness

### QA-9.1 Synchronize implementation documentation

Review ARCHITECTURE.md, CLEAN-ARCHITECTURE-PRINCIPLES.md, ADRs, build/native
runtime docs, tokenization/pricing docs, capture/privacy/retention docs,
release/installed-extension instructions, and audit/task-register links.
Every document needs an accurate review date and must not claim a missing
directory, feature flag, dependency, or architecture rule.

### QA-9.2 Make audits reproducible

Create one audit entry point recording tool versions, git SHA, dirty-tree state,
lockfile hash, commands, exit statuses, machine-readable paths, sanitized
summary, and artifact hashes. Required commands must fail the audit when
unavailable unless explicitly optional. Network, packaging, and native failures
must never be hidden behind a successful pipeline.

### QA-9.3 Add release runbooks

Document clean-room install, advisory review, native matrix build, VSIX
inspection, installed smoke test, migration rollback, retention incident,
proxy/certificate failure, and security advisory response.

Exit criteria: a new maintainer can reproduce the audit and release without
local undocumented knowledge.

## 16. QA-10 — Independent final audit and release rehearsal

### QA-10.1 Independent review

Compare original findings, task register, source/dependency graph, tests,
coverage, security controls, VSIX contents, documentation, and exceptions.
Do not accept “the command passed” when the command does not exercise the
relevant runtime or scope.

### QA-10.2 Release-candidate rehearsal

From a clean workspace:

1. install the frozen lockfile;
2. run the complete audit;
3. build each required target;
4. verify native modules and VSIX contents;
5. install the current-target VSIX in a clean extension host;
6. initialize and query tracking persistence;
7. capture a redacted fixture or controlled session;
8. verify metrics, costs, UI, logs, cleanup, and shutdown;
9. repeat after restart;
10. archive hashes, outputs, and decisions.

### QA-10.3 Final acceptance checklist

Complete only when no unreviewed critical/high shipped advisory remains, all
supported packaging targets pass from clean staging, native modules load under
intended ABIs, golden token/cost fixtures pass, domain/application violations
are gone or approved, the resolver-backed checker and negative fixtures pass,
all tests/localization/coverage gates pass repeatedly, security and retention
controls are documented and tested, reliability tests pass, docs match source,
every finding has a current classification, and the final artifact/evidence
bundle is reproducible from the recorded SHA.

## 17. Commit, push, and rollback protocol

For every implementation package: update the task register, capture the
baseline, implement one bounded change, run focused and required full gates,
update English evidence, inspect diff/status, commit with the task ID, push,
wait for the applicable workflow, and record the result.

If a pushed change fails, do not stack unrelated work. Diagnose, make the
smallest corrective commit, rerun gates, and retain failed evidence. If it
cannot be repaired safely, revert through a new explicit commit or reviewed
patch; never rewrite shared history destructively.

## 18. Required evidence bundle

The final evidence bundle must contain git SHA and clean-tree output; tool
versions; frozen-install result; architecture and fixture results; lint/type/
localization/type-sync results; repeated extension/webview tests; coverage and
critical floors; audit/signature/SBOM/license/exception artifacts; Graphify and
Repowise reports; golden metrics/cost report; migration/concurrency/failure/
retention reports; native ABI results; VSIX manifest, contents and hashes;
staged runtime smoke tests; final security review; and final finding
classification.

## 19. External references

- [pnpm audit](https://pnpm.io/cli/audit)
- [pnpm supply-chain security](https://pnpm.io/supply-chain-security)
- [Node-API and native ABI stability](https://nodejs.org/api/n-api.html)
- [VS Code native modules in remote extension hosts](https://code.visualstudio.com/api/advanced-topics/remote-extensions#using-native-node-js-modules)
- [VS Code extension publishing and compatibility](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Vitest setup files](https://main.vitest.dev/config/setupfiles)
- [React Testing Library cleanup](https://testing-library.com/docs/react-testing-library/api/#cleanup)
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)

These references are guidance, not substitutes for repository-specific tests
and runtime evidence.
