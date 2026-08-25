# Supply-Chain Evidence — 2026-08-25

This document records reproducible dependency-security, SBOM, and production
license evidence for the current lockfile. Generated reports were written to
temporary files and were not committed because they are derived from the
lockfile and may contain registry metadata that should not become source-tree
noise.

## Reviewed toolchains

| Purpose | Toolchain | Repository mutation |
| --- | --- | --- |
| Project install and advisory audit | Node 24.19.0 + pnpm 10.34.0 | None; clean external pnpm store |
| Registry signature audit | Node 24.19.0 + isolated pnpm 11.19.0 | None; `pnpm with current` bypasses the project pin for one invocation |
| Lockfile-only SBOM | Node 24.19.0 + isolated pnpm 11.19.0 | None; temporary CycloneDX file |
| Production license inventory | Node 24.19.0 + pnpm 10.34.0 | None; clean external pnpm store |

The project remains pinned to pnpm 10.34.0. pnpm documents `pnpm with` as a
single-invocation mechanism that ignores the project package-manager pin;
therefore the pnpm 11 utility is an explicitly isolated auditor, not a change
to the build toolchain. See the [pnpm with documentation](https://pnpm.io/11.x/cli/with).

## Results

### Production advisory audit

The pinned project toolchain reported zero production advisory records with
`pnpm audit --prod --json`. This is the security-advisory result; it does not
substitute for signatures, SBOM generation, or license review. See the
[pnpm 10 audit documentation](https://pnpm.io/10.x/cli/audit).

### Registry signatures

The isolated pnpm 11.19.0 auditor ran:

```text
pnpm with current audit signatures --prod --json
```

Result:

```json
{
  "audited": 163,
  "invalid": [],
  "missing": [],
  "verified": 163
}
```

This is evidence for the current production graph only. It must be repeated
after lockfile or dependency changes.

### CycloneDX SBOM

The isolated pnpm 11.19.0 auditor generated a lockfile-only CycloneDX 1.5
report with:

- `bomFormat`: `CycloneDX`;
- `specVersion`: `1.5`;
- `components`: `163`;
- metadata component: `cursor-accounts`.

The report was generated with `--prod --lockfile-only`, so it describes the
resolved production lockfile graph and deliberately does not prove the final
VSIX contents. pnpm documents SBOM generation as a pnpm 11 feature in the
[pnpm SBOM documentation](https://pnpm.io/11.x/cli/sbom).

### Automated evidence collection

The repository now exposes the reproducible command:

```text
pnpm run audit:supply-chain -- --output .tmp/supply-chain-report.json
```

The command first enforces the Node 24/pnpm 10 project contract, then runs the
production advisory and license checks with the pinned toolchain. It installs
pnpm 11.19.0 into a temporary directory for the signature and SBOM commands,
removes that directory in a `finally` block, and writes only the summarized
evidence report to the requested path. The generated report is ignored by Git
because it is derived evidence rather than source material.

Pull-request CI, release preparation, and hotfix preparation execute this
command and upload the report as a short-lived workflow artifact with a
14-day retention period. The retention period is an operational default, not
the final compliance policy; QA-2 remains open until the repository owner
decides whether release SBOMs must be retained longer or attached to releases.

### Production license inventory

The pinned pnpm 10.34.0 toolchain installed the lockfile into an empty external
store and ran `pnpm licenses list --prod --json`. The result contained:

- `157` production package records;
- `10` license groups;
- `2` packages whose installed package metadata does not expose a normalized
  SPDX license: `@cursor/sdk@1.0.28` and `semaphore@1.1.0`.

Observed license groups were:

```text
(Apache-2.0 AND BSD-3-Clause)
(BSD-2-Clause OR MIT OR Apache-2.0)
(BSD-3-Clause OR GPL-2.0)
(MIT OR WTFPL)
Apache-2.0
BSD-3-Clause
ISC
MIT
SEE LICENSE IN LICENSE.md
Unknown
```

The metadata gaps were investigated against the published package sources:

- `@cursor/sdk@1.0.28` ships `LICENSE.md` stating that use is subject to
  Cursor's Terms of Service. The [published npm package](https://www.npmjs.com/package/%40cursor/sdk)
  identifies it as `SEE LICENSE IN LICENSE.md`, not as an SPDX open-source
  license. This requires an explicit vendor-terms and redistribution review.
- `semaphore@1.1.0` omits a `license` field from `package.json`, while its
  README contains an MIT notice. The [published npm package](https://www.npmjs.com/package/semaphore?activeTab=readme)
  exposes the same metadata/readme mismatch. This requires a reviewed MIT
  attribution decision or replacement before release closure.

No permissive-license assumption is made from the package name or registry
sidebar alone. The authoritative terms and the final third-party attribution
policy must be recorded before QA-2 can be marked complete.

## Acceptance status

- Production advisories: passed for the current lockfile.
- Registry signatures: passed for the current production graph with the
  isolated pnpm 11.19.0 auditor.
- SBOM: generated and structurally inspected; release-artifact retention is a
  separate policy decision; automated workflow collection is implemented with
  a 14-day default retention.
- License compliance: open until the Cursor vendor terms and semaphore MIT
  attribution are explicitly reviewed and recorded.
- Shipped VSIX closure: governed separately by the runtime-tree and VSIX
  verifier evidence in
  [DEPENDENCY-SHIPPED-INVENTORY-2026-08-25.md](DEPENDENCY-SHIPPED-INVENTORY-2026-08-25.md).

## Reproduction policy

Run the project install, advisory, and license commands with Node 24 and pnpm
10.34.0. Use an explicitly isolated pnpm 11.19.0 auditor only for commands
that do not exist in pnpm 10, and never change `package.json#packageManager`
to make that auditor run. Keep all stores and generated reports outside the
repository checkout.
