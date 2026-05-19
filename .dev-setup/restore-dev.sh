#!/bin/bash
set -e

echo "🔄 Removing local development setup..."

if [ ! -f "package.json" ] || [ ! -d "src" ]; then
  echo "❌ Error: Please run this script from the compass directory"
  exit 1
fi

# Revert tracked files
echo "📦 Restoring modified files..."
git checkout HEAD -- src/middleware.ts next.config.ts package.json bun.lock

# Remove dev-only files
echo "📦 Removing dev-only files..."
rm -f src/lib/cloudflare-context.ts
rm -f src/lib/db.ts
rm -f src/types/sql-js.d.ts
rm -f scripts/init-local-db.ts
echo "✓ Removed dev files"

# Restore original imports
echo "📦 Restoring original imports..."
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's|from "@/lib/db"|from "@opennextjs/cloudflare"|g'

# Remove sql.js
echo "📦 Removing sql.js..."
bun remove sql.js

# Remove local database
rm -f local.db local.db-wal local.db-shm

echo ""
echo "✅ Development setup removed!"
echo ""
echo "📝 Notes:"
echo "  - Original code restored from git"
echo "  - WorkOS/Cloudflare auth will be required"
echo "  - To re-apply: .dev-setup/apply-dev.sh"
