# Local Development Setup

This directory contains files for running Compass locally without Cloudflare or WorkOS credentials.

## What This Does

1. **Bypasses WorkOS auth** - Middleware skips auth when API keys aren't configured
2. **Local SQLite database** - Uses sql.js (pure JS SQLite) instead of Cloudflare D1
3. **Dev user** - `dev@compass.io` with admin role
4. **Full database support** - Real queries work, not just mocks

## Quick Start

From the compass directory:

```bash
.dev-setup/apply-dev.sh
bun dev
```

## Manual Setup

If the script fails, apply manually:

```bash
# 1. Install sql.js
bun add sql.js

# 2. Copy dev files
cp .dev-setup/files/middleware.ts src/middleware.ts
cp .dev-setup/files/next.config.ts next.config.ts
cp .dev-setup/files/cloudflare-context.ts src/lib/cloudflare-context.ts
cp .dev-setup/files/db.ts src/lib/db.ts
mkdir -p scripts
cp .dev-setup/files/init-local-db.ts scripts/init-local-db.ts

# 3. Replace imports
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's|from "@opennextjs/cloudflare"|from "@/lib/db"|g'

# 4. Add script to package.json
node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));p.scripts["db:init-local"]="bun scripts/init-local-db.ts";fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'

# 5. Initialize database
bun run db:init-local

# 6. Start dev server
bun dev
```

## Reverting

```bash
.dev-setup/restore-dev.sh
```

Or manually:

```bash
git checkout HEAD -- src/middleware.ts next.config.ts package.json bun.lock
rm -f src/lib/cloudflare-context.ts src/lib/db.ts scripts/init-local-db.ts
find src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's|from "@/lib/db"|from "@opennextjs/cloudflare"|g'
bun remove sql.js
rm -f local.db local.db-wal local.db-shm
```

## Files

| File | Purpose |
|------|---------|
| `files/middleware.ts` | Bypasses WorkOS when not configured |
| `files/next.config.ts` | Removes Cloudflare dev proxy |
| `files/cloudflare-context.ts` | sql.js wrapper mimicking D1 |
| `files/db.ts` | Conditional import wrapper |
| `files/init-local-db.ts` | Migration runner for local DB |

## Environment Variables

To use real WorkOS auth (disables dev mode):

```env
WORKOS_API_KEY=sk_dev_xxxxx
WORKOS_CLIENT_ID=client_xxxxx
```

Values containing "placeholder" trigger dev mode.

## Database

- Stored in `local.db` at repo root
- Migrations applied from `drizzle/` directory
- Persisted between sessions

## Limitations

Features requiring external APIs won't work offline:
- NetSuite sync
- Google Drive integration
- AI agent (needs OPENROUTER_API_KEY)
- Push notifications

## Troubleshooting

**"Cannot find module 'sql.js'"**
- Run `bun add sql.js`

**Database errors**
- Re-run `bun run db:init-local`
- Check `local.db` exists

**Auth still required**
- Verify no WORKOS_API_KEY set
- Check middleware.ts was copied
