#!/bin/bash
set -e

source "$(dirname "$0")/ensure-node.sh"

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Building sqlite3 native binding for $(node -v)…"
npm rebuild sqlite3

echo "Verifying platform binaries..."
echo ""
echo "@cursor/sdk platform packages:"
ls -d node_modules/@cursor/sdk-* 2>/dev/null || echo "  ⚠️  Not found"

echo ""
echo "sqlite3 native binding:"
if [ -f node_modules/sqlite3/build/Release/node_sqlite3.node ]; then
  ls -lh node_modules/sqlite3/build/Release/node_sqlite3.node
else
  echo "  ❌ node_modules/sqlite3/build/Release/node_sqlite3.node not found"
  exit 1
fi

echo ""
echo "✓ Ready to package!"
