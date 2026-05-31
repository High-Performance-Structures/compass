# Conversations Module

A Slack-like messaging system for project teams. This module provides real-time chat with threads, reactions, and presence tracking.

## What's Built

The conversations module is roughly 80% complete. The core messaging experience works end-to-end: channels, threads, search, and presence. What's missing is the periphery—attachments, voice, and some UI polish.

### Working Features

**Channels and Organization**
- Text and announcement channels (public or private)
- Channel categories that collapse in the sidebar
- Join/leave public channels
- Channel membership with roles (owner, moderator, member)

**Messaging**
- Send messages with full markdown support (bold, italic, code, lists, links)
- Edit and soft-delete messages
- Threaded replies in a resizable side panel
- Pin important messages
- Message search with filters (by channel, user, date range)

**Real-Time Updates**
- Polling-based message updates (2.5s when visible, 10s when hidden)
- Typing indicators with 5-second timeout
- User presence (online, idle, do-not-disturb, offline)
- Automatic idle detection after 5 minutes of inactivity

**Database and Performance**
- 10 tables in `schema-conversations.ts`
- Indexed for production workloads (9 indexes added for common queries)
- Input validation (4000 char messages, 100 char status, emoji validation)
- LIKE query escaping to prevent pattern injection

### What's Missing

The gaps fall into three categories: schema without implementation, UI not connected, and features not started.

**Schema exists, no implementation:**

| Feature | Status |
|---------|--------|
| Message attachments | Table defined, no upload/download actions |
| Voice channels | Type in schema, stub component only |
| Announcement channels | Type exists, no posting restrictions |
| Notification levels | Field in channelMembers, not exposed |
| Custom status messages | Field in userPresence, no UI |

**Actions exist, UI incomplete:**

| Feature | Status |
|---------|--------|
| Message reactions | `addReaction`/`removeReaction` work, emoji picker disabled |
| Pinned messages panel | Panel built, header button not wired |
| Unread badges | Read state tracked in DB, sidebar not always accurate |

**Not implemented:**

- @mentions and notifications
- Channel settings (edit, archive, delete)
- Member management (add/remove, role changes)
- Private channel invitations
- Offline sync integration (sync engine exists, not connected)

## Architecture

### Server Actions

Six action files handle all data mutations:

```
src/app/actions/
├── conversations.ts         # Channel CRUD, join/leave
├── chat-messages.ts         # Send, edit, delete, reactions, threads
├── conversations-realtime.ts # Polling updates, typing indicators
├── channel-categories.ts    # Category management, channel reordering
├── message-search.ts        # Full-text search, pin/unpin
└── presence.ts              # Status updates, member presence
```

All actions return `{ success: true, data }` or `{ success: false, error }`. Authorization checks verify channel membership before allowing reactions or message operations.

### Components

The UI is split between the sidebar navigation and the main channel view:

```
src/components/conversations/
├── channel-header.tsx       # Name, description, member count, action buttons
├── message-list.tsx         # Paginated messages grouped by date
├── message-item.tsx         # Single message with toolbar
├── message-composer.tsx     # TipTap editor with formatting
├── thread-panel.tsx         # Resizable reply panel
├── member-sidebar.tsx       # Members grouped by status
├── pinned-messages-panel.tsx # Sheet for pinned messages
├── search-dialog.tsx        # Command dialog with filters
├── typing-indicator.tsx     # Animated dots
├── create-channel-dialog.tsx # Full creation form
└── voice-channel-stub.tsx   # Placeholder
```

The channel view at `/dashboard/conversations/[channelId]` combines these into a three-panel layout: sidebar (optional), messages, and thread panel (when open).

### Real-Time Strategy

This module uses polling rather than WebSockets. The reasoning:

1. Cloudflare Workers handles HTTP well; WebSocket support is newer
2. Polling is simpler to debug and deploy
3. 2.5s latency is acceptable for team chat
4. Automatic backoff when tab is hidden reduces server load

If WebSocket requirements emerge (typing races, sub-second updates), the architecture can shift. The `useRealtimeChannel` hook abstracts the polling logic, so swapping implementations wouldn't require component changes.

### Sync Infrastructure

A complete offline-first sync engine exists in `src/lib/sync/` but isn't connected to conversations yet. The engine handles:

- Vector clocks for conflict detection
- Mutation queues for offline edits
- Delta sync with checkpoints
- Tombstones for deletions

This was built for the desktop offline sync path. When the mobile app needs offline messaging, this infrastructure is ready to connect.

## Recent Fixes

February 2026 brought a comprehensive code review with 38 issues addressed:

**Critical (5):**
- Database indexes for production queries
- Edge runtime compatibility (replaced JSDOM with isomorphic-dompurify)
- Authorization bypasses in category/channel operations

**Important (18):**
- React.memo for message items
- Throttled presence updates
- Message length limits and input validation
- Accessibility (aria-labels, keyboard navigation)

**Polish (15):**
- Improved typing animation
- Sticky date separators
- Extracted duplicate query construction

## What's Next

Priority order for completing the module:

1. **Wire the disabled UI** — Connect the emoji picker for reactions, wire the pinned messages button, fix unread badge accuracy. These are small changes with high user impact.

2. **Attachments** — The hardest missing piece. Requires file upload to R2, thumbnail generation, permissions, and a storage quota system. Start with images only.

3. **Voice channels** — Requires WebRTC or a third-party service. Consider LiveKit or Daily for the infrastructure layer.

4. **Notifications** — @mentions need a notification table, push integration, and preference settings. The schema doesn't support this yet.

5. **Offline sync** — Connect the existing sync engine to conversations. This unlocks the desktop app's full potential.

## Files Reference

| Category | Files | Lines |
|----------|-------|-------|
| Schema | `schema-conversations.ts` | 169 |
| Actions | 6 files in `app/actions/` | ~2,200 |
| Components | 12 in `components/conversations/` | ~2,300 |
| Pages | 3 in `app/dashboard/conversations/` | ~160 |
| Hooks | `use-realtime-channel.ts` | 170 |
| Contexts | `presence-context.tsx`, conversations layout | ~320 |
| Sync | 9 files in `lib/sync/` | ~1,800 |

Total: approximately 7,350 lines
