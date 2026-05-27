#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPECTED_VERSION="3.53.1"

TARGETS=(
  "darwin-arm64:Mach-O.*arm64:sqlite3"
  "darwin-x64:Mach-O.*x86_64:sqlite3"
  "linux-x64:ELF.*x86-64:sqlite3"
  "linux-arm64:ELF.*aarch64:sqlite3"
  "win32-x64:PE32\\+ executable \\(console\\) x86-64:sqlite3.exe"
  "win32-arm64:PE32\\+ executable \\(console\\) Aarch64:sqlite3.exe"
)

can_run_version() {
  local target="$1"
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "${target}" in
    darwin-arm64) [[ "${os}" == "Darwin" && "${arch}" == "arm64" ]] ;;
    darwin-x64) [[ "${os}" == "Darwin" && "${arch}" == "x86_64" ]] ;;
    linux-x64) [[ "${os}" == "Linux" && "${arch}" == "x86_64" ]] ;;
    linux-arm64) [[ "${os}" == "Linux" && "${arch}" == "aarch64" ]] ;;
    win32-*) [[ "${os}" == MINGW* || "${os}" == MSYS* || "${OS:-}" == Windows_NT ]] ;;
    *) return 1 ;;
  esac
}

err=0

for entry in "${TARGETS[@]}"; do
  IFS=':' read -r target pattern binary_name <<< "${entry}"
  binary="${ROOT}/bin/${target}/${binary_name}"

  if [[ ! -f "${binary}" ]]; then
    echo "Missing binary: ${binary}"
    err=1
    continue
  fi

  if ! file "${binary}" | grep -Eq "${pattern}"; then
    echo "Unexpected architecture for ${binary}:"
    file "${binary}"
    err=1
    continue
  fi

  if can_run_version "${target}"; then
    actual_version="$("${binary}" --version | awk '{print $1}')"
    if [[ "${actual_version}" != "${EXPECTED_VERSION}" ]]; then
      echo "Expected SQLite ${EXPECTED_VERSION} for ${binary}, got ${actual_version}"
      err=1
      continue
    fi
    echo "OK ${target} (SQLite ${actual_version})"
  else
    echo "OK ${target} (architecture verified)"
  fi
done

[[ ${err} -eq 0 ]] || exit 1
echo "All bundled SQLite binaries verified."
