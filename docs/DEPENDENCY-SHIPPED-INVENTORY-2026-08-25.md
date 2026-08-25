# Dependency and Shipped-Artifact Inventory — 2026-08-25

## Purpose

This document freezes the dependency and package-content baseline before any dependency remediation or packaging changes. It is intentionally evidence-oriented: a future change is acceptable only when the same inventory commands can be repeated and the resulting runtime, security, native-module, and VSIX checks remain green.

## Repository dependency graph

The lockfile currently resolves 240 production and optional dependency entries. The relevant direct/runtime packages are:

| Package | Declared range or version | Resolved baseline | Role | Current remediation concern |
| --- | --- | --- | --- | --- |
| `@cursor/sdk` | `^1.0.15` | `1.0.18` | Cursor agent event/runtime integration | Brings `@connectrpc/connect-node` and `undici@5.29.0`; latest published SDK requires Node `>=22.13`. |
| `sqlite3` | `5.1.7` | `5.1.7` | Cursor SDK and local persistence integration | Brings `node-gyp@8.4.1` and `tar@6.2.1`; native runtime and Electron compatibility must remain proven. |
| `http-mitm-proxy` | `^1.1.0` | `1.1.0` | HTTPS interception and proxy lifecycle | Brings `uuid@9.0.1`; upstream package has had no release for approximately three years. |
| `better-sqlite3` | `12.9.0` | `12.9.0` | Application persistence | Native module; Electron ABI and clean-room packaging are release gates. |
| `protobufjs` | `^7.6.5` | lockfile-resolved | Protobuf decoding | Previously remediated to a patched range; must remain covered by audit and decode tests. |

## Advisory paths

The baseline `pnpm audit --prod` reported 1 critical, 15 high, 13 moderate, and 3 low advisories across the production graph. The affected package paths were inspected with `pnpm why`:

| Package family | Resolved vulnerable version(s) | Representative path | Classification |
| --- | --- | --- | --- |
| `tar` | `6.2.1` | `sqlite3 -> node-gyp -> make-fetch-happen -> cacache -> tar` | Runtime dependency path; must be remediated or explicitly risk-accepted with evidence. |
| `undici` | `5.29.0` | `@cursor/sdk -> @connectrpc/connect-node -> undici` | Runtime dependency path; SDK upgrade is the first compatibility candidate. |
| `uuid` | `9.0.1` | `http-mitm-proxy -> uuid` | Runtime dependency path; replacement or upstream remediation requires proxy regression tests. |
| `brace-expansion` | `1.1.15` | development tooling and transitive `node-gyp` paths | Primarily tooling, but it is present in the shipped dependency tree unless packaging excludes it. |
| `ip-address` | `10.2.0` | `sqlite3 -> node-gyp -> socks -> ip-address` | Native-build tooling path; still tracked because the package tree is currently bundled into the VSIX. |
| `@tootallnate/once` | `1.1.2` | `sqlite3 -> node-gyp -> make-fetch-happen -> http-proxy-agent` | Native-build tooling path; must not be shipped as runtime content. |

The same graph also contains patched versions of some of these packages through unrelated tooling branches. A green audit therefore cannot be inferred from the presence of one patched version; every shipped path must be checked.

## Signature and SBOM baseline

- `pnpm audit signatures --json`: 852 packages audited, 852 signatures verified, 0 invalid signatures, and 0 missing signatures.
- `pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.5 --prod --out <temporary-output>` generated four workspace SBOMs for the root, shared package, types package, and webview package.
- The SBOM is currently generated as a temporary evidence artifact. A later QA-2 task must decide whether CI should persist a sanitized SBOM as a release artifact without committing generated dependency data to the source tree.

## Current VSIX content

The newest repository artifact is:

| Artifact | SHA-256 | Size | Verification |
| --- | --- | ---: | --- |
| `cursor-accounts-darwin-arm64-0.1.34.vsix` | `f624db462285ad60d0ae2495645d43290cf996811772fb167811da423f0276a1` | 47 MiB | `pnpm run verify:vsix` passes for the selected artifact. |

The artifact contains 3,754 ZIP entries and includes:

- the compiled extension output and webview bundle;
- `extension/bin/darwin-arm64/sqlite3`;
- production `node_modules`, including `@cursor/sdk`, `sqlite3`, `http-mitm-proxy`, and `node-forge`;
- a large `.pnpm` dependency tree that currently includes build-tool packages such as `tar`, `undici`, `uuid`, `ip-address`, and `@tootallnate/once`.

This is a release-quality concern: development and native-build dependencies are present in the VSIX even though the verifier rejects selected test/documentation directories. QA-3 must either prove that these packages are required at runtime or change packaging to ship only the runtime closure.

## Native-module baseline

- Node runtime: `v22.23.1`.
- Node module ABI: `127`.
- Runtime native verification is performed by `scripts/verify-native-sqlite.mjs`.
- Electron native preparation uses the Electron version resolved from the project’s VS Code target and must be validated against the actual Electron ABI, not only the platform name.
- The currently checked-in prebuild flow is fail-closed on download, extraction, and binding presence, but does not yet provide a cryptographic checksum or an explicit ABI assertion. These remain QA-3 tasks.

## Reproduction commands

Run from the repository root:

```bash
pnpm audit --prod
pnpm audit signatures --json
pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.5 --prod --out /tmp/cursor-accounts-prod-sbom-%s.json
pnpm why tar --recursive
pnpm why undici --recursive
pnpm why uuid --recursive
pnpm why brace-expansion --recursive
pnpm why ip-address --recursive
pnpm why @tootallnate/once --recursive
VSIX_FILE=cursor-accounts-darwin-arm64-0.1.34.vsix pnpm run verify:vsix
```

`pnpm why` may need to run with access to the local pnpm store when the execution sandbox cannot open its SQLite index. That is an environment permission issue, not a project result, and must be recorded with the command evidence.

## Baseline decision

No dependency version is changed by this inventory. The next implementation slice is to establish a safe remediation matrix: direct upgrade candidates, API/engine compatibility, native rebuild requirements, package-size impact, and regression gates. An advisory is not considered resolved until the lockfile, production audit, shipped-artifact scan, native verification, and full test/audit workflow agree.
