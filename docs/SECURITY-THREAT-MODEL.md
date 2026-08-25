# Local Proxy Security and Privacy Threat Model

This document records the security decisions for the optional local MITM
proxy, its control API, captured traffic, and usage persistence. It is an
active review record, not a claim that every residual risk has been removed.

**Last reviewed:** 2026-08-25
**Scope:** extension host, proxy child process, localhost HTTP/WebSocket API,
proxy JSONL logs, body sidecars, proxy state, SQLite usage data, certificates,
and VS Code webview messages.

## Security objectives

1. Do not expose captured credentials or arbitrary request bodies through
   headers, diagnostics, API responses, UI errors, or persisted records.
2. Restrict proxy control and event streaming to the local machine and the
   owning extension processes.
3. Keep captured data opt-in, bounded, deletable, and isolated from unrelated
   files.
4. Make failures safe: malformed input, missing sidecars, disk errors, and
   disconnected clients must not grant access or corrupt accounting data.
5. Keep certificates, capability tokens, and profile paths under validated
   user-owned locations with least-privilege file modes.

## Assets and collection policy

| Asset | Collection/storage decision | Current control |
|---|---|---|
| Authorization headers, cookies, API keys, refresh/access tokens | Never persist in header maps or JSON bodies in clear text | Header and JSON-key redaction before log persistence; state file is written with mode `0600` |
| Proxy request/response bodies | JSONL logging is a development/diagnostic opt-in; body size is bounded and large bodies use a `bodies/` sidecar | Inline byte limit, bounded rotation, pre-persistence JSON redaction, safe relative sidecar resolution |
| Token counts, model identifiers, and cost totals | Persisted for usage metrics; these are treated as sensitive telemetry but not credentials | SQLite ownership, replay/idempotency rules, no raw body in API traffic events |
| Profile paths and conversation IDs | Used for routing and correlation; do not return from unauthenticated control paths | Validated configuration/state paths and token-protected control plane |
| Capability token | Required by the production configuration builder and persisted only in the local proxy state file | Random 32-byte token, minimum length validation, constant-time comparison, `0600` state file |
| Generated CA key/certificate | Required only for the user-enabled MITM operation | Managed certificate directory and explicit installation/uninstallation flows |

Raw captured bodies are not a default product telemetry stream. Users enabling
JSONL diagnostics must treat the configured log directory as sensitive local
data and use the explicit cleanup command.

## Threat decisions

### T1 — Another local process calls the control API

Decision: bind HTTP to `127.0.0.1`, reject non-loopback socket addresses, do
not trust `X-Forwarded-For`, and require the per-process Bearer capability token
when one is configured. Apply the same checks to REST and WebSocket upgrades.
Malformed, missing, IPv4-mapped, and non-loopback addresses are covered by
validator tests; the API body parser is limited to 256 KiB.

Residual decision: the server type retains an optional token for legacy
bootstrap/test callers, while the production configuration builder always
generates one and proxy configuration validation enforces a minimum length when
present. Removing the optional legacy path is a separate compatibility change.

### T2 — Error responses disclose secrets or filesystem details

Decision: the API error middleware returns only `Proxy API request failed`.
Raw exception details remain in the trusted child-process diagnostic path and
are not serialized to HTTP clients. The regression test passes a synthetic
secret and verifies it is absent from the response.

### T3 — Captured headers or JSON bodies contain credentials

Decision: redact sensitive header names and recursively redact known sensitive
JSON keys before persistence. Binary/protobuf bodies are not assumed to be
safe JSON and are treated as sensitive sidecars; decoded traffic events omit
`bodyDecoded` before broadcast.

Residual risk: arbitrary secrets in protobuf or unrecognized JSON fields cannot
be proven redacted by key matching alone. Diagnostic capture remains opt-in;
protocol-specific redaction and a metadata-only default are tracked in QA-6.

### T4 — Sidecar traversal or symlink escape reads/writes unrelated files

Decision: sidecar keys are allowlisted, absolute paths and `..` traversal are
rejected, and reads verify both lexical and realpath containment beneath the
log directory. Cleanup only deletes recognized proxy JSONL files and `.bin`
sidecars, leaving unrelated files and directories untouched.

### T5 — Log growth exhausts disk or leaves stale sensitive artifacts

Decision: JSONL rotation and body pruning enforce a configured total-size cap;
explicit cleanup removes recognized logs and sidecars. Existing tests cover
rotation and selective cleanup.

Residual risk: disk-full and partial-deletion behavior, restore automation,
long-lived-reader checkpoint starvation, and crash recovery require dedicated
failure-injection tests in QA-6/QA-7 before this threat is closed. Deep-clean
now uses SQLite `VACUUM INTO` for a consistent snapshot, and efficiency-database
recreation preserves the main file together with its `-wal`/`-shm` sidecars.

### T6 — Webview or API renders attacker-controlled text as markup

Decision: webview boot errors use `textContent`; host HTML uses a fixed template
and escaped serialized localization values. API errors are JSON text, not HTML.
Unknown webview messages are validated at the message boundary.

## Verification matrix

| Control | Evidence |
|---|---|
| Loopback and forwarded-header rejection | `src/test/proxy/api/localhostValidator.test.ts` |
| REST and WebSocket token parity | `src/test/proxy/api/proxyApiServer.test.ts` |
| Safe API error serialization | `src/test/proxy/api/errorHandler.test.ts` |
| Header/body redaction | `src/test/requestLogger.test.ts`, `src/test/bodyCapture.test.ts` |
| Sidecar traversal/symlink safety | `src/test/bodyCapture.test.ts`, `src/test/proxyLogCleanup.test.ts` |
| History secret scan | `repowise security scan --history --format json` — zero findings on 213 commits, 4,536 blobs, and 2,576 files on 2026-08-25 |
| SQLite snapshot and sidecar recovery | `src/test/storageCleanupService.full.test.ts`, `src/test/persistence/efficiencyDatabase.test.ts` |
| Full regression gates | `CI=true npx --yes pnpm@10.34.0 run audit` |

## Open actions

1. Add disk-full, partial deletion, restore, long-lived-reader checkpoint, and crash-restart tests.
2. Decide whether production should make the capability token mandatory in the
   server schema and remove the legacy optional path.
3. Evaluate metadata-only capture as the default and document explicit user
   consent for raw body diagnostics.
4. Review every process/certificate diagnostic for secret/path redaction and
   add synthetic-secret assertions.

These actions keep the current controls explicit while preventing the residual
risks from being hidden behind a generic “secure” label.
