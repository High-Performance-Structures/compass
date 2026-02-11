# Local Development Setup

This directory contains patches and scripts to enable local development without WorkOS authentication.

## What This Does

These patches modify Compass to run in development mode without requiring WorkOS SSO authentication:

1. **Bypasses WorkOS auth checks** - Middleware redirects `/` to `/dashboard` when WorkOS isn't configured
2. **Mock D1 database** - Returns empty arrays for queries instead of throwing errors
3. **Wraps Cloudflare context** - Returns mock `{ env: { DB: null }, ctx: {} }` when WorkOS isn't configured
4. **Skips OpenNext initialization** - Only runs when WorkOS API keys are properly set

## How to Use

### Quick Start

From the compass directory:

```bash
.dev-setup/apply-dev.sh
```

This will apply all necessary patches to enable local development.

### Manual Application

If the automated script fails, you can apply patches manually:

1. **middleware.ts** - Redirects root to dashboard, allows all requests without auth
2. **lib/auth.ts** - Checks for "your_" and "placeholder" in WorkOS keys
3. **lib/cloudflare-context.ts** - New file that wraps `getCloudflareContext()`
4. **db/index.ts** - Returns mock DB when `d1` parameter is `null`
5. **next.config.ts** - Only initializes OpenNext Cloudflare when WorkOS is configured
6. **.gitignore** - Ignores `src/lib/cloudflare-context.ts` so it's not committed

### Undoing Changes

To remove dev setup and restore original behavior:

```bash
git restore src/middleware.ts
git restore src/lib/auth.ts
git restore src/db/index.ts
git restore next.config.ts
git restore .gitignore
rm src/lib/cloudflare-context.ts
```

## Environment Variables

To configure WorkOS auth properly (to disable dev mode):

```env
WORKOS_API_KEY=sk_dev_xxxxx
WORKOS_CLIENT_ID=client_xxxxx
WORKOS_REDIRECT_URI=http://localhost:3000
```

With these set, the dev patches will automatically skip and use real WorkOS authentication.

## Dev Mode Indicators

When in dev mode (WorkOS not configured):
- Dashboard loads directly without login redirect
- Database queries return empty arrays instead of errors
- Cloudflare context returns null DB instead of throwing

## Files Created/Modified

### New Files (dev only)
- `src/lib/cloudflare-context.ts` - Wraps `getCloudflareContext()` with dev bypass

### Modified Files
- `src/middleware.ts` - Added WorkOS detection and dev bypass
- `src/lib/auth.ts` - Enhanced WorkOS configuration detection
- `src/db/index.ts` - Added mock DB support for null D1 parameter
- `next.config.ts` - Conditional OpenNext initialization
- `.gitignore` - Added `cloudflare-context.ts` to prevent commits

## Future Development

Place any new dev-only components or patches in this directory following the same pattern:

1. **Patch files** - Store in `patches/` with `.patch` extension
2. **New files** - Store in `files/` directory
3. **Update apply-dev.sh** - Add your patches to the apply script
4. **Document here** - Update this README with changes

## Troubleshooting

**Build errors after applying patches:**
- Check that `src/lib/cloudflare-context.ts` exists
- Verify all patches applied cleanly
- Try manual patch application if automated script fails

**Auth still required:**
- Verify `.env.local` or `.dev.vars` doesn't have placeholder values
- Check that WorkOS environment variables aren't set (if you want dev mode)
- Restart dev server after applying patches

**Database errors:**
- Ensure `src/db/index.ts` patch was applied
- Check that mock DB is being returned when `d1` is null
