#!/bin/bash
set -euo pipefail

SQLITE_VERSION="3530100"
SQLITE_TAR="sqlite-autoconf-${SQLITE_VERSION}.tar.gz"
SQLITE_URL="https://www.sqlite.org/2026/${SQLITE_TAR}"
EXPECTED_VERSION="3.53.1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${ROOT}/bin/linux-arm64/sqlite3"
BUILD_DIR="${ROOT}/.tmp/sqlite-build-linux-arm64"

if [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != "arm64" ]]; then
  echo "Warning: not running on ARM64 ($(uname -m)). Use Docker with --platform linux/arm64 for a compatible binary."
fi

command -v gcc >/dev/null || { echo "gcc is required (install build-essential)"; exit 1; }
command -v make >/dev/null || { echo "make is required (install build-essential)"; exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}" "${ROOT}/bin/linux-arm64"

echo "Downloading SQLite ${EXPECTED_VERSION} source..."
curl -fsSL "${SQLITE_URL}" -o "${BUILD_DIR}/${SQLITE_TAR}"
tar -xzf "${BUILD_DIR}/${SQLITE_TAR}" -C "${BUILD_DIR}"
SRC_DIR="${BUILD_DIR}/sqlite-autoconf-${SQLITE_VERSION}"

echo "Building sqlite3 for linux-arm64..."
(
  cd "${SRC_DIR}"
  ./configure --disable-shared CFLAGS="-Os"
  make sqlite3
)

cp "${SRC_DIR}/sqlite3" "${OUTPUT}"
chmod +x "${OUTPUT}"

echo "Verifying ${OUTPUT}..."
file "${OUTPUT}" | grep -q 'aarch64\|ARM aarch64'
ACTUAL_VERSION="$("${OUTPUT}" --version | awk '{print $1}')"
if [[ "${ACTUAL_VERSION}" != "${EXPECTED_VERSION}" ]]; then
  echo "Expected SQLite ${EXPECTED_VERSION}, got ${ACTUAL_VERSION}"
  exit 1
fi

echo "Built ${OUTPUT} (SQLite ${ACTUAL_VERSION})"
