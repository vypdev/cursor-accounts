# Production Dependency Advisory Register

Last reviewed: 2026-08-25

## Scope

This register records the production audit after the lockfile refresh. The
audit includes optional native-build dependency paths because pnpm reports
them under production dependencies. A dependency is not considered resolved
just because the vulnerable package is absent from the final VSIX; the build
and packaging path must also be reviewed.

## Remediated in this slice

- `body-parser` is forced to `1.20.6`, the patched version required by the
  current Express `4.x` dependency range.
- `protobufjs` now requests `^7.6.5`, which removes the advisory affecting the
  previously resolved `7.6.3` package.
- `@cursor/sdk` is upgraded to `^1.0.28`; the published SDK requires Node
  `>=22.13`, which is compatible with the project baseline `Node 22.23.1`, and
  no longer declares `sqlite3`.
- The unused root `sqlite3` dependency and its native rebuild/package checks
  are removed. Persistence uses `better-sqlite3`; the platform `bin/<target>/sqlite3`
  executable is a separate CLI artifact.

## Remaining findings and decisions

The pre-remediation 2026-08-25 baseline reported 1 critical, 15 high, 13
moderate, and 3 low advisories across 240 production and optional dependency
entries. After the SDK upgrade, removal of the unused `sqlite3` dependency, and
the targeted `uuid` and `undici` overrides, the current `pnpm audit --prod`
reports zero advisory records. Registry signature verification reports 852
verified packages with no invalid or missing signatures in the immutable
baseline. The current post-remediation check reports 830 verified packages,
with zero invalid and zero missing signatures.

| Package | Current path | Severity | Decision |
| --- | --- | --- | --- |
| `undici@5.29.0` | Development-tooling branch only; excluded from the production closure and current VSIX runtime tree | Informational | Retained outside the production graph; revisit when tooling is upgraded. |
| `uuid@11.1.1` override | `http-mitm-proxy` declares `^9.0.1` and imports only the named `v4` export | Resolved with evidence | Runtime import, proxy audit, production audit, and current VSIX verification pass. Keep the override covered by regression tests. |
| `undici@6.28.0` override | `@connectrpc/connect-node@1.7.0` declares `^5.28.4`; source inspection finds no runtime import | Resolved with evidence | SDK load, production audit, and current VSIX verification pass. Keep the override covered by clean-room compatibility tests. |

## Required closure evidence

The remaining entries may be closed only with one of:

1. a compatible upstream or range-safe update, followed by compile, native
   rebuild, tests, and VSIX verification;
2. proof that the path is build-only and absent from the shipped VSIX, with a
   documented residual risk and CI check preventing accidental inclusion; or
3. a reviewed risk acceptance with owner, expiry date, affected paths, and a
   tracked upstream issue.

No additional `pnpm.overrides` entry may be added for a major-version change
without equivalent compatibility evidence. The clean-room and supported-target
matrix checks remain open under QA-2 and QA-3.
