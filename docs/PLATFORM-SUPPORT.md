# Platform Support

Platform compatibility and SQLite binary details for reading Cursor's `state.vscdb`.

## Supported platforms

This extension includes pre-compiled SQLite 3.53.1 binaries for all supported platforms:

- macOS Intel (`darwin-x64`) and Apple Silicon (`darwin-arm64`)
- Linux x64 (`linux-x64`) and ARM64 (`linux-arm64`)
- Windows x64 (`win32-x64`) and ARM64 (`win32-arm64`)

No additional installation or configuration required.

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
