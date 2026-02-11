#!/bin/bash
set -e

echo "🔄 Removing local development setup patches..."

# Check if we're in the compass directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
  echo "❌ Error: Please run this script from the compass directory"
  exit 1
fi

# Restore modified files
echo "📦 Restoring modified files..."
git restore src/middleware.ts
git restore src/lib/auth.ts
git restore src/db/index.ts
git restore next.config.ts
git restore .gitignore

# Remove dev-only new file
echo "📦 Removing dev-only files..."
if [ -f "src/lib/cloudflare-context.ts" ]; then
  rm src/lib/cloudflare-context.ts
  echo "✓ Removed src/lib/cloudflare-context.ts"
else
  echo "⚠️  src/lib/cloudflare-context.ts not found, skipping"
fi

echo ""
echo "✅ Development setup removed!"
echo ""
echo "📝 Notes:"
echo "  - Original code has been restored from git"
echo "  - Dev mode is now disabled"
echo "  - WorkOS authentication will be required (if configured)"
echo "  - To re-apply dev setup, run: .dev-setup/apply-dev.sh"
