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
- The lockfile was regenerated with pnpm's existing Electron subdependency
  compatibility setting and remains frozen-install compatible.

## Remaining findings and decisions

The 2026-08-25 baseline reports 1 critical, 15 high, 13 moderate, and 3 low
advisories across 240 production and optional dependency entries. Registry
signature verification reports 852 verified packages with no invalid or
missing signatures. These results do not close any advisory; shipped-VSIX
reachability and runtime exposure still require the QA-2 inventory.

| Package | Current path | Severity | Decision |
| --- | --- | --- | --- |
| `tar@6.2.1` | `sqlite3 -> node-gyp` and `@cursor/sdk -> sqlite3` | Critical/high/moderate | Open. The patched releases are `7.x`, outside the dependency range declared by `sqlite3@5.1.7`; no major override is allowed without testing native installation and runtime packaging. |
| `undici@5.29.0` | `@cursor/sdk -> @connectrpc/connect-node@1.7.0` | High/moderate | Open. Upgrading to `undici@6` or Connect RPC `2.x` requires compatibility validation of the SDK and generated clients; no blind override. |
| `uuid@9.0.1` | `http-mitm-proxy` | Moderate | Open. The library is transitive and the patched major is `11.x`; assess replacement or an upstream-compatible upgrade before changing it. |
| `@tootallnate/once@1.1.2`, `ip-address@10.2.0`, `brace-expansion@1.1.15` | `sqlite3 -> node-gyp` optional paths | Low/high | Open. These are native-install tooling paths; verify whether they can be excluded from shipped production dependencies and whether safe range-compatible updates exist. |

## Required closure evidence

The remaining entries may be closed only with one of:

1. a compatible upstream or range-safe update, followed by compile, native
   rebuild, tests, and VSIX verification;
2. proof that the path is build-only and absent from the shipped VSIX, with a
   documented residual risk and CI check preventing accidental inclusion; or
3. a reviewed risk acceptance with owner, expiry date, affected paths, and a
   tracked upstream issue.

No `pnpm.overrides` entry may be added for a major-version change without this
evidence.
