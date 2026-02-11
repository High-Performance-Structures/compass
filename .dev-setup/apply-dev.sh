#!/bin/bash
set -e

echo "🔧 Applying local development setup patches..."

# Check if we're in the compass directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
  echo "❌ Error: Please run this script from the compass directory"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Apply middleware patch
echo "📦 Applying middleware.ts patch..."
patch -p1 < "$SCRIPT_DIR/patches/middleware.patch" || {
  echo "⚠️  middleware.ts patch failed, applying manually..."
  cat "$SCRIPT_DIR/patches/middleware.patch"
}

# Apply auth patch
echo "📦 Applying auth.ts patch..."
patch -p1 < "$SCRIPT_DIR/patches/auth.patch" || {
  echo "⚠️  auth.ts patch failed, applying manually..."
  cat "$SCRIPT_DIR/patches/auth.patch"
}

# Apply cloudflare-context (create the wrapper file)
echo "📦 Applying cloudflare-context.ts..."
if [ ! -f "src/lib/cloudflare-context.ts" ]; then
  mkdir -p src/lib
  cp "$SCRIPT_DIR/files/cloudflare-context.ts" src/lib/
  echo "✓ Created src/lib/cloudflare-context.ts"
else
  echo "⚠️  cloudflare-context.ts already exists, skipping"
fi

# Apply db-index patch
echo "📦 Applying db/index.ts patch..."
patch -p1 < "$SCRIPT_DIR/patches/db-index.patch" || {
  echo "⚠️  db/index.ts patch failed, applying manually..."
  cat "$SCRIPT_DIR/patches/db-index.patch"
}

# Apply next-config patch
echo "📦 Applying next.config.ts patch..."
patch -p1 < "$SCRIPT_DIR/patches/next-config.patch" || {
  echo "⚠️  next.config.ts patch failed, applying manually..."
  cat "$SCRIPT_DIR/patches/next-config.patch"
}

# Update .gitignore
echo "📦 Updating .gitignore..."
patch -p1 < "$SCRIPT_DIR/patches/gitignore.patch" || {
  echo "⚠️  .gitignore patch failed, applying manually..."
  cat "$SCRIPT_DIR/patches/gitignore.patch"
}

echo ""
echo "✅ Development setup complete!"
echo ""
echo "📝 Notes:"
echo "  - These changes allow local development without WorkOS authentication"
echo "  - To use WorkOS auth, remove these changes or revert the patches"
echo "  - Modified files: src/lib/cloudflare-context.ts, src/middleware.ts, src/lib/auth.ts, src/db/index.ts, next.config.ts, .gitignore"
