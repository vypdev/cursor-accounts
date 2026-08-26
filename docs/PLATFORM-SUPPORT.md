# Platform Support

Platform compatibility and SQLite binary details for reading Cursor's `state.vscdb`.

## Supported platforms

This extension includes pre-compiled SQLite 3.53.1 binaries for all supported platforms:

- macOS Intel (`darwin-x64`) and Apple Silicon (`darwin-arm64`)
- Linux x64 (`linux-x64`) and ARM64 (`linux-arm64`)
- Windows x64 (`win32-x64`) and ARM64 (`win32-arm64`)

No additional installation or configuration required.

## Runtime and packaging matrix

Platform support has two independent parts: the bundled SQLite CLI must match
the target operating system and architecture, and the `better-sqlite3` native
binding must match the Electron runtime used by the VS Code extension host.
The build downloads the official `better-sqlite3` Electron prebuild for the
requested target and verifies its release digest, so packaging can prepare a
target binding on a different host. The final target runner remains required
for an executable smoke test and release acceptance.

The release workflows are configured with this target matrix:

| Target | Release runner | Local evidence in the current audit | Matrix gate |
| --- | --- | --- | --- |
| `darwin-arm64` | Self-hosted macOS ARM64 | Build, VSIX contents, SQLite binary, and Electron ABI 128 binding verified | Required before release |
| `darwin-x64` | Self-hosted macOS x64 | Not executed on this host | Required before release |
| `linux-x64` | Self-hosted Linux x64 | Not executed on this host | Required before release |
| `linux-arm64` | `ubuntu-24.04-arm` | Cross-packaged on macOS; target binding and VSIX contents verified, executable smoke test pending | Required before release |
| `win32-x64` | Self-hosted Windows x64 | Not executed on this host | Required before release |
| `win32-arm64` | Self-hosted Windows x64 | Not executed on this host | Required before release |

The CI test matrix currently covers Linux x64, macOS ARM64, macOS x64, and
Windows x64. The release matrix is the authoritative packaging gate for all
six targets. A target must not be described as independently verified until
its runner has completed dependency installation, native preparation, binary
verification, target packaging, and VSIX verification.

Every CI and release packaging job also runs `pnpm run verify:toolchain` after
Node and pnpm setup. This fails closed unless the active runtime is Node 24.x
and the active package manager is the exact version declared by
`package.json#packageManager`.

The minimum target validation sequence is:

```bash
pnpm run verify:toolchain
bash scripts/verify-binaries.sh
pnpm run build -- --target <target>
VSIX_FILE="cursor-accounts-<target>-<version>.vsix" pnpm run verify:vsix
```

The build verifier must confirm the target SDK package, runtime dependency
closure, Electron native binding, migrations, webview bundle, and absence of
development artifacts or package-manager stores. A successful host build does
not substitute for the target runner gate.

## SQLite binaries

The extension reads Cursor's local `state.vscdb` database to obtain authentication tokens. Because the database may be locked while Cursor is running, the extension copies it to a temp file using bundled SQLite CLI binaries located in `bin/`.

| Platform | Binary path |
|----------|-------------|
| macOS Intel | `bin/darwin-x64/sqlite3` |
| macOS Apple Silicon | `bin/darwin-arm64/sqlite3` |
| Linux x64 | `bin/linux-x64/sqlite3` |
| Linux ARM64 | `bin/linux-arm64/sqlite3` |
| Windows x64 | `bin/win32-x64/sqlite3.exe` |
| Windows ARM64 | `bin/win32-arm64/sqlite3.exe` |

## Building Linux ARM64 binaries

SQLite does not provide official precompiled CLI binaries for Linux ARM64. To regenerate:

```bash
docker run --rm --platform linux/arm64 -v "$PWD:/project" -w /project ubuntu:24.04 \
  bash -c 'apt-get update && apt-get install -y build-essential curl file && bash scripts/build-linux-arm64-sqlite.sh'
```

## Binary verification

Validate all bundled binaries with:

```bash
bash scripts/verify-binaries.sh
```

## Platform-specific notes

### Cursor-only

Built for Cursor; standard VS Code may lack `state.vscdb` auth keys. See [RESEARCH.md](RESEARCH.md) for VS Code / Cursor extension API limits.

### macOS

Profile launch uses `open -na "/Applications/Cursor.app" --args --user-data-dir=...`. See [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) for multi-profile launch details.

## Related documentation

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) — how `state.vscdb` is read
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — DB read error resolution
- [CONTRIBUTING.md](../CONTRIBUTING.md) — development setup
