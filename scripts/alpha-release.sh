#!/bin/bash
# Alpha release preparation script
# Builds VSIX with better-sqlite3 and verifies binaries

set -e

echo "🚀 Preparing Alpha Release for better-sqlite3 migration"
echo ""

# Check if on correct branch (optional, adjust as needed)
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 Current branch: $CURRENT_BRANCH"
echo ""

# Verify feature flag is still opt-in (default: false)
echo "🔍 Verifying feature flag is opt-in..."
FLAG_DEFAULT=$(grep -A 2 "useBetterSqlite3" package.json | grep "default" | grep -o "false\|true")
if [ "$FLAG_DEFAULT" != "false" ]; then
  echo "❌ ERROR: Feature flag default should be 'false' for alpha!"
  echo "   Current value: $FLAG_DEFAULT"
  echo "   Edit package.json before proceeding."
  exit 1
fi
echo "✅ Feature flag is opt-in (default: false)"
echo ""

# Clean build
echo "🧹 Cleaning previous builds..."
rm -rf out webview-dist node_modules/.cache
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile
echo ""

# Rebuild native modules for Electron
echo "🔨 Rebuilding native modules for Electron..."
pnpm run rebuild:native
echo ""

# Verify better-sqlite3 binding exists
BETTER_SQLITE_BINDING="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ ! -f "$BETTER_SQLITE_BINDING" ]; then
  echo "❌ ERROR: better-sqlite3 binding not found: $BETTER_SQLITE_BINDING"
  exit 1
fi
echo "✅ better-sqlite3 binding verified"
echo ""

# Compile TypeScript
echo "🏗️  Compiling TypeScript..."
pnpm run pretest
echo ""

# Build VSIX for current platform
echo "📦 Building VSIX..."
pnpm run build:current
echo ""

# Find the built VSIX
VSIX_FILE=$(ls -t *.vsix | head -1)
if [ -z "$VSIX_FILE" ]; then
  echo "❌ ERROR: No VSIX file found!"
  exit 1
fi
echo "✅ Built: $VSIX_FILE"
echo ""

# Verify VSIX contents
echo "🔍 Verifying VSIX contents..."
echo ""

# Check for better-sqlite3 binding
if unzip -l "$VSIX_FILE" | grep -q "better_sqlite3.node"; then
  echo "✅ better-sqlite3 native binding included"
else
  echo "❌ ERROR: better-sqlite3 binding NOT found in VSIX!"
  exit 1
fi

# Check for legacy sqlite3 CLI (should still be included for fallback)
if unzip -l "$VSIX_FILE" | grep -q "node_sqlite3.node"; then
  echo "✅ Legacy sqlite3 binding included (for fallback)"
else
  echo "⚠️  Warning: Legacy sqlite3 not found (may be intentional)"
fi

# Check for migrations
if unzip -l "$VSIX_FILE" | grep -q "persistence/migrations"; then
  echo "✅ SQL migrations included"
else
  echo "❌ ERROR: SQL migrations NOT found!"
  exit 1
fi

echo ""
echo "📊 VSIX size:"
ls -lh "$VSIX_FILE"
echo ""

# Generate SHA256 checksum
CHECKSUM=$(shasum -a 256 "$VSIX_FILE" | awk '{print $1}')
echo "🔐 SHA256: $CHECKSUM"
echo ""

# Create alpha release directory
ALPHA_DIR="alpha-releases"
mkdir -p "$ALPHA_DIR"

# Copy VSIX to alpha releases folder with timestamp
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ALPHA_VSIX="${ALPHA_DIR}/cursor-accounts-alpha-${TIMESTAMP}.vsix"
cp "$VSIX_FILE" "$ALPHA_VSIX"

# Create info file
cat > "${ALPHA_DIR}/alpha-${TIMESTAMP}-info.txt" <<EOF
Alpha Release Information
=========================

Build Date: $(date)
Git Commit: $(git rev-parse HEAD)
Git Branch: $CURRENT_BRANCH
VSIX File: $ALPHA_VSIX
SHA256: $CHECKSUM

Feature Flag (default):
  cursorAccounts.experimental.useBetterSqlite3: false (opt-in)

Installation Instructions:
1. Download: $ALPHA_VSIX
2. In VS Code: Extensions → ⋯ → Install from VSIX...
3. Select the downloaded .vsix file
4. Reload VS Code when prompted
5. Enable feature flag in settings.json:
   {
     "cursorAccounts.experimental.useBetterSqlite3": true
   }
6. Reload window (Cmd/Ctrl + R)

Verification:
- Check Output → "Cursor Accounts" for:
  [AgentTrackingFactory] Using better-sqlite3 for: /path/to/db
  [BetterSqlite] Connection configured: WAL=wal

Monitoring:
- Run: ./scripts/verify-wal-mode.sh
- Report issues to: [GitHub Issues URL]

Documentation:
- See: docs/DATABASE-BETTER-SQLITE3.md
- See: docs/TESTING-MULTI-WINDOW.md
EOF

echo "✅ Alpha release prepared!"
echo ""
echo "📁 Files:"
echo "   VSIX: $ALPHA_VSIX"
echo "   Info: ${ALPHA_DIR}/alpha-${TIMESTAMP}-info.txt"
echo ""
echo "📧 Next steps:"
echo "   1. Distribute VSIX to 2-3 alpha testers"
echo "   2. Include installation instructions from info file"
echo "   3. Monitor for issues over 1-2 weeks"
echo "   4. Collect feedback in GitHub Discussion/Issue"
echo ""
echo "🔗 Useful commands:"
echo "   ./scripts/verify-wal-mode.sh  # Verify WAL mode after install"
echo "   git tag alpha-$(date +%Y%m%d)  # Tag this commit"
echo ""
