#!/bin/bash
set -e

source "$(dirname "$0")/ensure-node.sh"

echo "Installing dependencies..."
pnpm install --frozen-lockfile

echo "Verifying platform binaries..."
echo ""
echo "@cursor/sdk platform packages:"
ls -d node_modules/@cursor/sdk-* 2>/dev/null || echo "  ⚠️  Not found"

echo ""
echo "✓ Ready to package!"
