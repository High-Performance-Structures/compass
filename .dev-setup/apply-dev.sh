#!/bin/bash
set -e

echo "🔧 Applying local development setup..."

if [ ! -f "package.json" ] || [ ! -d "src" ]; then
  echo "❌ Error: Please run this script from the compass directory"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Install sql.js
echo "📦 Installing sql.js..."
bun add sql.js

# 2. Copy dev files
echo "📦 Copying dev files..."
cp "$SCRIPT_DIR/files/middleware.ts" src/middleware.ts
cp "$SCRIPT_DIR/files/next.config.ts" next.config.ts
cp "$SCRIPT_DIR/files/cloudflare-context.ts" src/lib/cloudflare-context.ts
cp "$SCRIPT_DIR/files/db.ts" src/lib/db.ts
mkdir -p src/types
cp "$SCRIPT_DIR/files/types/sql-js.d.ts" src/types/sql-js.d.ts
cp "$SCRIPT_DIR/files/types/better-sqlite3.d.ts" src/types/better-sqlite3.d.ts
mkdir -p scripts
cp "$SCRIPT_DIR/files/init-local-db.ts" scripts/init-local-db.ts

# 3. Replace all @opennextjs/cloudflare imports with local wrapper
echo "📦 Updating imports..."
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's|from "@opennextjs/cloudflare"|from "@/lib/db"|g'

# 4. Add db:init-local script to package.json if not present
if ! grep -q '"db:init-local"' package.json; then
  echo "📦 Adding db:init-local script..."
  # Use node to update package.json
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json"));
    pkg.scripts["db:init-local"] = "bun scripts/init-local-db.ts";
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  '
fi

# 5. Initialize local database
echo "📦 Initializing local database..."
bun run db:init-local

echo ""
echo "✅ Development setup complete!"
echo ""
echo "📝 Notes:"
echo "  - Local database stored in local.db"
echo "  - Dev user: dev@compass.io (admin role)"
echo "  - Run 'bun dev' to start"
echo ""
echo "🔄 To revert: run .dev-setup/restore-dev.sh"
