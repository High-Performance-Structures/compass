# Anthropic OAuth Debug Log

## Problem

The Anthropic OAuth flow in Compass fails with errors from Anthropic's OAuth endpoint. The goal is to enable users to authenticate with their Claude Pro/Max subscription to use the agent features.

## Current Error

```
Invalid OAuth Request
Missing state parameter
```

(Previous error was "Invalid OAuth Request" without details)

## OAuth Flow Architecture

### How it should work:
1. User clicks "Connect with Anthropic" in Settings → Agent tab
2. App generates PKCE verifier/challenge + state
3. Opens Anthropic OAuth URL in browser/popup
4. User authorizes on Anthropic's page
5. Anthropic redirects to `https://console.anthropic.com/oauth/code/callback` with code and state
6. User copies the code (and optionally state) from the redirect page
7. User pastes code into Compass
8. App exchanges code + verifier + state for access/refresh tokens

### Key OAuth Constants:
- **Client ID**: `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Claude Code's client ID)
- **Authorize URL**: `https://claude.ai/oauth/authorize`
- **Token URL**: `https://console.anthropic.com/v1/oauth/token`
- **Redirect URI**: `https://console.anthropic.com/oauth/code/callback`
- **Scopes**: `org:create_api_key user:profile user:inference user:sessions:claude_code`

## Files Modified

### `src/lib/anthropic-oauth-client.ts`
Browser-safe PKCE + auth URL generation (duplicated from agent-core to avoid server-only deps).

**Changes made:**
- Added `state` parameter generation
- Updated `buildAuthUrl()` to include state

### `packages/agent-core/src/oauth.ts`
Server-side OAuth implementation with token exchange.

**Changes made:**
- Added `state` parameter generation
- Updated `buildAuthUrl()` to include state

### `src/components/settings/ai-model-tab.tsx`
UI for OAuth flow in settings.

**Changes made:**
- Updated `OAuthState` type to include state
- Updated `handleOAuthConnect` to generate and store state
- Updated `handleOAuthSubmit` to verify state (CSRF protection)

### `src/lib/native/platform.ts`
Added `openExternalUrl()` function for cross-platform URL opening.

**Changes made:**
- New function that uses `@tauri-apps/plugin-opener` on desktop
- Falls back to `window.open` on web

### `src-tauri/` (Tauri desktop)
- Added `@tauri-apps/plugin-opener` to Cargo.toml and package.json
- Registered plugin in `lib.rs`
- Added `opener:default` permission to capabilities

## Fixes Attempted

### 1. Popup not opening (FIXED)
**Problem:** Clicking "Connect with Anthropic" did nothing - browser/popup didn't open.

**Root cause:** `window.open()` doesn't work in Tauri desktop for external URLs.

**Fix:** Created `openExternalUrl()` function that uses Tauri's opener plugin on desktop, `window.open` on web.

**Status:** ✅ Fixed - popup now opens correctly

### 2. Missing state parameter (ATTEMPTED)
**Problem:** "Invalid OAuth Request - Missing state parameter"

**Root cause:** Anthropic requires a `state` parameter for CSRF protection.

**Fix attempted:** Added state generation and included it in the auth URL.

**Status:** ❌ Still failing - error persists even with state parameter

## Research Findings

From web search and GitHub issues:

1. The client ID `9d1c250a-e61b-44d9-88ed-5944d1962f5e` is Claude Code's registered OAuth client
2. The redirect URI `https://console.anthropic.com/oauth/code/callback` is specific to Claude Code
3. Third-party apps may not be able to use this client ID with different redirect URIs
4. Anthropic has tightened OAuth validation recently (per GitHub PR comments)

## Possible Root Causes

1. **Client ID restriction**: The OAuth client may only allow specific redirect URIs or origins
2. **Origin validation**: Anthropic may validate the origin of the request
3. **Account requirements**: May require specific subscription type or account standing
4. **Session required**: User may need to be logged into Anthropic console first
5. **Missing parameters**: May need additional parameters not documented

## Alternative Approaches to Consider

### 1. Desktop credential detection
On desktop, detect existing Claude Code credentials from `~/.claude/.credentials.json`. This is already implemented and works.

### 2. Local OAuth callback server
Run a local server to handle OAuth callback (like Claude Code does). Requires:
- Start local server on random port
- Use `http://localhost:PORT/callback` as redirect URI
- Handle callback automatically

## Related Code References

- Claude Code CLI: Uses same OAuth flow with local callback server
- OpenCode: Uses same client ID, also reports OAuth issues
- GitHub issues: anthropics/claude-code#954 mentions OAuth errors in WSL
